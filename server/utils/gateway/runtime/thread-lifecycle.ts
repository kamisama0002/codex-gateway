import { z } from "zod";
import type { GatewayThread, HostRecord } from "~~/shared/types";
import { appServerThreadSchema } from "~~/shared/runtime/app-server";
import { gatewayThreadFromAppServer } from "../protocol/gateway-thread";
import { threadMetadataStore } from "../state/thread-metadata";
import { threadSnapshotStore } from "../state/thread-snapshots";
import { threadCatalogEvents } from "./thread-catalog-events";

const threadUnarchiveResponseSchema = z
  .object({
    thread: appServerThreadSchema,
  })
  .loose();

export interface ThreadLifecycleRegistry {
  getHostClient(host: HostRecord): Promise<{
    request(method: string, params?: unknown): Promise<unknown>;
  }>;
  close(hostId: number, threadId: string): void;
}

export class ThreadLifecycleService {
  constructor(private readonly registry: ThreadLifecycleRegistry) {}

  async archive(host: HostRecord, threadId: string, userId: number) {
    try {
      await this.request(host, "thread/archive", { threadId });
    } catch (error: unknown) {
      if (isMissingRolloutError(error)) throw new ThreadRolloutNotReadyError();
      throw error;
    }
    this.afterRemove(host, threadId, userId, "archived");
  }

  async delete(host: HostRecord, threadId: string, userId: number) {
    await this.request(host, "thread/delete", { threadId });
    threadMetadataStore.delete(host.id, threadId);
    this.afterRemove(host, threadId, userId, "deleted");
  }

  async unarchive(host: HostRecord, threadId: string, userId: number): Promise<GatewayThread> {
    const restored = threadUnarchiveResponseSchema.parse(
      await this.request(host, "thread/unarchive", { threadId }),
    );
    const projectId = threadMetadataStore.get(host.id, threadId)?.projectId ?? null;
    const thread = gatewayThreadFromAppServer(host.id, projectId, restored.thread);
    threadCatalogEvents.publish(userId, {
      hostId: host.id,
      threadId,
      action: "unarchived",
      thread,
    });
    return thread;
  }

  private afterRemove(
    host: HostRecord,
    threadId: string,
    userId: number,
    action: "archived" | "deleted",
  ) {
    this.registry.close(host.id, threadId);
    threadSnapshotStore.delete(host.id, threadId);
    threadCatalogEvents.publish(userId, {
      hostId: host.id,
      threadId,
      action,
      thread: null,
    });
  }

  private async request(host: HostRecord, method: string, params: { threadId: string }) {
    const client = await this.registry.getHostClient(host);
    return client.request(method, params);
  }
}

function isMissingRolloutError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return message.includes("no rollout found for thread id");
}

export class ThreadRolloutNotReadyError extends Error {
  readonly code = "thread_rollout_not_ready";

  constructor() {
    super("thread_rollout_not_ready");
    this.name = "ThreadRolloutNotReadyError";
  }
}
