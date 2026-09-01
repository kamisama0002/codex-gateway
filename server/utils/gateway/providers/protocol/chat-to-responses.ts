import type { ChatCompletionMessage, ResponsesResult } from "./types";

export interface ChatCompletionResponse {
  id?: string;
  model?: string;
  created?: number;
  choices?: Array<{
    index?: number;
    message?: ChatCompletionMessage;
    finish_reason?: string | null;
  }>;
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
  } | null;
}

export function toResponsesResult(input: ChatCompletionResponse, model: string): ResponsesResult {
  const id = typeof input.id === "string" && input.id !== "" ? input.id : `resp_${randomId()}`;
  const output = [] as ResponsesResult["output"];
  let outputText = "";
  let failed = false;
  for (const [choiceIndex, choice] of (input.choices ?? []).entries()) {
    const message = choice.message;
    if (message === undefined) continue;
    if (typeof message.content === "string" && message.content.length > 0) {
      outputText += message.content;
      output.push({
        id: `${id}_msg_${choice.index ?? choiceIndex}`,
        type: "message",
        role: "assistant",
        status: choice.finish_reason === "length" ? "failed" : "completed",
        content: [{ type: "output_text", text: message.content, annotations: [] }],
      });
    }
    for (const [toolIndex, call] of (message.tool_calls ?? []).entries()) {
      if (call.type !== "function" || call.function.name === "" || !isValidJson(call.function.arguments)) {
        failed = true;
        continue;
      }
      output.push({
        id: `${id}_fc_${choice.index ?? choiceIndex}_${toolIndex}`,
        type: "function_call",
        status: "completed",
        call_id: call.id,
        name: call.function.name,
        arguments: call.function.arguments,
      });
    }
    if (choice.finish_reason === "error" || choice.finish_reason === "content_filter") failed = true;
  }
  const usage = input.usage
    ? {
        input_tokens: input.usage.prompt_tokens ?? 0,
        output_tokens: input.usage.completion_tokens ?? 0,
        total_tokens: input.usage.total_tokens ?? 0,
      }
    : null;
  return {
    id,
    object: "response",
    created_at: input.created ?? Math.floor(Date.now() / 1000),
    model,
    status: failed ? "failed" : "completed",
    output,
    output_text: outputText,
    usage,
    error: failed ? { code: "invalid_tool_call", message: "Upstream returned an invalid tool call" } : null,
  };
}

function isValidJson(value: string): boolean {
  try {
    JSON.parse(value);
    return true;
  } catch {
    return false;
  }
}

function randomId(): string {
  return Math.random().toString(36).slice(2, 14);
}
