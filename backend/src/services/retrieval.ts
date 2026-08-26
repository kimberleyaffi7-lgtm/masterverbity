import { db } from "../db.js";
import { getProvider } from "../providers/registry.js";

function normalize(v:number[]){const n=Math.sqrt(v.reduce((s,x)=>s+x*x,0))||1;return v.map(x=>x/n)}
export async function retrieveRelevant(fileIds:string[], query:string, limit=8){
  const providerId=process.env.EMBEDDING_PROVIDER_ID;
  if(!providerId || !fileIds.length) return [];
  const provider=await getProvider(providerId);
  if(!provider.createEmbeddings) return [];
  const [vector]=await provider.createEmbeddings([query]);
  if(!vector || vector.length!==1536) return [];
  const v=`[${normalize(vector).join(",")}]`;
  const r=await db.query(`
    SELECT fc.content, fc.path, fc.chunk_index, f.original_name,
           1-(fc.embedding <=> $1::vector) AS score
    FROM file_chunks fc JOIN files f ON f.id=fc.file_id
    WHERE fc.file_id = ANY($2::uuid[]) AND fc.embedding IS NOT NULL
    ORDER BY fc.embedding <=> $1::vector LIMIT $3
  `,[v,fileIds,limit]);
  return r.rows;
}
