import type {
  ChatCompletionMessage,
  ChatCompletionRequest,
  ResponsesInputItem,
  ResponsesRequestInput,
  ProviderTool,
} from "./types";
import { assertProviderSupportsRequest } from "../capability-validator";
import type { ModelCapabilities } from "~~/shared/types";

export function toChatCompletionRequest(
  input: ResponsesRequestInput,
  capabilities: ModelCapabilities,
): ChatCompletionRequest {
  assertProviderSupportsRequest(input, capabilities);
  const messages: ChatCompletionMessage[] = [];
  if (input.instructions !== undefined && input.instructions.trim() !== "") {
    messages.push({ role: "system", content: input.instructions });
  }
  if (typeof input.input === "string") {
    messages.push({ role: "user", content: input.input });
  } else if (Array.isArray(input.input)) {
    for (const item of input.input) appendInputItem(messages, item);
  }
  const request: ChatCompletionRequest = { model: input.model, messages };
  if (input.tools !== undefined && input.tools.length > 0) {
    request.tools = input.tools.map((tool) => {
      if (!isFunctionTool(tool)) throw new Error("Only function tools are supported by Chat providers");
      return {
        type: "function",
        function: {
          name: tool.name,
          ...(tool.description === undefined ? {} : { description: tool.description }),
          ...(tool.parameters === undefined ? {} : { parameters: tool.parameters }),
        },
      };
    });
  }
  if (input.stream !== undefined) request.stream = input.stream;
  if (input.temperature !== undefined) request.temperature = input.temperature;
  if (input.top_p !== undefined) request.top_p = input.top_p;
  if (input.max_output_tokens !== undefined) request.max_tokens = input.max_output_tokens;
  return request;
}

function appendInputItem(messages: ChatCompletionMessage[], item: ResponsesInputItem): void {
  if (item.type === "function_call") {
    const callId = stringProperty(item, "call_id");
    const name = stringProperty(item, "name");
    const argumentsValue = stringProperty(item, "arguments");
    messages.push({
      role: "assistant",
      content: null,
      tool_calls: [{
        id: callId,
        type: "function",
        function: { name, arguments: argumentsValue },
      }],
    });
    return;
  }
  if (item.type === "function_call_output") {
    const callId = stringProperty(item, "call_id");
    const output = item.output;
    messages.push({
      role: "tool",
      tool_call_id: callId,
      content: stringifyToolOutput(output),
    });
    return;
  }
  if (item.type === "message") {
    const roleValue = stringProperty(item, "role");
    if (roleValue !== "system" && roleValue !== "developer" && roleValue !== "user" && roleValue !== "assistant") {
      throw new Error("Unsupported Responses message role");
    }
    const role = roleValue === "developer" ? "system" : roleValue;
    messages.push({ role, content: contentToText(item.content) });
    return;
  }
  throw new Error(`Unsupported Responses input item type: ${item.type}`);
}

function contentToText(content: unknown): string {
  if (typeof content === "string") return content;
  if (!isUnknownArray(content)) return JSON.stringify(content);
  return content
    .map((part) => {
      if (typeof part === "string") return part;
      if (isRecord(part) && typeof part.text === "string") return part.text;
      return "";
    })
    .join("");
}

function isFunctionTool(tool: ProviderTool): tool is Extract<ProviderTool, { type: "function" }> {
  return tool.type === "function" && typeof tool.name === "string";
}

function stringProperty(value: Record<string, unknown>, key: string): string {
  const property = value[key];
  if (typeof property !== "string" || property === "") throw new Error(`Missing string property: ${key}`);
  return property;
}

function isUnknownArray(value: unknown): value is unknown[] {
  return Array.isArray(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringifyToolOutput(output: unknown): string {
  if (typeof output === "string") return output;
  return JSON.stringify(output);
}
