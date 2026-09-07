import { createHash } from "node:crypto";
import { Mutex } from "async-mutex";
import type {
  ActualCapabilityState,
  CapabilityChange,
  CapabilityChangeResult,
  CapabilityContext,
  CapabilityDefinition,
  CapabilitySyncReason,
  CapabilitySyncRecord,
  CapabilitySyncResult,
  CodexCapabilityContext,
  HostRecord,
} from "~~/shared/types";
import { capabilityStore } from "./store";
import { capabilitySyncStore } from "./sync-store";
import { CodexCapabilityAdapter, planChanges } from "./codex-adapter";
import { StoredSkillArtifactReader } from "./skill-artifact-reader";
import { threadBroker } from "../runtime/broker";
import { runtimeService } from "../runtime-manager/runtime-service";
import { projectStore } from "../state/projects";
import { runWithGatewayUser } from "../state/memory";
import { ensureUserConfigLoaded } from "../http/errors";

export interface CapabilitySyncStorePort {
  get(userId: number, projectId: number | null): Promise<CapabilitySyncRecord | null>;
  begin(
    userId: number,
    projectId: number | null,
    desiredHash: string,
  ): Promise<CapabilitySyncRecord>;
  finish(
    userId: number,
    projectId: number | null,
    input: {
      actualHash: string;
      status: "succeeded" | "failed";
      results: CapabilityChangeResult[];
      safeError: string | null;
    },
  ): Promise<CapabilitySyncRecord>;
  list(userId?: number): Promise<CapabilitySyncRecord[]>;
}

interface CapabilityReconcilerOptions {
  catalog: {
    listDesiredForContext(context: CapabilityContext): Promise<CapabilityDefinition[]>;
  };
  adapter: {
    readActual(host: HostRecord, context: CodexCapabilityContext): Promise<ActualCapabilityState>;
    applyChange(host: HostRecord, change: CapabilityChange): Promise<CapabilityChangeResult>;
  };
  syncStore: CapabilitySyncStorePort;
  resolveHost(userId: number): Promise<HostRecord>;
  resolveContext(userId: number, projectId: number | null): Promise<CodexCapabilityContext>;
  runInUserScope<T>(userId: number, operation: () => Promise<T>): Promise<T>;
}

export class CapabilityReconciler {
  private readonly locks = new Map<number, Mutex>();

  constructor(private readonly options: CapabilityReconcilerOptions) {}

  async reconcile(
    input: {
      userId: number;
      projectId: number | null;
      reason: CapabilitySyncReason;
    },
    hostOverride?: HostRecord,
  ): Promise<CapabilitySyncResult> {
    const userId = positiveId(input.userId, "user ID");
    const projectId = nullablePositiveId(input.projectId, "project ID");
    return await this.lockFor(userId).runExclusive(
      async () =>
        await this.options.runInUserScope(
          userId,
          async () => await this.reconcileLocked({ ...input, userId, projectId }, hostOverride),
        ),
    );
  }

  private async reconcileLocked(
    input: {
      userId: number;
      projectId: number | null;
      reason: CapabilitySyncReason;
    },
    hostOverride?: HostRecord,
  ): Promise<CapabilitySyncResult> {
    const desired = await this.options.catalog.listDesiredForContext(input);
    const desiredHash = sha256(desired);
    const host = hostOverride ?? (await this.options.resolveHost(input.userId));
    const context = await this.options.resolveContext(input.userId, input.projectId);
    const actualBefore = await this.options.adapter.readActual(host, context);
    const actualBeforeHash = sha256(actualBefore);
    const changes = planChanges(desired, actualBefore);
    const previous = await this.options.syncStore.get(input.userId, input.projectId);

    if (
      changes.length === 0 &&
      previous?.status === "succeeded" &&
      previous.desiredHash === desiredHash &&
      previous.actualHash === actualBeforeHash
    ) {
      return {
        ...input,
        desiredHash,
        actualHash: actualBeforeHash,
        status: "succeeded",
        results: [],
        remainingChanges: [],
        skipped: true,
      };
    }

    await this.options.syncStore.begin(input.userId, input.projectId, desiredHash);
    const results: CapabilityChangeResult[] = [];
    for (const change of changes) {
      results.push(await this.options.adapter.applyChange(host, change));
    }

    const actualAfter =
      changes.length === 0 ? actualBefore : await this.options.adapter.readActual(host, context);
    const actualHash = sha256(actualAfter);
    const remainingChanges = planChanges(desired, actualAfter);
    const status = remainingChanges.length === 0 ? "succeeded" : "failed";
    const safeError = status === "succeeded" ? null : "capability_sync_incomplete";
    await this.options.syncStore.finish(input.userId, input.projectId, {
      actualHash,
      status,
      results,
      safeError,
    });

    return {
      ...input,
      desiredHash,
      actualHash,
      status,
      results,
      remainingChanges,
      skipped: false,
    };
  }

  private lockFor(userId: number) {
    let lock = this.locks.get(userId);
    if (lock === undefined) {
      lock = new Mutex();
      this.locks.set(userId, lock);
    }
    return lock;
  }
}

let productionReconciler: CapabilityReconciler | null = null;

export async function reconcileUserRuntime(input: {
  userId: number;
  projectId: number | null;
  reason: CapabilitySyncReason;
}) {
  return await defaultCapabilityReconciler().reconcile(input);
}

export async function reconcileUserRuntimeWithHost(
  host: HostRecord,
  input: {
    userId: number;
    projectId: number | null;
    reason: CapabilitySyncReason;
  },
) {
  return await defaultCapabilityReconciler().reconcile(input, host);
}

function defaultCapabilityReconciler() {
  if (productionReconciler !== null) return productionReconciler;
  productionReconciler = new CapabilityReconciler({
    catalog: capabilityStore,
    adapter: new CodexCapabilityAdapter(
      threadBroker.capabilityRuntime(),
      new StoredSkillArtifactReader(capabilityStore),
    ),
    syncStore: capabilitySyncStore,
    resolveHost: (userId) => runtimeService.resolveManagedHost(userId),
    resolveContext: async (_userId, projectId) => {
      if (projectId === null) return { cwd: "/workspace", threadId: null };
      const project = projectStore.get(projectId);
      if (project === null) throw new Error("Capability project not found");
      return { cwd: project.remotePath, threadId: null };
    },
    runInUserScope: async (userId, operation) =>
      await runWithGatewayUser(userId, async () => {
        await ensureUserConfigLoaded(userId);
        return await operation();
      }),
  });
  return productionReconciler;
}

function sha256(value: unknown) {
  return createHash("sha256")
    .update(JSON.stringify(canonicalValue(value)))
    .digest("hex");
}

function canonicalValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalValue);
  if (typeof value !== "object" || value === null) return value;
  const entries = Object.keys(value)
    .sort((left, right) => left.localeCompare(right))
    .map((key) => [key, canonicalValue(Reflect.get(value, key))]);
  return Object.fromEntries(entries);
}

function positiveId(value: number, label: string) {
  if (!Number.isInteger(value) || value <= 0) throw new Error(`Invalid ${label}`);
  return value;
}

function nullablePositiveId(value: number | null, label: string) {
  return value === null ? null : positiveId(value, label);
}
