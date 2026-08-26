import { db } from "../db.js";
import { decrypt } from "../services/encryption.js";
import { OpenAICompatibleProvider } from "./openai-compatible.js";
import { AnthropicProvider } from "./anthropic.js";
import { GeminiProvider } from "./gemini.js";
import type { AIProvider } from "./types.js";

export async function getProvider(id:string):Promise<AIProvider>{
  const r=await db.query("SELECT * FROM ai_providers WHERE id=$1 AND enabled=true",[id]);
  const p=r.rows[0]; if(!p) throw new Error("Provider not found or disabled");
  const key=decrypt(p.encrypted_api_key);
  if(p.provider_type==="openai-compatible") return new OpenAICompatibleProvider(p.base_url,key);
  if(p.provider_type==="anthropic") return new AnthropicProvider(key,p.base_url||undefined);
  if(p.provider_type==="gemini") return new GeminiProvider(key,p.base_url||undefined);
  throw new Error("Unsupported provider type");
}
