import { recordFromUnknown } from "./utils/records";

export const THREAD_TITLE_FALLBACK_MAX_WORDS = 5;
export const THREAD_TITLE_FALLBACK_MAX_BYTES = 40;
export const THREAD_TITLE_MAX_BYTES = 80;
export const THREAD_TITLE_MODEL_MAX_INPUT_BYTES = 4096;
export const THREAD_TITLE_MODEL_MAX_OUTPUT_TOKENS = 64;
export const THREAD_TITLE_MODEL_TIMEOUT_MS = 60_000;

/* eslint-disable no-control-regex -- Title normalization must remove terminal and C0/C1 controls. */
const OSC_SEQUENCE = /(?:\u001B\]|\u009D)(?:(?!\u0007|\u001B\\)[\s\S])*(?:\u0007|\u001B\\|$)/gu;
const CSI_SEQUENCE = /(?:\u001B\[|\u009B)[0-?]*[ -/]*[@-~]/gu;
const ESC_SEQUENCE = /\u001B[@-_]/gu;
const CONTROL_CHARACTER = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]/gu;
/* eslint-enable no-control-regex */
const DIRECTIONAL_CONTROL = /[\u200B\u200E\u200F\u202A-\u202E\u2060-\u2064\u2066-\u206F\uFEFF]/gu;

type ThreadHistorySource = {
  thread?: {
    turns?: readonly {
      id?: unknown;
      items?: readonly unknown[];
    }[];
  };
};

export function normalizeThreadTitle(input: string, maxBytes = THREAD_TITLE_MAX_BYTES) {
  return truncateTitleUtf8(cleanTitleText(input), maxBytes).trimEnd();
}

export function fallbackThreadTitle(input: string) {
  const words = cleanTitleText(input)
    .split(" ")
    .filter(Boolean)
    .slice(0, THREAD_TITLE_FALLBACK_MAX_WORDS);
  return truncateTitleUtf8(words.join(" "), THREAD_TITLE_FALLBACK_MAX_BYTES).trimEnd();
}

export function firstUserMessageText(history: ThreadHistorySource | null | undefined) {
  for (const turn of history?.thread?.turns ?? []) {
    for (const item of turn.items ?? []) {
      const record = recordFromUnknown(item);
      if (record?.type !== "userMessage" || !Array.isArray(record.content)) continue;
      const text = record.content
        .flatMap((part) => {
          const content = recordFromUnknown(part);
          if (typeof content?.text === "string") return [content.text];
          if (typeof content?.content === "string") return [content.content];
          return [];
        })
        .join("\n");
      if (normalizeThreadTitle(text, Number.MAX_SAFE_INTEGER) !== "") return text;
    }
  }
  return null;
}

export function titleFromThreadHistory(history: ThreadHistorySource | null | undefined) {
  const message = firstUserMessageText(history);
  return message === null ? null : fallbackThreadTitle(message) || null;
}

export function truncateTitleUtf8(input: string, maxBytes: number) {
  if (!Number.isInteger(maxBytes) || maxBytes <= 0) {
    throw new Error("maxBytes must be a positive integer");
  }
  const encoder = new TextEncoder();
  if (encoder.encode(input).byteLength <= maxBytes) return input;
  let output = "";
  let used = 0;
  for (const character of input) {
    const bytes = encoder.encode(character).byteLength;
    if (used + bytes > maxBytes) break;
    output += character;
    used += bytes;
  }
  return output;
}

function cleanTitleText(input: string) {
  return input
    .replace(OSC_SEQUENCE, "")
    .replace(CSI_SEQUENCE, "")
    .replace(ESC_SEQUENCE, "")
    .replace(CONTROL_CHARACTER, "")
    .replace(DIRECTIONAL_CONTROL, "")
    .replaceAll(/\s+/gu, " ")
    .trim();
}
