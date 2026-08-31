import type {
  AgentRuntimeDriver,
  ApprovalResponseInput,
  InterruptTurnInput,
  PlatformConversation,
  PlatformConversationItem,
  PlatformConversationSnapshot,
  PlatformTurn,
  ReadConversationInput,
  RuntimeCapabilitySnapshot,
  RuntimeHandle,
  StartConversationInput,
  StartTurnInput,
} from "@codex-gateway/agent-runtime-contracts";
import type { HostRecord } from "~~/shared/types";
import { recordFromUnknown, stringFromUnknown } from "~~/shared/utils/records";
import { runWithGatewayUser } from "../state/memory";
import { threadBroker } from "../runtime/broker";
import { runtimeService } from "./runtime-service";

interface ManagedRuntimeServicePort {
  start(userId: number): Promise<{
    userId: number;
    runtimeType: RuntimeHandle["runtimeType"];
    status: RuntimeHandle["status"];
  }>;
  resolveManagedHost(userId: number): Promise<HostRecord>;
}

interface ThreadBrokerPort {
  startThread(host: HostRecord, params: Record<string, unknown>, projectId: null): Promise<unknown>;
  openThread(host: HostRecord, threadId: string, projectId: null): Promise<unknown>;
  startTurn(host: HostRecord, threadId: string, input: { text: string }): Promise<unknown>;
  interruptTurn(host: HostRecord, threadId: string, turnId: string): Promise<unknown>;
  respondToServerRequest(
    host: HostRecord,
    threadId: string,
    input: { requestId: string; result: { decision: "accept" | "decline" } },
  ): Promise<unknown>;
}

interface CodexAppServerDriverOptions {
  runtimeService: ManagedRuntimeServicePort;
  broker: Partial<ThreadBrokerPort>;
  now?: () => Date;
}

export class CodexAppServerDriver implements AgentRuntimeDriver {
  readonly runtimeType = "codex-app-server" as const;
  private readonly now: () => Date;

  constructor(private readonly options: CodexAppServerDriverOptions) {
    this.now = options.now ?? (() => new Date());
  }

  async ensureReady(userId: number): Promise<RuntimeHandle> {
    const status = await this.options.runtimeService.start(userId);
    if (status.runtimeType !== this.runtimeType) {
      throw new Error("Managed runtime service returned a different runtime type");
    }
    return {
      userId: status.userId,
      runtimeType: this.runtimeType,
      status: status.status,
    };
  }

  async getCapabilities(handle: RuntimeHandle): Promise<RuntimeCapabilitySnapshot> {
    if (handle.runtimeType !== this.runtimeType) {
      throw new Error("Runtime handle belongs to a different driver");
    }
    const ready = await this.ensureReady(handle.userId);
    if (ready.status !== "ready") throw new Error("Managed Codex runtime is not ready");
    return {
      runtimeType: this.runtimeType,
      capabilities: { conversations: true, turns: true, approvals: true },
      checkedAt: this.now().toISOString(),
    };
  }

  async startConversation(input: StartConversationInput): Promise<PlatformConversation> {
    const host = await this.readyHost(input.userId);
    return runWithGatewayUser(input.userId, async () => {
      const result = await requiredBrokerMethod(this.options.broker.startThread, "startThread")(
        host,
        conversationStartParams(input.metadata),
        null,
      );
      const thread = requiredRecord(recordFromUnknown(result)?.thread, "thread/start thread");
      return {
        id: requiredString(thread.id, "thread/start thread ID"),
        userId: input.userId,
        createdAt: timestampToIso(thread.createdAt, this.now),
      };
    });
  }

  async readConversation(input: ReadConversationInput): Promise<PlatformConversationSnapshot> {
    const host = await this.readyHost(input.userId);
    return runWithGatewayUser(input.userId, async () => {
      const result = requiredRecord(
        await requiredBrokerMethod(this.options.broker.openThread, "openThread")(
          host,
          input.conversationId,
          null,
        ),
        "thread/open result",
      );
      const thread = requiredRecord(result.thread, "thread/open thread");
      return {
        conversation: {
          id: requiredString(thread.id, "thread/open thread ID"),
          userId: input.userId,
          createdAt: timestampToIso(thread.createdAt, this.now),
        },
        items: platformItems(result.history, this.now),
      };
    });
  }

  async startTurn(input: StartTurnInput): Promise<PlatformTurn> {
    const host = await this.readyHost(input.userId);
    const text = platformInputText(input.input);
    return runWithGatewayUser(input.userId, async () => {
      const result = requiredRecord(
        await requiredBrokerMethod(this.options.broker.startTurn, "startTurn")(
          host,
          input.conversationId,
          { text },
        ),
        "turn/start result",
      );
      const turn = requiredRecord(result.turn, "turn/start turn");
      return {
        id: requiredString(turn.id, "turn/start turn ID"),
        conversationId: input.conversationId,
        status: platformTurnStatus(turn.status),
        createdAt: this.now().toISOString(),
      };
    });
  }

  async interruptTurn(input: InterruptTurnInput): Promise<void> {
    const host = await this.readyHost(input.userId);
    await runWithGatewayUser(input.userId, () =>
      requiredBrokerMethod(this.options.broker.interruptTurn, "interruptTurn")(
        host,
        input.conversationId,
        input.turnId,
      ),
    );
  }

  async respondToApproval(input: ApprovalResponseInput): Promise<void> {
    const host = await this.readyHost(input.userId);
    await runWithGatewayUser(input.userId, () =>
      requiredBrokerMethod(this.options.broker.respondToServerRequest, "respondToServerRequest")(
        host,
        input.conversationId,
        {
          requestId: input.approvalId,
          result: { decision: input.approved ? "accept" : "decline" },
        },
      ),
    );
  }

  private async readyHost(userId: number): Promise<HostRecord> {
    const handle = await this.ensureReady(userId);
    if (handle.status !== "ready") throw new Error("Managed Codex runtime is not ready");
    return this.options.runtimeService.resolveManagedHost(userId);
  }
}

function conversationStartParams(metadata: Record<string, string> | undefined) {
  const cwd = metadata?.cwd;
  return cwd === undefined ? {} : { cwd };
}

function platformInputText(items: PlatformConversationItem[]): string {
  const text = items
    .map((item) => stringFromUnknown(item.data.text)?.trim() ?? "")
    .filter((value) => value.length > 0)
    .join("\n");
  if (text.length === 0) throw new Error("A managed Codex turn requires text input");
  return text;
}

function platformTurnStatus(value: unknown): PlatformTurn["status"] {
  if (value === "inProgress") return "running";
  if (value === "completed" || value === "interrupted" || value === "failed") return value;
  throw new Error("turn/start returned an invalid status");
}

function platformItems(value: unknown, now: () => Date): PlatformConversationItem[] {
  const history = recordFromUnknown(value);
  const thread = recordFromUnknown(history?.thread);
  const turns = Array.isArray(thread?.turns) ? thread.turns : [];
  const items: PlatformConversationItem[] = [];
  for (const turnValue of turns) {
    const turn = recordFromUnknown(turnValue);
    if (turn === null || !Array.isArray(turn.items)) continue;
    const createdAt = timestampToIso(turn.startedAt, now);
    for (const [index, itemValue] of turn.items.entries()) {
      const item = recordFromUnknown(itemValue);
      if (item === null) continue;
      const turnId =
        stringFromUnknown(turn.id) ?? (typeof turn.id === "number" ? String(turn.id) : "turn");
      items.push({
        id: stringFromUnknown(item.id) ?? `${turnId}:${index}`,
        kind: stringFromUnknown(item.type) ?? "unknown",
        createdAt,
        data: { ...item },
      });
    }
  }
  return items;
}

function timestampToIso(value: unknown, now: () => Date): string {
  if (typeof value === "string") {
    const timestamp = Date.parse(value);
    if (Number.isFinite(timestamp)) return new Date(timestamp).toISOString();
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    const milliseconds = value < 10_000_000_000 ? value * 1_000 : value;
    const date = new Date(milliseconds);
    if (Number.isFinite(date.getTime())) return date.toISOString();
  }
  return now().toISOString();
}

function requiredRecord(value: unknown, name: string): Record<string, unknown> {
  const record = recordFromUnknown(value);
  if (record === null) throw new Error(`${name} is missing`);
  return record;
}

function requiredString(value: unknown, name: string): string {
  const text = stringFromUnknown(value);
  if (text === null || text.length === 0) throw new Error(`${name} is missing`);
  return text;
}

function requiredBrokerMethod<T extends (...args: never[]) => Promise<unknown>>(
  method: T | undefined,
  name: string,
): T {
  if (method === undefined) throw new Error(`Codex broker method ${name} is unavailable`);
  return method;
}

export const codexAppServerDriver = new CodexAppServerDriver({
  runtimeService,
  broker: threadBroker,
});
