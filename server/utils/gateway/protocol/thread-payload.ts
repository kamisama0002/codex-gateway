import type {
  ApprovalPolicy,
  GatewayEvent,
  ThreadCollaborationMode,
  ThreadSettingsState,
  ThreadTokenUsageState,
} from "~~/shared/types";
import { threadSettingsFromAppServer } from "~~/shared/runtime/app-server";
import { normalizeTokenUsage } from "~~/shared/token-usage";
import { recordFromUnknown } from "~~/shared/utils/records";
import type { TurnStartInput } from "../runtime/types";

// Codex Desktop Agent / Default: workspace-write plus on-request approvals.
export const DEFAULT_THREAD_SANDBOX = "workspace-write" as const;
// Managed Agent containers already isolate with Docker (read-only rootfs, dropped
// caps, no user namespaces). Inner bubblewrap cannot start there, so skip it.
export const MANAGED_RUNTIME_THREAD_SANDBOX = "danger-full-access" as const;
export const MANAGED_RUNTIME_TURN_SANDBOX_POLICY = {
  type: "externalSandbox",
  networkAccess: "enabled",
} as const;

export function buildAppServerThreadStartParams(
  params: Record<string, unknown>,
  options: { managedRuntime?: boolean } = {},
) {
  const sandbox =
    typeof params.sandbox === "string" && params.sandbox.trim() !== ""
      ? params.sandbox
      : options.managedRuntime === true
        ? MANAGED_RUNTIME_THREAD_SANDBOX
        : DEFAULT_THREAD_SANDBOX;
  return {
    ...params,
    sandbox,
    historyMode: "paginated",
    // Official opt-in fixed at thread creation; thread/resume cannot enable it later.
    experimentalRawEvents: true,
  };
}

export function buildUserInput(input: { text: string; images?: TurnStartInput["images"] }) {
  const userInput: Array<Record<string, unknown>> = [];
  if (input.text.trim() !== "") {
    userInput.push({ type: "text", text: input.text, text_elements: [] });
  }
  for (const image of input.images ?? []) {
    if (image.url !== null && image.url !== undefined && image.url !== "") {
      userInput.push({
        type: "image",
        url: image.url,
        detail: image.detail,
      });
    } else if (image.path !== null && image.path !== undefined && image.path !== "") {
      userInput.push({
        type: "localImage",
        path: image.path,
        detail: image.detail,
      });
    }
  }
  return userInput;
}

export function buildTurnStartParams(
  threadId: string,
  clientUserMessageId: string,
  input: TurnStartInput,
  options: { managedRuntime?: boolean } = {},
) {
  return {
    threadId,
    clientUserMessageId,
    input: buildUserInput(input),
    cwd: input.cwd === "" || input.cwd === undefined ? null : input.cwd,
    model: input.model === "" || input.model === undefined ? null : input.model,
    effort: input.effort === "" || input.effort === undefined ? null : input.effort,
    approvalPolicy: input.approvalPolicy ?? null,
    collaborationMode:
      input.collaborationMode !== null && input.collaborationMode !== undefined
        ? buildAppServerCollaborationMode(input.collaborationMode)
        : null,
    additionalContext: input.additionalContext ?? {},
    ...(options.managedRuntime === true
      ? { sandboxPolicy: MANAGED_RUNTIME_TURN_SANDBOX_POLICY }
      : {}),
  };
}

export function buildAppServerCollaborationMode(input: ThreadCollaborationMode) {
  return {
    mode: input.mode,
    settings: {
      model: input.settings.model,
      reasoning_effort: input.settings.reasoningEffort ?? null,
      developer_instructions: input.settings.developerInstructions ?? null,
    },
  };
}

function normalizeApprovalPolicy(value: unknown): ApprovalPolicy | null {
  return value === "untrusted" || value === "on-request" || value === "never" ? value : null;
}

export function extractThreadSettings(source: unknown): ThreadSettingsState {
  const sourceRecord = recordFromUnknown(source);
  const threadSettings = recordFromUnknown(sourceRecord?.threadSettings);
  const currentProtocolSettings = threadSettingsFromAppServer(threadSettings);
  if (currentProtocolSettings !== null) return currentProtocolSettings;
  const model = threadSettings?.model ?? sourceRecord?.model;
  const effort = threadSettings?.effort ?? sourceRecord?.reasoningEffort;
  return {
    model: typeof model === "string" ? model : null,
    effort: typeof effort === "string" ? effort : null,
    approvalPolicy: normalizeApprovalPolicy(
      threadSettings?.approvalPolicy ?? sourceRecord?.approvalPolicy,
    ),
  };
}

export function latestThreadSettingsFromEvents(events: GatewayEvent[]): ThreadSettingsState | null {
  for (const event of [...events].sort((left, right) => right.id - left.id)) {
    if (event.method !== "thread/settings/updated") continue;
    const params = recordFromUnknown(event.payload.params);
    const settings = threadSettingsFromAppServer(params?.threadSettings);
    if (settings !== null) return settings;
  }
  return null;
}

export function latestTokenUsageFromEvents(events: GatewayEvent[]): ThreadTokenUsageState | null {
  for (const event of [...events].sort((left, right) => right.id - left.id)) {
    if (event.method !== "thread/tokenUsage/updated") {
      continue;
    }
    const params = recordFromUnknown(event.payload.params);
    const tokenUsage = normalizeTokenUsage(params?.tokenUsage);
    if (tokenUsage !== null) {
      return tokenUsage;
    }
  }
  return null;
}

export function threadIdFromNotification(message: unknown) {
  const envelope = recordFromUnknown(message);
  const params = recordFromUnknown(envelope?.params);
  const candidates = [
    params?.threadId,
    recordFromUnknown(params?.thread)?.id,
    recordFromUnknown(params?.turn)?.threadId,
    recordFromUnknown(params?.item)?.threadId,
  ];
  const threadId = candidates.find(
    (candidate) => typeof candidate === "string" || typeof candidate === "number",
  );
  return threadId === undefined ? null : String(threadId);
}
