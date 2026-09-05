import type { HostRecord, QueuedSubmission } from "~~/shared/types";
import {
  parseEmptyAppServerResponse,
  parseThreadQueueAddResponse,
  parseThreadQueueDeleteResponse,
  parseThreadQueueListResponse,
  parseThreadQueueStartResponse,
  parseThreadQueueUpdateResponse,
  parseTurnSteerResponse,
} from "~~/shared/runtime/app-server";

const QUEUE_RPC_TIMEOUT_MS = 120_000;

interface ThreadQueueController {
  client: {
    request<T>(
      method: string,
      params: unknown,
      timeoutMs: number,
      parse: (value: unknown) => T,
    ): Promise<T>;
  };
  enqueue<T>(operation: () => Promise<T>): Promise<T>;
  markActiveMainThread(): void;
}

export interface ThreadQueueControllerRegistry {
  withScopedSubscription<T>(
    host: HostRecord,
    threadId: string,
    operation: (controller: ThreadQueueController) => Promise<T>,
  ): Promise<T>;
}

export class ThreadQueueService {
  constructor(private readonly registry: ThreadQueueControllerRegistry) {}

  async list(host: HostRecord, threadId: string) {
    return this.registry.withScopedSubscription(host, threadId, (controller) =>
      controller.enqueue(async () => {
        const submissions: QueuedSubmission[] = [];
        let cursor: string | null = null;
        do {
          const page: ReturnType<typeof parseThreadQueueListResponse> =
            await controller.client.request(
              "thread/queue/list",
              { threadId, cursor, limit: 100 },
              QUEUE_RPC_TIMEOUT_MS,
              parseThreadQueueListResponse,
            );
          submissions.push(...page.data);
          cursor = page.nextCursor;
        } while (cursor !== null);
        return submissions;
      }),
    );
  }

  async add(
    host: HostRecord,
    threadId: string,
    input: Array<Record<string, unknown>>,
    clientUserMessageId: string,
  ) {
    return this.request(
      host,
      threadId,
      "thread/queue/add",
      {
        threadId,
        input,
        clientUserMessageId,
      },
      parseThreadQueueAddResponse,
    );
  }

  async update(
    host: HostRecord,
    threadId: string,
    queuedSubmissionId: string,
    input: Array<Record<string, unknown>>,
  ) {
    return this.request(
      host,
      threadId,
      "thread/queue/update",
      {
        threadId,
        queuedSubmissionId,
        input,
      },
      parseThreadQueueUpdateResponse,
    );
  }

  async delete(host: HostRecord, threadId: string, queuedSubmissionId: string) {
    return this.request(
      host,
      threadId,
      "thread/queue/delete",
      {
        threadId,
        queuedSubmissionId,
      },
      parseThreadQueueDeleteResponse,
    );
  }

  async reorder(host: HostRecord, threadId: string, queuedSubmissionIds: string[]) {
    return this.request(
      host,
      threadId,
      "thread/queue/reorder",
      {
        threadId,
        queuedSubmissionIds,
      },
      parseEmptyAppServerResponse,
    );
  }

  async start(host: HostRecord, threadId: string, queuedSubmissionId?: string | null) {
    return this.request(
      host,
      threadId,
      "thread/queue/start",
      {
        threadId,
        queuedSubmissionId: queuedSubmissionId ?? null,
      },
      parseThreadQueueStartResponse,
    );
  }

  async steer(
    host: HostRecord,
    threadId: string,
    queuedSubmissionId: string,
    expectedTurnId: string,
  ) {
    return this.registry.withScopedSubscription(host, threadId, (controller) =>
      controller.enqueue(async () => {
        let cursor: string | null = null;
        let submission: QueuedSubmission | undefined;
        do {
          const page: ReturnType<typeof parseThreadQueueListResponse> =
            await controller.client.request(
              "thread/queue/list",
              { threadId, cursor, limit: 100 },
              QUEUE_RPC_TIMEOUT_MS,
              parseThreadQueueListResponse,
            );
          submission = page.data.find((item) => item.id === queuedSubmissionId);
          cursor = page.nextCursor;
        } while (submission === undefined && cursor !== null);
        if (submission === undefined) throw new Error("Queued submission not found");
        const steered = await controller.client.request(
          "turn/steer",
          {
            threadId,
            expectedTurnId,
            clientUserMessageId: submission.clientUserMessageId,
            input: submission.input,
            additionalContext: {},
          },
          QUEUE_RPC_TIMEOUT_MS,
          parseTurnSteerResponse,
        );
        controller.markActiveMainThread();
        const deleted = await controller.client.request(
          "thread/queue/delete",
          { threadId, queuedSubmissionId },
          QUEUE_RPC_TIMEOUT_MS,
          parseThreadQueueDeleteResponse,
        );
        return { turnId: steered.turnId ?? expectedTurnId, deleted: deleted.deleted };
      }),
    );
  }

  private async request<T>(
    host: HostRecord,
    threadId: string,
    method: string,
    params: Record<string, unknown>,
    parse: (value: unknown) => T,
  ) {
    return this.registry.withScopedSubscription(host, threadId, (controller) =>
      controller.enqueue(() =>
        controller.client.request(method, params, QUEUE_RPC_TIMEOUT_MS, parse),
      ),
    );
  }
}
