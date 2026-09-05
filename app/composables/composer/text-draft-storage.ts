type TextDrafts = Record<string, string>;

export function textDraftScopeKey(
  hostId: number | null,
  projectId: number | null,
  threadId: string | null,
) {
  if (hostId === null) return null;
  if (threadId !== null && threadId !== "") return `${hostId}:thread:${threadId}`;
  return projectId === null ? null : `${hostId}:project:${projectId}:new`;
}

export function readComposerTextDraft(username: string, scopeKey: string | null) {
  if (typeof sessionStorage === "undefined" || scopeKey === null) return "";
  return readDrafts(username)[scopeKey] ?? "";
}

export function writeComposerTextDraft(username: string, scopeKey: string | null, text: string) {
  if (typeof sessionStorage === "undefined" || scopeKey === null) return;
  const key = storageKey(username);
  const drafts = readDrafts(username);
  if (text === "") delete drafts[scopeKey];
  else drafts[scopeKey] = text;
  try {
    if (Object.keys(drafts).length === 0) sessionStorage.removeItem(key);
    else sessionStorage.setItem(key, JSON.stringify(drafts));
  } catch {
    // Browsers can deny session storage; the in-memory draft remains authoritative for this mount.
  }
}

function readDrafts(username: string): TextDrafts {
  try {
    const raw = sessionStorage.getItem(storageKey(username));
    if (raw === null) return {};
    const parsed: unknown = JSON.parse(raw);
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    return Object.fromEntries(
      Object.entries(parsed).filter(
        (entry): entry is [string, string] => typeof entry[1] === "string",
      ),
    );
  } catch {
    return {};
  }
}

function storageKey(username: string) {
  const account = username.trim() === "" ? "signed-out" : encodeURIComponent(username.trim());
  return `codex-gateway:${account}:composer-text-drafts`;
}
