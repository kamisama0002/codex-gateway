import { effectScope, ref } from "vue";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { ComposerTurnOptions } from "~~/shared/types";

const harness = vi.hoisted(() => ({
  selectedThreadId: null as string | null,
  queuedDrafts: [] as Array<{ threadId: string; text: string }>,
  startThread: vi.fn(),
  sendTurn: vi.fn(),
  interruptActiveTurn: vi.fn(),
  composer: {
    selectedThreadCollaborationMode: "default",
    selectedThreadSettings: {},
    dismissLatestSelectedPlanPrompt: vi.fn(),
    saveSelectedThreadSettings: vi.fn(() => Promise.resolve(true)),
  },
}));

vi.mock("@/stores/gateway-bootstrap", () => ({
  useGatewayBootstrapStore: () => ({ setError: vi.fn(), t: (key: string) => key }),
}));
vi.mock("@/stores/gateway-composer", () => ({
  useGatewayComposerStore: () => ({
    ...harness.composer,
    queueFailedComposerDraft: (_hostId: number, threadId: string, draft: { text: string }) =>
      harness.queuedDrafts.push({ threadId, text: draft.text }),
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
    harness.composer.selectedThreadCollaborationMode = "default";
    harness.composer.selectedThreadSettings = {};
  });

  it("preserves the exact first-thread draft and options when creation is cancelled", async () => {
    harness.startThread.mockImplementation(
      (_options: ComposerTurnOptions, _context: unknown, signal: AbortSignal) =>
        new Promise<null>((resolve) => {
          signal.addEventListener("abort", () => resolve(null), { once: true });
        }),
    );
    const fixture = createFixture("review src/main.ts", { withAttachments: true });
    const pending = fixture.submit.submitTurn();
    await Promise.resolve();

    expect(fixture.submit.submittingNewThread.value).toBe(true);
    expect(fixture.submit.submissionPending.value).toBe(true);
    fixture.submit.cancelSubmission();
    await pending;

    expect(fixture.turnText.value).toBe("review src/main.ts");
    expect(fixture.attachedFiles.value).toEqual(fixture.originalFiles);
    expect(fixture.fileReferences.value).toEqual(fixture.originalReferences);
    expect(fixture.turnOptions).toEqual({
      model: "gpt-test",
      effort: "high",
      approvalPolicy: "never",
    });
    expect(fixture.clearDraft).not.toHaveBeenCalled();
    expect(harness.sendTurn).not.toHaveBeenCalled();
    expect(harness.interruptActiveTurn).not.toHaveBeenCalled();
    expect(fixture.submit.submittingNewThread.value).toBe(false);
    expect(fixture.submit.submissionPending.value).toBe(false);
    fixture.scope.stop();
  });

  it("sends and clears the exact frozen snapshot after first-thread creation succeeds", async () => {
    const started = deferred<string | null>();
    harness.startThread.mockReturnValue(started.promise);
    harness.sendTurn.mockResolvedValue(true);
    const fixture = createFixture("review src/main.ts", { withAttachments: true });
    const pending = fixture.submit.submitTurn();
    await Promise.resolve();

    harness.selectedThreadId = "thread-1";
    started.resolve("thread-1");
    await pending;

    expect(harness.sendTurn).toHaveBeenCalledWith(
      "review src/main.ts\n\nAttached references\n- notes.txt: /tmp/notes.txt",
      {
        model: "gpt-test",
        effort: "high",
        approvalPolicy: "never",
        collaborationMode: undefined,
        images: [{ url: "data:image/png;base64,AA==", detail: "auto" }],
        files: [fixture.originalFiles[1]],
        references: [{ type: "file", path: "src/main.ts", name: "main.ts" }],
      },
      expect.any(AbortController),
    );
    expect(fixture.clearDraft).toHaveBeenCalledOnce();
    expect(fixture.turnText.value).toBe("");
    expect(fixture.attachedFiles.value).toEqual([]);
    expect(fixture.fileReferences.value).toEqual([]);
    expect(fixture.submit.submittingNewThread.value).toBe(false);
    expect(fixture.submit.submissionPending.value).toBe(false);
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
    const sent = deferred<boolean>();
    harness.sendTurn.mockReturnValue(sent.promise);
    const fixture = createFixture("旧请求");
    const pending = fixture.submit.submitTurn();
    await Promise.resolve();
    fixture.turnText.value = "用户新输入";

    sent.resolve(false);
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

  it("keeps an empty existing-thread submission alive across the centered composer remount", async () => {
    harness.selectedThreadId = "thread-empty";
    const sent = deferred<boolean>();
    let receivedController: AbortController | undefined;
    harness.sendTurn.mockImplementation(
      (_message: string, _options: unknown, controller: AbortController) => {
        receivedController = controller;
        return sent.promise;
      },
    );
    const fixture = createFixture("继续空会话");
    const pending = fixture.submit.submitTurn();
    await vi.waitFor(() => expect(receivedController).toBeInstanceOf(AbortController));

    fixture.scope.stop();
    const abortedDuringRemount = receivedController?.signal.aborted;
    sent.resolve(false);
    await pending;

    expect(abortedDuringRemount).toBe(false);
    expect(harness.queuedDrafts).toEqual([{ threadId: "thread-empty", text: "继续空会话" }]);
  });
});

function createFixture(initialText: string, options: { withAttachments?: boolean } = {}) {
  const scope = effectScope();
  const result = scope.run(() => {
    const turnText = ref(initialText);
    const originalFiles =
      options.withAttachments === true
        ? [
            {
              id: "image-1",
              name: "preview.png",
              path: "",
              mimeType: "image/png",
              size: 1,
              isImage: true,
              dataUrl: "data:image/png;base64,AA==",
            },
            {
              id: "file-1",
              name: "notes.txt",
              path: "/tmp/notes.txt",
              mimeType: "text/plain",
              size: 2,
              isImage: false,
            },
          ]
        : [];
    const originalReferences =
      options.withAttachments === true
        ? [{ id: "reference-1", type: "file" as const, path: "src/main.ts", name: "main.ts" }]
        : [];
    const attachedFiles = ref([...originalFiles]);
    const fileReferences = ref([...originalReferences]);
    const turnOptions: ComposerTurnOptions = {
      model: "gpt-test",
      effort: "high",
      approvalPolicy: "never",
    };
    const clearDraft = vi.fn(() => {
      turnText.value = "";
      attachedFiles.value = [];
      fileReferences.value = [];
    });
    return {
      turnText,
      attachedFiles,
      fileReferences,
      originalFiles,
      originalReferences,
      turnOptions,
      clearDraft,
      submit: useComposerTurnSubmit({
        turnText,
        attachedFiles,
        fileReferences,
        clearDraft,
        selectedTurnOptions: () => ({ ...turnOptions }),
        collaborationModel: ref("gpt-test"),
        selectedEffort: ref("high"),
        fileReferencesLabel: ref("Attached references"),
      }),
    };
  });
  if (result === undefined) throw new Error("Composer fixture did not mount");
  return { scope, ...result };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}
