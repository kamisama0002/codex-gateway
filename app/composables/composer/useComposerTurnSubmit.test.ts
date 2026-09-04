import { ref } from "vue";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { ComposerTurnOptions } from "~~/shared/types";
import { useComposerTurnSubmit } from "./useComposerTurnSubmit";

const stores = vi.hoisted(() => ({
  bootstrap: {
    setError: vi.fn(),
    t: (key: string) => key,
    errorLabels: {},
  },
  composer: {
    selectedThreadCollaborationMode: "default",
    selectedThreadSettings: {},
    dismissLatestSelectedPlanPrompt: vi.fn(),
    saveSelectedThreadSettings: vi.fn(),
  },
  navigation: {
    selectedProjectId: 10,
    selectedThreadId: null as string | null,
  },
  threadView: {
    startThread: vi.fn(),
  },
  threadTurns: {
    sendTurn: vi.fn(),
    interruptActiveTurn: vi.fn(),
  },
}));

vi.mock("@/stores/gateway-bootstrap", () => ({
  useGatewayBootstrapStore: () => stores.bootstrap,
}));
vi.mock("@/stores/gateway-composer", () => ({
  useGatewayComposerStore: () => stores.composer,
}));
vi.mock("@/stores/gateway-navigation", () => ({
  useGatewayNavigationStore: () => stores.navigation,
}));
vi.mock("@/stores/gateway-thread-view", () => ({
  useGatewayThreadViewStore: () => stores.threadView,
}));
vi.mock("@/stores/gateway-thread-turns", () => ({
  useGatewayThreadTurnsStore: () => stores.threadTurns,
}));

describe("first-thread composer submission", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal("ref", ref);
    stores.navigation.selectedProjectId = 10;
    stores.navigation.selectedThreadId = null;
    stores.composer.selectedThreadCollaborationMode = "default";
    stores.composer.selectedThreadSettings = {};
  });

  it("preserves the exact draft and options when creation is cancelled", async () => {
    stores.threadView.startThread.mockImplementation(
      (_options: ComposerTurnOptions, context: { signal?: AbortSignal }) =>
        new Promise<null>((resolve) => {
          context.signal?.addEventListener("abort", () => resolve(null), { once: true });
        }),
    );
    const fixture = composerFixture();
    const submission = fixture.submit.submitTurn();
    await Promise.resolve();

    expect(fixture.submit.submittingNewThread.value).toBe(true);
    fixture.submit.cancelPendingThreadStart();
    await submission;

    expect(fixture.turnText.value).toBe("review src/main.ts");
    expect(fixture.attachedFiles.value).toEqual(fixture.originalFiles);
    expect(fixture.fileReferences.value).toEqual(fixture.originalReferences);
    expect(fixture.turnOptions).toEqual({
      model: "gpt-test",
      effort: "high",
      approvalPolicy: "never",
    });
    expect(fixture.clearDraft).not.toHaveBeenCalled();
    expect(stores.threadTurns.sendTurn).not.toHaveBeenCalled();
    expect(fixture.submit.submittingNewThread.value).toBe(false);
  });

  it("sends and clears the exact frozen snapshot after creation succeeds", async () => {
    const started = deferred<string | null>();
    stores.threadView.startThread.mockReturnValue(started.promise);
    const fixture = composerFixture();
    const submission = fixture.submit.submitTurn();
    await Promise.resolve();

    stores.navigation.selectedThreadId = "thread-1";
    started.resolve("thread-1");
    await submission;

    expect(stores.threadTurns.sendTurn).toHaveBeenCalledWith(
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
    );
    expect(fixture.clearDraft).toHaveBeenCalledOnce();
    expect(fixture.turnText.value).toBe("");
    expect(fixture.attachedFiles.value).toEqual([]);
    expect(fixture.fileReferences.value).toEqual([]);
    expect(fixture.submit.submittingNewThread.value).toBe(false);
  });
});

function composerFixture() {
  const turnText = ref("review src/main.ts");
  const originalFiles = [
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
  ];
  const originalReferences = [
    { id: "reference-1", type: "file" as const, path: "src/main.ts", name: "main.ts" },
  ];
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
  const submit = useComposerTurnSubmit({
    turnText,
    attachedFiles,
    fileReferences,
    clearDraft,
    selectedTurnOptions: () => ({ ...turnOptions }),
    collaborationModel: ref("gpt-test"),
    selectedEffort: ref("high"),
    fileReferencesLabel: ref("Attached references"),
  });
  return {
    turnText,
    attachedFiles,
    fileReferences,
    originalFiles,
    originalReferences,
    turnOptions,
    clearDraft,
    submit,
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}
