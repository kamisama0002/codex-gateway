import { effectScope, type Ref } from "vue";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ComposerDraft } from "@/stores/gateway/types";

const auth = vi.hoisted(() => ({ username: "operator" }));
const harness = vi.hoisted(() => ({
  navigation: null as {
    selectedHostId: Ref<number | null>;
    selectedProjectId: Ref<number | null>;
    selectedThreadId: Ref<string | null>;
  } | null,
  composer: null as {
    composerDraftsByKey: Record<string, ComposerDraft>;
    failedComposerDraftsByKey: Record<string, ComposerDraft[]>;
    resetState(): void;
    saveComposerDraft(hostId: number, threadId: string, draft: ComposerDraft): void;
    clearComposerDraft(hostId: number, threadId: string): void;
    queueFailedComposerDraft(hostId: number, threadId: string, draft: ComposerDraft): void;
    takeFailedComposerDrafts(hostId: number, threadId: string): ComposerDraft[];
  } | null,
}));

vi.mock("@/stores/auth", () => ({ useAuthStore: () => auth }));
vi.mock("@/stores/gateway-navigation", async () => {
  const { ref } = await import("vue");
  harness.navigation = {
    selectedHostId: ref<number | null>(null),
    selectedProjectId: ref<number | null>(null),
    selectedThreadId: ref<string | null>(null),
  };
  return { useGatewayNavigationStore: () => harness.navigation };
});
vi.mock("@/stores/gateway-composer", async () => {
  const { reactive } = await import("vue");
  const composerDraftsByKey: Record<string, ComposerDraft> = {};
  const failedComposerDraftsByKey: Record<string, ComposerDraft[]> = {};
  const composer = reactive({
    composerDraftsByKey,
    failedComposerDraftsByKey,
    resetState() {
      this.composerDraftsByKey = {};
      this.failedComposerDraftsByKey = {};
    },
    saveComposerDraft(hostId: number, threadId: string, draft: ComposerDraft) {
      this.composerDraftsByKey[`${hostId}:${threadId}`] = draft;
    },
    clearComposerDraft(hostId: number, threadId: string) {
      delete this.composerDraftsByKey[`${hostId}:${threadId}`];
    },
    queueFailedComposerDraft(hostId: number, threadId: string, draft: ComposerDraft) {
      const key = `${hostId}:${threadId}`;
      this.failedComposerDraftsByKey[key] = [...(this.failedComposerDraftsByKey[key] ?? []), draft];
    },
    takeFailedComposerDrafts(hostId: number, threadId: string) {
      const key = `${hostId}:${threadId}`;
      const drafts = this.failedComposerDraftsByKey[key] ?? [];
      delete this.failedComposerDraftsByKey[key];
      return drafts;
    },
  });
  harness.composer = composer;
  return { useGatewayComposerStore: () => composer };
});

import { useComposerDraft } from "./useComposerDraft";

describe("composer text draft recovery", () => {
  beforeEach(() => {
    auth.username = "operator";
    vi.stubGlobal("sessionStorage", new MemoryStorage());
    harness.composer?.resetState();
  });

  it("restores only text after an unthreaded project composer remounts", () => {
    const navigation = harness.navigation;
    if (!navigation) throw new Error("Navigation fixture did not initialize");
    navigation.selectedHostId.value = 7;
    navigation.selectedProjectId.value = 11;
    navigation.selectedThreadId.value = null;

    const firstScope = effectScope();
    const first = firstScope.run(() => useComposerDraft());
    if (!first) throw new Error("Composer draft did not mount");
    first.turnText.value = "重新登录后继续这段草稿";
    first.attachedFiles.value.push({
      id: "image-1",
      name: "sensitive.png",
      path: "",
      mimeType: "image/png",
      size: 10,
      isImage: true,
      dataUrl: "data:image/png;base64,c2Vuc2l0aXZl",
    });
    firstScope.stop();
    harness.composer?.resetState();

    const secondScope = effectScope();
    const second = secondScope.run(() => useComposerDraft());
    if (!second) throw new Error("Composer draft did not remount");
    expect(second.turnText.value).toBe("重新登录后继续这段草稿");
    expect(second.attachedFiles.value).toEqual([]);
    expect(second.fileReferences.value).toEqual([]);
    secondScope.stop();
  });

  it("restores a queued failed draft only after newer input becomes empty", () => {
    const navigation = harness.navigation;
    const composer = harness.composer;
    if (!navigation || !composer) throw new Error("Composer fixture did not initialize");
    navigation.selectedHostId.value = 7;
    navigation.selectedProjectId.value = 11;
    navigation.selectedThreadId.value = "thread-1";
    const scope = effectScope();
    const draft = scope.run(() => useComposerDraft());
    if (!draft) throw new Error("Composer draft did not mount");
    draft.turnText.value = "用户新输入";

    composer.queueFailedComposerDraft(7, "thread-1", {
      text: "失败的旧请求",
      attachedFiles: [],
      fileReferences: [],
    });
    expect(draft.turnText.value).toBe("用户新输入");

    draft.turnText.value = "";
    expect(draft.turnText.value).toBe("失败的旧请求");
    scope.stop();
  });
});

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
