import type { AIProvider, ChatRequest } from "./types.js";
export class GeminiProvider implements AIProvider {
  constructor(private apiKey:string, private baseUrl="https://generativelanguage.googleapis.com/v1beta") {}
  async *streamChat(request:ChatRequest):AsyncGenerator<string>{
    const contents=request.messages.filter(m=>m.role!=="system").map(m=>({role:m.role==="assistant"?"model":"user",parts:[{text:m.content}]}));
    const system=request.messages.find(m=>m.role==="system")?.content;
    const r=await fetch(`${this.baseUrl}/models/${encodeURIComponent(request.model)}:streamGenerateContent?alt=sse&key=${encodeURIComponent(this.apiKey)}`,{
      method:"POST",headers:{"content-type":"application/json"},
      body:JSON.stringify({systemInstruction:system?{parts:[{text:system}]}:undefined,contents,generationConfig:{temperature:request.temperature??0.3,maxOutputTokens:request.maxTokens??4096}}),
      signal:request.signal
    });
    if(!r.ok||!r.body) throw new Error(`Gemini returned ${r.status}: ${(await r.text()).slice(0,500)}`);
    const reader=r.body.getReader();const decoder=new TextDecoder();let pending="";
    while(true){const x=await reader.read();if(x.done)break;pending+=decoder.decode(x.value,{stream:true});const lines=pending.split("\n");pending=lines.pop()??"";
      for(const line of lines){if(!line.startsWith("data:"))continue;try{const e=JSON.parse(line.slice(5).trim());const t=e.candidates?.[0]?.content?.parts?.map((p:any)=>p.text||"").join("");if(t)yield t;}catch{}}
    }
  }
  async testConnection(){try{const r=await fetch(`${this.baseUrl}/models?key=${encodeURIComponent(this.apiKey)}`);return {success:r.ok,message:r.ok?"Connection successful":`Gemini returned ${r.status}`};}catch(e){return {success:false,message:e instanceof Error?e.message:"Connection failed"}}}
}
