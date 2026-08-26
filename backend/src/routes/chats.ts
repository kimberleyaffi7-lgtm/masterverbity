import { Router } from "express";
import { z } from "zod";
import { db } from "../db.js";
import { requireUser } from "../auth.js";
import { getProvider } from "../providers/registry.js";
import { retrieveRelevant } from "../services/retrieval.js";

const router=Router(); router.use(requireUser);
router.get("/",async(req,res)=>{const r=await db.query("SELECT id,title,created_at,updated_at FROM conversations WHERE user_id=$1 ORDER BY updated_at DESC",[req.user!.id]);res.json({conversations:r.rows})});
router.post("/",async(req,res)=>{const r=await db.query("INSERT INTO conversations(user_id,title) VALUES($1,'New chat') RETURNING *",[req.user!.id]);res.json({conversation:r.rows[0]})});
router.get("/:id",async(req,res)=>{
  const c=await db.query("SELECT * FROM conversations WHERE id=$1 AND user_id=$2",[req.params.id,req.user!.id]);
  if(!c.rows[0])return res.status(404).json({error:"Conversation not found"});
  const m=await db.query("SELECT id,role,content,metadata,created_at FROM messages WHERE conversation_id=$1 ORDER BY created_at",[req.params.id]);
  const f=await db.query("SELECT id,original_name,size_bytes,status FROM files WHERE conversation_id=$1 ORDER BY created_at DESC",[req.params.id]);
  res.json({conversation:c.rows[0],messages:m.rows,files:f.rows});
});
router.delete("/:id",async(req,res)=>{await db.query("DELETE FROM conversations WHERE id=$1 AND user_id=$2",[req.params.id,req.user!.id]);res.json({ok:true})});

router.post("/:id/messages",async(req,res)=>{
  const body=z.object({content:z.string().min(1).max(100000),providerId:z.string().uuid(),modelId:z.string().uuid()}).parse(req.body);
  const c=await db.query("SELECT * FROM conversations WHERE id=$1 AND user_id=$2",[req.params.id,req.user!.id]);
  if(!c.rows[0])return res.status(404).json({error:"Conversation not found"});
  const model=await db.query("SELECT model_id FROM ai_models WHERE id=$1 AND provider_id=$2 AND enabled=true",[body.modelId,body.providerId]);
  if(!model.rows[0])return res.status(400).json({error:"Model not found"});
  await db.query("INSERT INTO messages(conversation_id,role,content) VALUES($1,'user',$2)",[req.params.id,body.content]);
  const history=await db.query("SELECT role,content FROM messages WHERE conversation_id=$1 ORDER BY created_at DESC LIMIT 30",[req.params.id]);
  const fileRows=await db.query("SELECT id FROM files WHERE conversation_id=$1 AND user_id=$2 AND status='ready'",[req.params.id,req.user!.id]);
  const context=await retrieveRelevant(fileRows.rows.map(x=>x.id),body.content);
  const system=`You are the internal team AI assistant. Be accurate and concise. When file context is supplied, cite it using [filename:path#chunk]. Never invent citations.\n\nFILE CONTEXT:\n${context.map(x=>`[${x.original_name}:${x.path}#${x.chunk_index}]\\n${x.content}`).join("\\n\\n")}`;
  const messages=[{role:"system" as const,content:system},...history.rows.reverse().map(x=>({role:x.role as "user"|"assistant",content:x.content}))];
  const provider=await getProvider(body.providerId);
  res.setHeader("Content-Type","text/event-stream");res.setHeader("Cache-Control","no-cache");res.setHeader("Connection","keep-alive");
  let full="";
  try{
    for await(const token of provider.streamChat({model:model.rows[0].model_id,messages})){full+=token;res.write(`data: ${JSON.stringify({token})}\\n\\n`);}
    await db.query("INSERT INTO messages(conversation_id,role,content) VALUES($1,'assistant',$2)",[req.params.id,full]);
    await db.query("UPDATE conversations SET updated_at=now(),provider_id=$1,model_id=$2,title=CASE WHEN title='New chat' THEN LEFT($3,80) ELSE title END WHERE id=$4",[body.providerId,body.modelId,body.content,req.params.id]);
    res.write(`data: ${JSON.stringify({done:true})}\\n\\n`);
  }catch(e){res.write(`data: ${JSON.stringify({error:e instanceof Error?e.message:"Generation failed"})}\\n\\n`)}
  res.end();
});
export default router;
