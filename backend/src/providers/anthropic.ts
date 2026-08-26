import type { AIProvider, ChatRequest } from "./types.js";
export class AnthropicProvider implements AIProvider {
  constructor(private apiKey:string, private baseUrl="https://api.anthropic.com") {}
  async *streamChat(request:ChatRequest):AsyncGenerator<string>{
    const system=request.messages.filter(m=>m.role==="system").map(m=>m.content).join("\n");
    const messages=request.messages.filter(m=>m.role!=="system").map(m=>({role:m.role,content:m.content}));
    const r=await fetch(`${this.baseUrl.replace(/\/$/,"")}/v1/messages`,{
      method:"POST",
      headers:{"content-type":"application/json","x-api-key":this.apiKey,"anthropic-version":"2023-06-01"},
      body:JSON.stringify({model:request.model,max_tokens:request.maxTokens??4096,temperature:request.temperature??0.3,system,messages,stream:true}),
      signal:request.signal
    });
    if(!r.ok||!r.body) throw new Error(`Anthropic returned ${r.status}: ${(await r.text()).slice(0,500)}`);
    const reader=r.body.getReader();const decoder=new TextDecoder();let pending="";
    while(true){const x=await reader.read();if(x.done)break;pending+=decoder.decode(x.value,{stream:true});const lines=pending.split("\n");pending=lines.pop()??"";
      for(const line of lines){if(!line.startsWith("data:"))continue;try{const e=JSON.parse(line.slice(5).trim());if(e.type==="content_block_delta"&&e.delta?.text)yield e.delta.text;}catch{}}
    }
  }
  async testConnection(){try{const r=await fetch(`${this.baseUrl}/v1/models`,{headers:{"x-api-key":this.apiKey,"anthropic-version":"2023-06-01"}});return {success:r.ok,message:r.ok?"Connection successful":`Provider returned ${r.status}`};}catch(e){return {success:false,message:e instanceof Error?e.message:"Connection failed"}}}
}
