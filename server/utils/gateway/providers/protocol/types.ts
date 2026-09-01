export type ProviderTool =
  | { type: "function"; name: string; description?: string; parameters?: Record<string, unknown> }
  | { type: string; name?: string; description?: string; parameters?: Record<string, unknown> };

export interface ResponsesRequestInput {
  model: string;
  instructions?: string;
  input?: string | ResponsesInputItem[];
  tools?: ProviderTool[];
  stream?: boolean;
  temperature?: number;
  top_p?: number;
  max_output_tokens?: number;
  [key: string]: unknown;
}

export type ResponsesInputItem =
  | { type: "message"; role: "system" | "developer" | "user" | "assistant"; content: unknown }
  | { type: "function_call"; call_id: string; name: string; arguments: string }
  | { type: "function_call_output"; call_id: string; output: unknown }
  | { type: string; [key: string]: unknown };

export interface ChatCompletionMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string | null;
  tool_calls?: Array<{
    id: string;
    type: "function";
    function: { name: string; arguments: string };
  }>;
  tool_call_id?: string;
}

export interface ChatCompletionRequest {
  model: string;
  messages: ChatCompletionMessage[];
  tools?: Array<{
    type: "function";
    function: { name: string; description?: string; parameters?: Record<string, unknown> };
  }>;
  stream?: boolean;
  temperature?: number;
  top_p?: number;
  max_tokens?: number;
}

export interface ResponsesOutputItem {
  type: "message" | "function_call";
  id: string;
  role?: "assistant";
  status?: "completed" | "in_progress" | "failed";
  content?: Array<{ type: "output_text"; text: string; annotations: [] }>;
  call_id?: string;
  name?: string;
  arguments?: string;
}

export interface ResponsesUsage {
  input_tokens: number;
  output_tokens: number;
  total_tokens: number;
}

export interface ResponsesResult {
  id: string;
  object: "response";
  created_at: number;
  model: string;
  status: "completed" | "incomplete" | "failed";
  output: ResponsesOutputItem[];
  output_text: string;
  usage: ResponsesUsage | null;
  error: { code: string; message: string } | null;
}
