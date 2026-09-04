import type { GatewayThread } from "~~/shared/types";
import { firstNonEmptyString } from "~~/shared/utils/strings";
import { recordFromUnknown } from "~~/shared/utils/records";
import { threadItemText } from "@/utils/thread-items";
import { unknownGatewayErrorFromError } from "../errors";

const DERIVED_THREAD_TITLE_MAX_LENGTH = 36;

export interface ErrorMessageLabels {
  scope: string;
  host: string;
  ssh: string;
  auth: string;
  password: string;
  passwordConfigured: string;
  passwordMissing: string;
  proxy: string;
  proxyEnabled: string;
  proxyNone: string;
}

const defaultErrorLabels: ErrorMessageLabels = {
  scope: "scope",
  host: "host",
  ssh: "ssh",
  auth: "auth",
  password: "password",
  passwordConfigured: "configured",
  passwordMissing: "missing",
  proxy: "proxy",
  proxyEnabled: "enabled",
  proxyNone: "none",
};

export function messageFromError(
  error: unknown,
  fallback: string,
  labels: ErrorMessageLabels = defaultErrorLabels,
) {
  return unknownGatewayErrorFromError(error, fallback, labels).toDisplayMessage();
}

export function errorMessageLabels(t: (key: string) => string): ErrorMessageLabels {
  return {
    scope: t("app.errorScope"),
    host: t("app.errorHost"),
    ssh: t("app.errorSsh"),
    auth: t("app.errorAuth"),
    password: t("app.errorPassword"),
    passwordConfigured: t("app.errorPasswordConfigured"),
    passwordMissing: t("app.errorPasswordMissing"),
    proxy: t("app.errorProxy"),
    proxyEnabled: t("app.errorProxyEnabled"),
    proxyNone: t("app.errorProxyNone"),
  };
}

export function pinnedKey(hostId: number, threadId: string) {
  return `${hostId}:${threadId}`;
}

export function selectedThreadKey(hostId: number | null, threadId: string | null) {
  return hostId !== null && threadId !== null && threadId !== ""
    ? pinnedKey(hostId, threadId)
    : null;
}

export function selectedThreadScope(hostId: number | null, threadId: string | null) {
  if (hostId === null || threadId === null || threadId === "") return null;
  return { hostId, threadId };
}

export function threadIdFromParams(params: Record<string, unknown>) {
  const value = params.threadId;
  return typeof value === "string" || typeof value === "number" ? String(value) : null;
}

export interface ThreadTitleFallbacks {
  empty: string;
  untitled: string;
}

const defaultThreadTitleFallbacks: ThreadTitleFallbacks = {
  empty: "Untitled",
  untitled: "Untitled",
};

export function threadTitleFallbacks(t: (key: string) => string): ThreadTitleFallbacks {
  return {
    empty: t("app.newChat"),
    untitled: t("app.untitledThread"),
  };
}

type ThreadTitleSource = {
  id?: string | number;
  threadId?: string | number;
  title?: string | null;
  name?: string | null;
  preview?: string | null;
};

type ThreadHistorySource = {
  thread?: {
    turns?: readonly {
      id?: unknown;
      items?: readonly unknown[];
    }[];
  };
};

export function isEmptyThreadHistory(history: ThreadHistorySource | null | undefined) {
  return Array.isArray(history?.thread?.turns) && history.thread.turns.length === 0;
}

export function explicitTitleForThread(thread: ThreadTitleSource | null | undefined) {
  if (thread === null || thread === undefined) return null;
  const identity = thread.id ?? thread.threadId;
  const storedTitle = firstNonEmptyString([thread.title]);
  if (
    storedTitle !== null &&
    storedTitle !== String(identity ?? "") &&
    storedTitle !== "Untitled"
  ) {
    return storedTitle;
  }
  return firstNonEmptyString([thread.name, thread.preview]);
}

export function titleFromThreadHistory(history: ThreadHistorySource | null | undefined) {
  for (const turn of history?.thread?.turns ?? []) {
    for (const item of turn.items ?? []) {
      const record = recordFromUnknown(item);
      if (record?.type !== "userMessage") continue;
      const text = threadItemText(record).replaceAll(/\s+/g, " ").trim();
      if (text === "") continue;
      const characters = Array.from(text);
      return characters.length > DERIVED_THREAD_TITLE_MAX_LENGTH
        ? `${characters.slice(0, DERIVED_THREAD_TITLE_MAX_LENGTH).join("")}...`
        : text;
    }
  }
  return null;
}

type ReusableEmptyThread = Pick<
  GatewayThread,
  "hostId" | "id" | "projectId" | "recencyAt" | "turns" | "updatedAt"
> & {
  history: ThreadHistorySource | null;
};

export function findReusableEmptyThread<T extends ReusableEmptyThread>(
  threads: readonly T[],
  scope: { hostId: number; projectId: number },
): T | null {
  let newest: T | null = null;
  for (const thread of threads) {
    if (
      thread.hostId !== scope.hostId ||
      thread.projectId !== scope.projectId ||
      !isEmptyThreadHistory(thread.history)
    ) {
      continue;
    }
    if (
      newest === null ||
      Number(thread.recencyAt ?? thread.updatedAt ?? 0) >
        Number(newest.recencyAt ?? newest.updatedAt ?? 0)
    ) {
      newest = thread;
    }
  }
  return newest;
}

export function titleForThread(
  thread: ThreadTitleSource | null | undefined,
  fallbacks: ThreadTitleFallbacks = defaultThreadTitleFallbacks,
  history?: ThreadHistorySource | null,
) {
  if (thread === null || thread === undefined) return fallbacks.untitled;
  const label = explicitTitleForThread(thread);
  if (label !== null) return label;
  if (isEmptyThreadHistory(history)) return fallbacks.empty;
  return titleFromThreadHistory(history) ?? fallbacks.untitled;
}

export function sortThreads(threads: GatewayThread[]) {
  return [...threads].sort((left, right) => {
    if (left.pinned !== right.pinned) {
      return left.pinned === true ? -1 : 1;
    }
    return (
      Number(right.recencyAt ?? right.updatedAt ?? 0) -
      Number(left.recencyAt ?? left.updatedAt ?? 0)
    );
  });
}
