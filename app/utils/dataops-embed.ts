export type AuthStorageMode = "standalone" | "embedded";
export type DataOpsParentMessageType = "ready" | "authenticated" | "auth-error";

export interface DataOpsParentMessage {
  source: "codex-gateway";
  type: DataOpsParentMessageType;
  message?: string;
}

interface ParentMessenger {
  postMessage(message: DataOpsParentMessage, targetOrigin: string): void;
}

export function parseDataOpsEmbedUrl(input: string | URL) {
  const url = new URL(input);
  const embedded = url.searchParams.get("embedded") === "1";
  const fragment = new URLSearchParams(url.hash.startsWith("#") ? url.hash.slice(1) : url.hash);
  const rawTicket = fragment.get("dataops_ticket")?.trim() ?? "";
  fragment.delete("dataops_ticket");
  url.hash = fragment.toString();
  return {
    embedded,
    ticket: embedded && rawTicket !== "" ? rawTicket : null,
    cleanUrl: url.toString(),
  };
}

export function authStorageKind(mode: AuthStorageMode): "local" | "session" {
  return mode === "embedded" ? "session" : "local";
}

export function createDataOpsParentMessage(
  type: DataOpsParentMessageType,
  message?: string,
): DataOpsParentMessage {
  return message === undefined
    ? { source: "codex-gateway", type }
    : { source: "codex-gateway", type, message };
}

export function postDataOpsParentMessage(
  parent: ParentMessenger,
  targetOrigin: string | null,
  message: DataOpsParentMessage,
): void {
  if (targetOrigin === null) return;
  parent.postMessage(message, targetOrigin);
}

export function dataOpsParentOrigin(referrer: string): string | null {
  try {
    const url = new URL(referrer);
    if (
      (url.protocol !== "http:" && url.protocol !== "https:") ||
      url.username !== "" ||
      url.password !== ""
    ) {
      return null;
    }
    return url.origin;
  } catch {
    return null;
  }
}
