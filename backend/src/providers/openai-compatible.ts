import type { AIProvider, ChatRequest } from "./types.js";
export class OpenAICompatibleProvider implements AIProvider {
  constructor(private baseUrl: string, private apiKey: string) {}
  async *streamChat(request: ChatRequest): AsyncGenerator<string> {
    const response = await fetch(`${this.baseUrl.replace(/\/$/,"")}/chat/completions`, {
      method:"POST",
      headers:{"Content-Type":"application/json",Authorization:`Bearer ${this.apiKey}`},
      body:JSON.stringify({model:request.model,messages:request.messages,temperature:request.temperature??0.3,max_tokens:request.maxTokens,stream:true}),
      signal:request.signal
    });
    if (!response.ok || !response.body) throw new Error(`Provider returned ${response.status}: ${(await response.text()).slice(0,500)}`);
    const reader=response.body.getReader(); const decoder=new TextDecoder(); let pending="";
    while(true){
      const r=await reader.read(); if(r.done) break;
      pending+=decoder.decode(r.value,{stream:true});
      const lines=pending.split("\n"); pending=lines.pop()??"";
      for(const line of lines){
        if(!line.startsWith("data:")) continue;
        const data=line.slice(5).trim(); if(!data || data==="[DONE]") continue;
        try { const event=JSON.parse(data); const token=event.choices?.[0]?.delta?.content; if(typeof token==="string") yield token; } catch {}
      }
    }
  }
  async createEmbeddings(texts:string[]) {
    const response=await fetch(`${this.baseUrl.replace(/\/$/,"")}/embeddings`,{
      method:"POST",headers:{"Content-Type":"application/json",Authorization:`Bearer ${this.apiKey}`},
      body:JSON.stringify({model:process.env.EMBEDDING_MODEL??"text-embedding-3-small",input:texts})
    });
    if(!response.ok) throw new Error(`Embedding request failed: ${response.status}`);
    const json=await response.json() as any;
    return (json.data??[]).sort((a:any,b:any)=>a.index-b.index).map((x:any)=>x.embedding);
  }
  async testConnection(){
    try{
      const r=await fetch(`${this.baseUrl.replace(/\/$/,"")}/models`,{headers:{Authorization:`Bearer ${this.apiKey}`}});
      return {success:r.ok,message:r.ok?"Connection successful":`Provider returned ${r.status}`};
    }catch(e){return {success:false,message:e instanceof Error?e.message:"Connection failed"}}
  }
}
