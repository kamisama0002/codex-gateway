import type { ResponsesOutputItem, ResponsesUsage } from "./types";

export interface ChatStreamDelta {
  choiceIndex?: number;
  index?: number;
  text?: string | null;
  content?: string | null;
  toolIndex?: number;
  toolCall?: { id?: string; name?: string; arguments?: string } | null;
  id?: string;
  name?: string;
  arguments?: string;
  finishReason?: string | null;
  usage?: ResponsesUsage | null;
  choices?: Array<{
    index?: number;
    delta?: {
      content?: string | null;
      tool_calls?: Array<{
        index?: number;
        id?: string;
        function?: { name?: string; arguments?: string };
      }>;
    };
    finish_reason?: string | null;
  }>;
}

export interface ResponsesStreamEvent {
  type: string;
  [key: string]: unknown;
}

interface ToolState {
  id: string;
  name: string;
  arguments: string;
  outputIndex: number;
  added: boolean;
}

interface ChoiceState {
  outputIndex: number;
  text: string;
  textAdded: boolean;
  textDone: boolean;
  tools: Map<number, ToolState>;
  finishReason: string | null;
}

interface NormalizedChunk {
  choiceIndex: number;
  text: string | null | undefined;
  toolIndex: number | undefined;
  toolCall: { id?: string; name?: string; arguments?: string } | null;
  finishReason: string | null | undefined;
}

export class ChatStreamAssembler {
  private readonly choices = new Map<number, ChoiceState>();
  private created = false;
  private completed = false;
  private usage: ResponsesUsage | null = null;
  private nextOutputIndex = 0;

  push(input: ChatStreamDelta): ResponsesStreamEvent[] {
    if (this.completed) throw new Error("Cannot push after stream completion");
    const events: ResponsesStreamEvent[] = [];
    if (!this.created) {
      this.created = true;
      events.push({ type: "response.created", response: { status: "in_progress" } });
    }
    if (input.usage !== undefined) this.usage = input.usage;
    const chunks = normalizeChunks(input);
    for (const chunk of chunks) {
      const choiceIndex = chunk.choiceIndex;
      const choice = this.choice(choiceIndex);
      const text = chunk.text;
      if (text !== undefined && text !== null && text !== "") {
        if (!choice.textAdded) {
          choice.textAdded = true;
          events.push({
            type: "response.output_item.added",
            output_index: choice.outputIndex,
            item: messageItem(choice.outputIndex),
          });
          events.push({
            type: "response.content_part.added",
            output_index: choice.outputIndex,
            content_index: 0,
            part: { type: "output_text", text: "", annotations: [] },
          });
        }
        choice.text += text;
        events.push({
          type: "response.output_text.delta",
          output_index: choice.outputIndex,
          content_index: 0,
          delta: text,
        });
      }
      if (chunk.toolCall !== null && chunk.toolCall !== undefined) {
        const toolIndex = chunk.toolIndex ?? 0;
        const tool = this.tool(choice, toolIndex);
        if (chunk.toolCall.id !== undefined) {
          if (tool.id !== "" && tool.id !== chunk.toolCall.id) throw new Error("Conflicting tool call ID");
          tool.id = chunk.toolCall.id;
        }
        if (chunk.toolCall.name !== undefined) {
          if (tool.name === "") tool.name = chunk.toolCall.name;
          else if (chunk.toolCall.name.startsWith(tool.name)) tool.name = chunk.toolCall.name;
          else if (!tool.name.endsWith(chunk.toolCall.name)) tool.name += chunk.toolCall.name;
        }
        if (!tool.added) {
          tool.added = true;
          events.push({
            type: "response.output_item.added",
            output_index: tool.outputIndex,
            item: functionCallItem(tool.outputIndex, tool.id, tool.name, ""),
          });
        }
        if (chunk.toolCall.arguments !== undefined && chunk.toolCall.arguments !== "") {
          tool.arguments += chunk.toolCall.arguments;
          events.push({
            type: "response.function_call_arguments.delta",
            output_index: tool.outputIndex,
            delta: chunk.toolCall.arguments,
          });
        }
      }
      if (chunk.finishReason !== undefined) choice.finishReason = chunk.finishReason;
    }
    return events;
  }

  finish(): ResponsesStreamEvent[] {
    if (this.completed) return [];
    const events: ResponsesStreamEvent[] = [];
    const output: ResponsesOutputItem[] = [];
    for (const choice of this.choices.values()) {
      if (choice.textAdded && !choice.textDone) {
        choice.textDone = true;
        events.push({ type: "response.output_text.done", output_index: choice.outputIndex, text: choice.text });
        events.push({ type: "response.content_part.done", output_index: choice.outputIndex, content_index: 0, part: { type: "output_text", text: choice.text, annotations: [] } });
        const item = messageItem(choice.outputIndex, choice.text);
        output.push(item);
        events.push({ type: "response.output_item.done", output_index: choice.outputIndex, item });
      }
      for (const tool of choice.tools.values()) {
        if (tool.id === "" || tool.name === "") throw new Error("Incomplete tool call metadata");
        if (!isValidJson(tool.arguments)) throw new Error("Incomplete tool call JSON arguments");
        const item = functionCallItem(tool.outputIndex, tool.id, tool.name, tool.arguments);
        output.push(item);
        events.push({ type: "response.function_call_arguments.done", output_index: tool.outputIndex, arguments: tool.arguments });
        events.push({ type: "response.output_item.done", output_index: tool.outputIndex, item });
      }
    }
    this.completed = true;
    events.push({
      type: "response.completed",
      response: {
        status: this.hasFailure() ? "failed" : "completed",
        output,
        usage: this.usage,
      },
    });
    return events;
  }

  private choice(index: number): ChoiceState {
    let value = this.choices.get(index);
    if (value === undefined) {
      value = { outputIndex: this.nextOutputIndex++, text: "", textAdded: false, textDone: false, tools: new Map(), finishReason: null };
      this.choices.set(index, value);
    }
    return value;
  }

  private tool(choice: ChoiceState, index: number): ToolState {
    let value = choice.tools.get(index);
    if (value === undefined) {
      value = { id: "", name: "", arguments: "", outputIndex: this.nextOutputIndex++, added: false };
      choice.tools.set(index, value);
    }
    return value;
  }

  private hasFailure(): boolean {
    return Array.from(this.choices.values()).some((choice) => choice.finishReason === "error" || choice.finishReason === "content_filter");
  }
}

function normalizeChunks(input: ChatStreamDelta): NormalizedChunk[] {
  if (input.choices !== undefined) {
    return input.choices.flatMap((choice) => {
      const choiceIndex = choice.index ?? 0;
      const chunks: NormalizedChunk[] = [{
        choiceIndex,
        text: choice.delta?.content ?? null,
        toolIndex: undefined,
        toolCall: null,
        finishReason: choice.finish_reason,
      }];
      for (const toolCall of choice.delta?.tool_calls ?? []) {
        chunks.push({
          choiceIndex,
          text: undefined,
          toolIndex: toolCall.index,
          toolCall: {
            id: toolCall.id,
            name: toolCall.function?.name,
            arguments: toolCall.function?.arguments,
          },
          finishReason: undefined,
        });
      }
      return chunks;
    });
  }
  return [{
    choiceIndex: input.choiceIndex ?? input.index ?? 0,
    text: input.text ?? input.content,
    toolIndex: input.toolIndex,
    toolCall: input.toolCall ?? (input.id === undefined && input.name === undefined && input.arguments === undefined ? null : { id: input.id, name: input.name, arguments: input.arguments }),
    finishReason: input.finishReason,
  }];
}

function messageItem(outputIndex: number, text = ""): ResponsesOutputItem {
  return { type: "message", id: `msg_${outputIndex}`, role: "assistant", status: "in_progress", content: [{ type: "output_text", text, annotations: [] }] };
}

function functionCallItem(outputIndex: number, callId: string, name: string, args: string): ResponsesOutputItem {
  return { type: "function_call", id: `fc_${outputIndex}`, status: "in_progress", call_id: callId, name, arguments: args };
}

function isValidJson(value: string): boolean {
  try { JSON.parse(value); return true; } catch { return false; }
}
