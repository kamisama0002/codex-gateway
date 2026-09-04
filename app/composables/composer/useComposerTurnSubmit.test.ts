import { effectScope, ref } from "vue";
import { beforeEach, describe, expect, it, vi } from "vitest";

const harness = vi.hoisted(() => ({
  selectedThreadId: null as string | null,
  queuedDrafts: [] as Array<{ threadId: string; text: string }>,
  startThread: vi.fn(),
  sendTurn: vi.fn(),
  interruptActiveTurn: vi.fn(),
}));

vi.mock("@/stores/gateway-bootstrap", () => ({
  useGatewayBootstrapStore: () => ({ setError: vi.fn(), t: (key: string) => key }),
}));
vi.mock("@/stores/gateway-composer", () => ({
  useGatewayComposerStore: () => ({
    selectedThreadCollaborationMode: "default",
    selectedThreadSettings: {},
    dismissLatestSelectedPlanPrompt: vi.fn(),
    queueFailedComposerDraft: (_hostId: number, threadId: string, draft: { text: string }) =>
      harness.queuedDrafts.push({ threadId, text: draft.text }),
    saveSelectedThreadSettings: vi.fn(() => Promise.resolve(true)),
  }),
}));
vi.mock("@/stores/gateway-navigation", () => ({
  useGatewayNavigationStore: () => ({
    selectedHostId: 1,
    selectedProjectId: 2,
    get selectedThreadId() {
      return harness.selectedThreadId;
    },
  }),
}));
vi.mock("@/stores/gateway-thread-view", () => ({
  useGatewayThreadViewStore: () => ({ startThread: harness.startThread }),
}));
vi.mock("@/stores/gateway-thread-turns", () => ({
  useGatewayThreadTurnsStore: () => ({
    sendTurn: harness.sendTurn,
    interruptActiveTurn: harness.interruptActiveTurn,
  }),
}));
vi.mock("@/utils/thread-collaboration-mode", () => ({
  buildThreadCollaborationMode: () => null,
}));

import { useComposerTurnSubmit } from "./useComposerTurnSubmit";

describe("composer submission lifetime", () => {
  beforeEach(() => {
    harness.selectedThreadId = null;
    harness.startThread.mockReset();
    harness.sendTurn.mockReset();
    harness.interruptActiveTurn.mockReset().mockResolvedValue(undefined);
    harness.queuedDrafts.length = 0;
  });

  it("keeps the draft when a new-thread submission is cancelled before creation", async () => {
    harness.startThread.mockImplementation(
      (_options: unknown, _context: unknown, signal: AbortSignal) =>
        new Promise<null>((resolve) => {
          signal.addEventListener("abort", () => resolve(null), { once: true });
        }),
    );
    const fixture = createFixture("营业额分析");
    const pending = fixture.submit.submitTurn();
    await Promise.resolve();

    expect(fixture.submit.submissionPending.value).toBe(true);
    fixture.submit.cancelSubmission();
    await pending;

    expect(fixture.turnText.value).toBe("营业额分析");
    expect(fixture.submit.submissionPending.value).toBe(false);
    expect(harness.sendTurn).not.toHaveBeenCalled();
    fixture.scope.stop();
  });

  it("restores a failed submitted draft when the editor is still empty", async () => {
    harness.selectedThreadId = "thread-1";
    harness.sendTurn.mockResolvedValue(false);
    const fixture = createFixture("营业额分析");

    await fixture.submit.submitTurn();

    expect(fixture.turnText.value).toBe("营业额分析");
    fixture.scope.stop();
  });

  it("does not overwrite newer input and restores the failed draft after it becomes empty", async () => {
    harness.selectedThreadId = "thread-1";
    let finishSend: ((accepted: boolean) => void) | undefined;
    harness.sendTurn.mockImplementation(
      () =>
        new Promise<boolean>((resolve) => {
          finishSend = resolve;
        }),
    );
    const fixture = createFixture("旧请求");
    const pending = fixture.submit.submitTurn();
    await Promise.resolve();
    fixture.turnText.value = "用户新输入";

    finishSend?.(false);
    await pending;
    expect(fixture.turnText.value).toBe("用户新输入");

    fixture.turnText.value = "";
    expect(fixture.turnText.value).toBe("旧请求");
    fixture.scope.stop();
  });

  it("keeps the controller alive while the centered composer hands off to its new thread", async () => {
    let fixture: ReturnType<typeof createFixture>;
    let receivedController: AbortController | undefined;
    harness.startThread.mockImplementation(
      (
        _options: unknown,
        context: { onStarted?: (threadId: string) => void },
        _signal: AbortSignal,
      ) => {
        if (context.onStarted === undefined) throw new Error("Missing new-thread handoff callback");
        context.onStarted("thread-new");
        harness.selectedThreadId = "thread-new";
        fixture.scope.stop();
        return Promise.resolve("thread-new");
      },
    );
    harness.sendTurn.mockImplementation(
      (_message: string, _options: unknown, controller: AbortController) => {
        receivedController = controller;
        return Promise.resolve(false);
      },
    );
    fixture = createFixture("营业额分析");

    await fixture.submit.submitTurn();

    expect(receivedController?.signal.aborted).toBe(false);
    expect(harness.queuedDrafts).toEqual([{ threadId: "thread-new", text: "营业额分析" }]);
  });
});

function createFixture(initialText: string) {
  const scope = effectScope();
  const result = scope.run(() => {
    const turnText = ref(initialText);
    const attachedFiles = ref([]);
    const fileReferences = ref([]);
    const clearDraft = () => {
      turnText.value = "";
      attachedFiles.value = [];
      fileReferences.value = [];
    };
    return {
      turnText,
      submit: useComposerTurnSubmit({
        turnText,
        attachedFiles,
        fileReferences,
        clearDraft,
        selectedTurnOptions: () => ({}),
        collaborationModel: ref(""),
        selectedEffort: ref("default"),
        fileReferencesLabel: ref("附件"),
      }),
    };
  });
  if (result === undefined) throw new Error("Composer fixture did not mount");
  return { scope, ...result };
}
