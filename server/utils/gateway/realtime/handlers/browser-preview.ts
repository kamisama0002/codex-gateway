import type { BrowserPreviewTarget, RealtimeClientMessage } from "~~/shared/types";
import { browserPreviewEvents } from "../../browser-preview/browser-preview-events";
import { browserPreviewManager } from "../../browser-preview/browser-preview-manager";
import { hostStore } from "../../state/hosts";
import {
  authenticatedUserId,
  runPeerScoped,
  sendRealtimePeerMessage,
  stateFor,
  type RealtimePeer,
} from "../peer-state";
import { runtimeLog } from "../../runtime/runtime-log";
import { runtimeService } from "../../runtime-manager/runtime-service";
import { MANAGED_RUNTIME_HOST_ID } from "~~/shared/runtime/managed-runtime";

export function openBrowserPreview(
  peer: RealtimePeer,
  request: Extract<RealtimeClientMessage, { type: "browser.open" }>,
) {
  const state = stateFor(peer);
  const host = runPeerScoped(peer, () => hostStore.getWithSecret(request.hostId));
  if (!host) throw new Error(`Host ${request.hostId} is unavailable`);
  const session = browserPreviewManager.open(
    requireOwnerId(state.browserOwnerId),
    authenticatedUserId(peer),
    host,
    browserPreviewTarget(request),
  );
  runtimeLog("browser preview session opened", {
    hostId: host.id,
    hostName: host.name,
    sessionId: session.sessionId,
    panelId: request.panelId,
    targetOrigin: new URL(session.targetUrl).origin,
  });
  sendRealtimePeerMessage(peer, { type: "browser.opened", requestId: request.requestId, session });
}

export async function openRuntimeBrowserPreview(
  peer: RealtimePeer,
  request: Extract<RealtimeClientMessage, { type: "browser.runtime.open" }>,
) {
  const state = stateFor(peer);
  const userId = authenticatedUserId(peer);
  await runtimeService.start(userId);
  // Managed hosts are intentionally excluded from hostStore. Resolve the host
  // from the runtime service after start so an idle-released runtime can be
  // provisioned again before the browser relay is opened.
  const host = await runtimeService.resolveManagedHost(userId);
  const target = await waitForRuntimeBrowser(userId);
  const session = browserPreviewManager.open(
    requireOwnerId(state.browserOwnerId),
    authenticatedUserId(peer),
    host,
    {
      targetType: "runtime",
      hostId: MANAGED_RUNTIME_HOST_ID,
      projectId: request.projectId,
      threadId: request.threadId,
      panelId: request.panelId,
      targetUrl: "http://runtime-browser.internal:6080/vnc.html",
    },
    target.relayTarget,
  );
  runtimeLog("managed runtime browser session opened", {
    userId: authenticatedUserId(peer),
    runtimeId: target.runtimeId,
    sessionId: session.sessionId,
    panelId: request.panelId,
  });
  sendRealtimePeerMessage(peer, { type: "browser.opened", requestId: request.requestId, session });
}

async function waitForRuntimeBrowser(userId: number) {
  let lastError: unknown;
  for (let attempt = 0; attempt < 40; attempt += 1) {
    try {
      return await runtimeService.resolveBrowser(userId);
    } catch (error) {
      lastError = error;
      if (!(error instanceof Error) || !error.message.includes("runtime_browser_unavailable")) {
        throw error;
      }
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
  }
  throw lastError instanceof Error ? lastError : new Error("runtime_browser_unavailable");
}

function browserPreviewTarget(
  request: Extract<RealtimeClientMessage, { type: "browser.open" }>,
): BrowserPreviewTarget {
  // The request also owns `type` and `requestId`. Persisting it through structural typing leaks
  // those transport fields into browser.opened.session, which the strict client schema must reject.
  return {
    ...(request.targetType === undefined ? {} : { targetType: request.targetType }),
    hostId: request.hostId,
    projectId: request.projectId,
    threadId: request.threadId,
    panelId: request.panelId,
    targetUrl: request.targetUrl,
    allowInsecureTls: request.allowInsecureTls,
  };
}

export function closeBrowserPreview(
  peer: RealtimePeer,
  request: Extract<RealtimeClientMessage, { type: "browser.close" }>,
) {
  browserPreviewManager.close(authenticatedUserId(peer), request.sessionId);
  sendRealtimePeerMessage(peer, {
    type: "browser.closed",
    requestId: request.requestId,
    sessionId: request.sessionId,
  });
}

export function allowInsecureBrowserPreviewTls(
  peer: RealtimePeer,
  request: Extract<RealtimeClientMessage, { type: "browser.allowInsecureTls" }>,
) {
  const session = browserPreviewManager.setInsecureTls(
    authenticatedUserId(peer),
    request.sessionId,
    request.allowInsecureTls,
  );
  sendRealtimePeerMessage(peer, { type: "browser.opened", requestId: request.requestId, session });
}

export function subscribeBrowserPreviewEvents(peer: RealtimePeer) {
  const state = stateFor(peer);
  state.browserPreviewUnsubscribe?.();
  state.browserPreviewUnsubscribe = browserPreviewEvents.subscribe(
    authenticatedUserId(peer),
    (event) => {
      if (event.type === "frame-policy") {
        sendRealtimePeerMessage(peer, {
          type: "browser.framePolicyWarning",
          sessionId: event.sessionId,
          policy: event.policy,
          value: event.value,
        });
        return;
      }
      sendRealtimePeerMessage(peer, {
        type: "browser.resourceFailed",
        sessionId: event.sessionId,
        failure: event.failure,
      });
    },
  );
}

function requireOwnerId(ownerId: string | undefined) {
  if (ownerId === undefined || ownerId === "") {
    throw new Error("Browser preview owner is unavailable");
  }
  return ownerId;
}
