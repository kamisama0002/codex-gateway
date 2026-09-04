import type { ProviderStore } from "../providers/provider-store";
import { providerStore } from "../providers/provider-store";
import { toChatCompletionRequest } from "../providers/protocol/responses-to-chat";
import type { ResponsesRequestInput } from "../providers/protocol/types";
import {
  normalizeThreadTitle,
  THREAD_TITLE_MAX_BYTES,
  THREAD_TITLE_MODEL_MAX_INPUT_BYTES,
  THREAD_TITLE_MODEL_MAX_OUTPUT_TOKENS,
  THREAD_TITLE_MODEL_TIMEOUT_MS,
} from "~~/shared/thread-title";
import { recordFromUnknown, stringFromUnknown } from "~~/shared/utils/records";

export interface ModelThreadTitleInput {
  userId: number;
  model: string;
  message: string;
  signal: AbortSignal;
}

export interface ModelThreadTitleOptions {
  store?: Pick<ProviderStore, "listForUser" | "getWithSecret">;
  fetch?: typeof globalThis.fetch;
  timeoutMs?: number;
}

const TITLE_SYSTEM_PROMPT = [
  "Create a concise title for an AI coding-assistant session from the supplied human message.",
  "Return only the title on one line, in plain text of natural language, with no quotes, prefix, explanation, Markdown, XML, code, or terminal control codes.",
  "Use the language of the message.",
  "Aim for about 5 words in non-CJK languages or 10 CJK characters.",
].join("\n");

export async function generateModelThreadTitle(
  input: ModelThreadTitleInput,
  options: ModelThreadTitleOptions = {},
) {
  input.signal.throwIfAborted();
  const store = options.store ?? providerStore;
  const model = store
    .listForUser(input.userId)
    .find((candidate) => candidate.modelId === input.model);
  if (model === undefined) throw new Error("No granted Provider model matches the current turn");
  const provider = store.getWithSecret(model.providerId);
  if (provider === null || !provider.enabled) throw new Error("Title Provider is unavailable");

  const framedInput = `Generate the session title from this JSON array of human messages:\n${JSON.stringify([{ text: input.message }])}`;
  if (Buffer.byteLength(framedInput, "utf8") > THREAD_TITLE_MODEL_MAX_INPUT_BYTES) {
    throw new Error("First message exceeds the title input budget");
  }
  const payload: ResponsesRequestInput = {
    model: model.modelId,
    instructions: TITLE_SYSTEM_PROMPT,
    input: framedInput,
    max_output_tokens: THREAD_TITLE_MODEL_MAX_OUTPUT_TOKENS,
    stream: false,
  };
  const path = provider.wireApi === "responses" ? "/responses" : "/chat/completions";
  const body =
    provider.wireApi === "responses"
      ? payload
      : toChatCompletionRequest(payload, model.capabilities);
  const controller = new AbortController();
  const abort = () => controller.abort(input.signal.reason);
  if (input.signal.aborted) abort();
  else input.signal.addEventListener("abort", abort, { once: true });
  const timeout = setTimeout(
    () => controller.abort(new Error("Thread title generation timed out")),
    options.timeoutMs ?? THREAD_TITLE_MODEL_TIMEOUT_MS,
  );
  try {
    const response = await (options.fetch ?? globalThis.fetch)(`${provider.baseUrl}${path}`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${provider.apiKey}`,
        "content-type": "application/json",
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`Title Provider request failed with HTTP ${response.status}`);
    const value: unknown = await response.json();
    const text =
      provider.wireApi === "responses"
        ? responsesOutputText(value)
        : chatCompletionOutputText(value);
    const title = normalizeThreadTitle(text, THREAD_TITLE_MAX_BYTES);
    if (title === "") throw new Error("Title Provider returned no usable text");
    return title;
  } finally {
    clearTimeout(timeout);
    input.signal.removeEventListener("abort", abort);
  }
}

function responsesOutputText(value: unknown) {
  const response = recordFromUnknown(value);
  const direct = stringFromUnknown(response?.output_text);
  if (direct !== null && direct !== "") return direct;
  const output = Array.isArray(response?.output) ? response.output : [];
  return output
    .flatMap((item) => {
      const message = recordFromUnknown(item);
      const content = Array.isArray(message?.content) ? message.content : [];
      return content.flatMap((part) => {
        const record = recordFromUnknown(part);
        const text = stringFromUnknown(record?.text);
        return text === null ? [] : [text];
      });
    })
    .join(" ");
}

function chatCompletionOutputText(value: unknown) {
  const response = recordFromUnknown(value);
  const choices = Array.isArray(response?.choices) ? response.choices : [];
  return choices
    .flatMap((choice) => {
      const message = recordFromUnknown(recordFromUnknown(choice)?.message);
      const content = stringFromUnknown(message?.content);
      return content === null ? [] : [content];
    })
    .join(" ");
}
