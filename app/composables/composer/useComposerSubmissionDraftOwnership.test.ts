import { createPinia, setActivePinia } from "pinia";
import { effectScope, ref } from "vue";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const auth = vi.hoisted(() => ({ username: "operator" }));
const transport = vi.hoisted(() => ({
  sendTurn: vi.fn(),
  interruptActiveTurn: vi.fn(),
  startThread: vi.fn(),
}));

vi.mock("@/stores/auth", () => ({ useAuthStore: () => auth }));
vi.mock("@/stores/gateway-bootstrap", () => ({
  useGatewayBootstrapStore: () => ({
    errorLabels: {},
    setError: vi.fn(),
    t: (key: string) => key,
  }),
}));
vi.mock("@/stores/gateway-thread-view", () => ({
  useGatewayThreadViewStore: () => ({ startThread: transport.startThread }),
}));
vi.mock("@/stores/gateway-thread-turns", () => ({
  useGatewayThreadTurnsStore: () => ({
    sendTurn: transport.sendTurn,
    interruptActiveTurn: transport.interruptActiveTurn,
  }),
}));
vi.mock("@codex-gateway/ui/sonner", () => ({
  toast: { error: vi.fn(), success: vi.fn() },
}));

import { useGatewayComposerStore } from "@/stores/gateway-composer";
import { useGatewayNavigationStore } from "@/stores/gateway-navigation";
import { useComposerDraft } from "./useComposerDraft";
import { useComposerTurnSubmit } from "./useComposerTurnSubmit";

describe("composer submission draft ownership", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.stubGlobal("localStorage", new MemoryStorage());
    vi.stubGlobal("sessionStorage", new MemoryStorage());
    vi.stubGlobal("useNuxtApp", () => ({ $i18n: { t: (key: string) => key } }));
    transport.sendTurn.mockReset();
    transport.interruptActiveTurn.mockReset().mockResolvedValue(undefined);
    transport.startThread.mockReset();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("restores a failed draft to its original host without polluting the same thread id on another host", async () => {
    const navigation = useGatewayNavigationStore();
    selectThread(navigation, 1, 11, "shared-thread");
    const original = mountComposer();
    original.draft.turnText.value = "原主机失败草稿";
    const completion = deferred<boolean>();
    let controller: AbortController | undefined;
    transport.sendTurn.mockImplementation(
      (_message: string, _options: unknown, submissionController: AbortController) => {
        controller = submissionController;
        return completion.promise;
      },
    );

    const pending = original.submit.submitTurn();
    await vi.waitFor(() => expect(controller).toBeInstanceOf(AbortController));
    selectThread(navigation, 2, 22, "shared-thread");
    original.scope.stop();
    const abortedOnHostChange = controller?.signal.aborted;
    completion.resolve(false);
    await pending;

    const otherHost = mountComposer();
    expect(otherHost.draft.turnText.value).toBe("");
    otherHost.scope.stop();

    selectThread(navigation, 1, 11, "shared-thread");
    const restored = mountComposer();
    expect(restored.draft.turnText.value).toBe("原主机失败草稿");
    expect(abortedOnHostChange).toBe(true);
    expect(useGatewayComposerStore().failedComposerDraftsByKey).toEqual({});
    restored.scope.stop();
  });

  it("restores a failed draft after selection is cleared and the submitting scope is disposed", async () => {
    const navigation = useGatewayNavigationStore();
    selectThread(navigation, 1, 11, "thread-origin");
    const original = mountComposer();
    original.draft.turnText.value = "清空选择前的草稿";
    const completion = deferred<boolean>();
    transport.sendTurn.mockImplementation(() => completion.promise);

    const pending = original.submit.submitTurn();
    await vi.waitFor(() => expect(transport.sendTurn).toHaveBeenCalledOnce());
    selectThread(navigation, null, null, null);
    original.scope.stop();
    completion.resolve(false);
    await pending;

    selectThread(navigation, 1, 11, "thread-origin");
    const restored = mountComposer();
    expect(restored.draft.turnText.value).toBe("清空选择前的草稿");
    expect(useGatewayComposerStore().failedComposerDraftsByKey).toEqual({});
    restored.scope.stop();
  });
});

function mountComposer() {
  const scope = effectScope();
  const mounted = scope.run(() => {
    const draft = useComposerDraft();
    const submit = useComposerTurnSubmit({
      ...draft,
      selectedTurnOptions: () => ({}),
      collaborationModel: ref(""),
      selectedEffort: ref("default"),
      fileReferencesLabel: ref("附件"),
    });
    return { draft, submit };
  });
  if (mounted === undefined) throw new Error("Composer fixture did not mount");
  return { scope, ...mounted };
}

function selectThread(
  navigation: ReturnType<typeof useGatewayNavigationStore>,
  hostId: number | null,
  projectId: number | null,
  threadId: string | null,
) {
  navigation.selectedHostId = hostId;
  navigation.selectedProjectId = projectId;
  navigation.selectedThreadId = threadId;
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

class MemoryStorage implements Storage {
  private readonly values = new Map<string, string>();

  get length() {
    return this.values.size;
  }

  clear() {
    this.values.clear();
  }

  getItem(key: string) {
    return this.values.get(key) ?? null;
  }

  key(index: number) {
    return [...this.values.keys()][index] ?? null;
  }

  removeItem(key: string) {
    this.values.delete(key);
  }

  setItem(key: string, value: string) {
    this.values.set(key, value);
  }
}
