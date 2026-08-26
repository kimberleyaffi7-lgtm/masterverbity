export type ChatRole = "system" | "user" | "assistant";
export interface ChatMessage { role: ChatRole; content: string; }
export interface ChatRequest {
  model: string; messages: ChatMessage[]; temperature?: number; maxTokens?: number; signal?: AbortSignal;
}
export interface AIProvider {
  streamChat(request: ChatRequest): AsyncGenerator<string, void, unknown>;
  createEmbeddings?(texts: string[]): Promise<number[][]>;
  testConnection(): Promise<{success:boolean;message?:string}>;
}
