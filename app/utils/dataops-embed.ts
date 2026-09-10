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
  const dinkyUrl = embedded ? (url.searchParams.get("dinky_url")?.trim() ?? null) : null;
  const fragment = new URLSearchParams(url.hash.startsWith("#") ? url.hash.slice(1) : url.hash);
  // Support both new identity token and legacy dataops_ticket
  const identity = fragment.get("identity")?.trim() ?? null;
  const rawTicket = identity ? null : (fragment.get("dataops_ticket")?.trim() ?? "");
  if (identity) fragment.delete("identity");
  if (rawTicket) fragment.delete("dataops_ticket");
  url.hash = fragment.toString();
  return {
    embedded,
    ticket: embedded && rawTicket !== "" ? rawTicket : null,
    identity: embedded && identity !== null ? identity : null,
    dinkyUrl,
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
