import { Router } from "express";
import { requireUser, requireAdmin } from "../auth.js";
import { db } from "../db.js";
const router=Router();router.use(requireUser,requireAdmin);
router.get("/stats",async(req,res)=>{const users=await db.query("SELECT count(*)::int n FROM users");const files=await db.query("SELECT count(*)::int n FROM files");const chats=await db.query("SELECT count(*)::int n FROM conversations");res.json({users:users.rows[0].n,files:files.rows[0].n,conversations:chats.rows[0].n})});
export default router;
