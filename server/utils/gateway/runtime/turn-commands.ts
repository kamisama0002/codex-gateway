import type { HostRecord } from "~~/shared/types";
import { INITIAL_TURN_PAGE_LIMIT } from "~~/shared/config";
import { randomUUID } from "node:crypto";
import type { ServerRequestResponseInput, TurnStartInput, TurnSteerInput } from "./types";
import type { ControllerRegistry } from "./controller-registry";
import { isManagedRuntimeHost } from "~~/shared/runtime/managed-runtime";
import { buildTurnStartParams, buildUserInput } from "../protocol/thread-payload";
import { runtimeLog } from "./runtime-log";
import type { ThreadOpenService } from "./thread-open-service";
import { recordFromUnknown, stringFromUnknown } from "~~/shared/utils/records";
import { trimmedOrFallback } from "~~/shared/utils/strings";
import { parseTurnStartResponse, parseTurnSteerResponse } from "~~/shared/runtime/app-server";
import { threadRuntimeEvents } from "./thread-runtime-events";
import { interruptTurnAndReconcile } from "./turn-interrupt-reconcile";

const TURN_START_TIMEOUT_MS = 45_000;

export class ThreadTurnCommandService {
  constructor(
    private readonly registry: ControllerRegistry,
    private readonly openService: ThreadOpenService,
  ) {}

  async startTurn(host: HostRecord, threadId: string, input: TurnStartInput) {
    const clientUserMessageId = trimmedOrFallback(
      input.clientUserMessageId,
      `gateway-${randomUUID()}`,
    );
    return this.registry.withScopedSubscription(host, threadId, async (controller) => {
      try {
        const result = await controller.enqueue(() =>
          controller.client.request(
            "turn/start",
            buildTurnStartParams(threadId, clientUserMessageId, input, {
              managedRuntime: isManagedRuntimeHost(host),
            }),
            TURN_START_TIMEOUT_MS,
            parseTurnStartResponse,
          ),
        );
        controller.markActiveMainThread();
        return result;
      } catch (error) {
        // A provider failure can leave app-server waiting without emitting turn/started or
        // turn/completed. Publish a terminal Gateway event so connected and reconnected clients
        // clear their submitting state instead of showing "thinking" forever.
        try {
          threadRuntimeEvents.record(host.id, threadId, "error", {
            method: "error",
            params: {
              threadId,
              turnId: null,
              willRetry: false,
              error: {
                message: turnStartFailureMessage(error),
              },
            },
          });
        } catch (eventError) {
          runtimeLog("failed to publish turn start failure", {
            hostId: host.id,
            threadId,
            message: eventError instanceof Error ? eventError.message : String(eventError),
          });
        }
        throw error;
      }
    });
  }

  async steerTurn(host: HostRecord, threadId: string, input: TurnSteerInput) {
    const clientUserMessageId = trimmedOrFallback(
      input.clientUserMessageId,
      `gateway-steer-${randomUUID()}`,
    );
    return this.registry
      .withScopedSubscription(host, threadId, async (controller) => {
        const result = await controller.enqueue(() =>
          controller.client.request(
            "turn/steer",
            {
              threadId,
              expectedTurnId: input.expectedTurnId,
              clientUserMessageId,
              input: buildUserInput(input),
              additionalContext: input.additionalContext ?? {},
            },
            120_000,
            parseTurnSteerResponse,
          ),
        );
        controller.markActiveMainThread();
        return result;
      })
      .catch(async (error) => {
        if (isNoActiveTurnToSteer(error)) {
          runtimeLog("refreshing thread after stale steer state", {
            hostId: host.id,
            threadId,
            expectedTurnId: input.expectedTurnId,
          });
          await this.openService.refreshThreadState(host, threadId, null, INITIAL_TURN_PAGE_LIMIT);
        }
        throw error;
      });
  }

  async interruptTurn(host: HostRecord, threadId: string, turnId: string) {
    return this.registry.withScopedSubscription(host, threadId, (controller) =>
      controller.enqueue(() =>
        interruptTurnAndReconcile({
          turnId,
          request: (activeTurnId) =>
            controller.client.request("turn/interrupt", { threadId, turnId: activeTurnId }),
          onStaleTurn: (currentTurnId) => {
            runtimeLog("retrying interrupt with current active turn", {
              hostId: host.id,
              threadId,
              turnId,
              currentTurnId,
            });
          },
          onIdle: () => this.reconcileIdleInterrupt(host, threadId, turnId),
        }),
      ),
    );
  }

  async respondToServerRequest(
    host: HostRecord,
    threadId: string,
    input: ServerRequestResponseInput,
  ) {
    const client = await this.registry.getHostClient(host);
    if (input.error) {
      client.respondError(input.requestId, input.error.code, input.error.message, input.error.data);
    } else {
      client.respond(input.requestId, input.result ?? {});
    }
  }

  private async reconcileIdleInterrupt(host: HostRecord, threadId: string, turnId: string) {
    runtimeLog("reconciling interrupt with no active turn", {
      hostId: host.id,
      threadId,
      turnId,
    });
    try {
      await this.openService.refreshThreadRuntimeStatus(host, threadId);
    } catch (error) {
      runtimeLog("idle interrupt refresh failed", {
        hostId: host.id,
        threadId,
        message: error instanceof Error ? error.message : String(error),
      });
      threadRuntimeEvents.record(host.id, threadId, "thread/status/changed", {
        method: "thread/status/changed",
        params: { threadId, status: "completed" },
      });
    }
  }
}

function turnStartFailureMessage(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  if (message.toLowerCase().includes("timed out")) {
    return "Model request timed out before the turn started. Please retry.";
  }
  return message;
}

function isNoActiveTurnToSteer(error: unknown) {
  const record = recordFromUnknown(error);
  const message = stringFromUnknown(record?.message);
  return (
    record?.rpcMethod === "turn/steer" &&
    message !== null &&
    message.toLowerCase().includes("no active turn")
  );
}
