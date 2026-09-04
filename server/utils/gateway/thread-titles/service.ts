import type { HostRecord } from "~~/shared/types";
import {
  fallbackThreadTitle,
  firstUserMessageText,
  normalizeThreadTitle,
} from "~~/shared/thread-title";
import { trimmedOrNull } from "~~/shared/utils/strings";
import { isAppServerSubAgentThread } from "~~/shared/runtime/app-server";
import { runWithGatewayUser } from "../state/memory";
import { threadMetadataStore } from "../state/thread-metadata";
import { threadSnapshotStore } from "../state/thread-snapshots";
import { threadBroker } from "../runtime/broker";
import { generateModelThreadTitle } from "./model-title";
import { projectThreadTitle } from "./projection";

export interface FirstPromptTitleCandidate {
  userId: number;
  host: HostRecord;
  threadId: string;
  message: string;
  fallback: string;
  model: string | null;
}

export interface AutomaticThreadTitlePorts {
  inspect(
    hostId: number,
    threadId: string,
  ): {
    eligible: boolean;
    name: string | null;
    hasUserMessage: boolean;
  };
  generate(input: FirstPromptTitleCandidate, signal: AbortSignal): Promise<string>;
  renameAndProject(input: FirstPromptTitleCandidate, title: string): Promise<void>;
  runForUser<T>(userId: number, callback: () => T): T;
  warn(input: { userId: number; hostId: number; threadId: string; message: string }): void;
}

interface PendingTitleJob {
  controller: AbortController;
  promise: Promise<void>;
}

export class AutomaticThreadTitleService {
  private readonly jobs = new Map<string, PendingTitleJob>();

  constructor(private readonly ports: AutomaticThreadTitlePorts) {}

  prepare(input: {
    userId: number;
    host: HostRecord;
    threadId: string;
    message: string;
    model?: string | null;
  }): FirstPromptTitleCandidate | null {
    const message = normalizeThreadTitle(input.message, Number.MAX_SAFE_INTEGER);
    const fallback = fallbackThreadTitle(message);
    if (message === "" || fallback === "") return null;
    const state = this.ports.inspect(input.host.id, input.threadId);
    if (!state.eligible || state.name !== null || state.hasUserMessage) return null;
    return { ...input, message, fallback, model: trimmedOrNull(input.model) };
  }

  start(candidate: FirstPromptTitleCandidate) {
    const key = titleJobKey(candidate.userId, candidate.host.id, candidate.threadId);
    const existing = this.jobs.get(key);
    if (existing !== undefined) return existing.promise;
    const controller = new AbortController();
    const job: PendingTitleJob = { controller, promise: Promise.resolve() };
    this.jobs.set(key, job);
    job.promise = Promise.resolve()
      .then(() =>
        this.ports.runForUser(candidate.userId, () => this.generateAndApply(candidate, controller)),
      )
      .finally(() => {
        if (this.jobs.get(key) === job) this.jobs.delete(key);
      });
    return job.promise;
  }

  cancel(userId: number, hostId: number, threadId: string) {
    this.jobs
      .get(titleJobKey(userId, hostId, threadId))
      ?.controller.abort(new Error("User rename superseded automatic title generation"));
  }

  private async generateAndApply(
    candidate: FirstPromptTitleCandidate,
    controller: AbortController,
  ) {
    try {
      if (controller.signal.aborted) return;
      const beforeFallback = this.ports.inspect(candidate.host.id, candidate.threadId);
      if (!beforeFallback.eligible || beforeFallback.name !== null) return;
      await this.ports.renameAndProject(candidate, candidate.fallback);
      if (controller.signal.aborted || candidate.model === null) return;
      const title = await this.ports.generate(candidate, controller.signal);
      if (controller.signal.aborted) return;
      const current = this.ports.inspect(candidate.host.id, candidate.threadId);
      if (!current.eligible || current.name !== candidate.fallback) return;
      await this.ports.renameAndProject(candidate, title);
    } catch (error: unknown) {
      if (controller.signal.aborted) return;
      this.ports.warn({
        userId: candidate.userId,
        hostId: candidate.host.id,
        threadId: candidate.threadId,
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }
}

export const automaticThreadTitleService = new AutomaticThreadTitleService({
  inspect(hostId, threadId) {
    const metadata = threadMetadataStore.get(hostId, threadId);
    const snapshot = threadSnapshotStore.get(hostId, threadId);
    return {
      eligible:
        metadata !== null &&
        snapshot !== null &&
        metadata.parentThreadId === null &&
        !isAppServerSubAgentThread(snapshot.thread),
      name: trimmedOrNull(metadata?.name) ?? trimmedOrNull(snapshot?.thread.name),
      hasUserMessage: firstUserMessageText(snapshot?.history) !== null,
    };
  },
  generate(candidate, signal) {
    if (candidate.model === null) throw new Error("Current turn has no Provider model");
    return generateModelThreadTitle({
      userId: candidate.userId,
      model: candidate.model,
      message: candidate.message,
      signal,
    });
  },
  async renameAndProject(candidate, title) {
    await threadBroker.renameThread(candidate.host, candidate.threadId, title);
    projectThreadTitle(candidate.userId, candidate.host.id, candidate.threadId, title);
  },
  runForUser: runWithGatewayUser,
  warn(input) {
    console.warn("[gateway] automatic thread title generation failed", input);
  },
});

function titleJobKey(userId: number, hostId: number, threadId: string) {
  return `${userId}:${hostId}:${threadId}`;
}
