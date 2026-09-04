import { ref, watch } from "vue";

import { storeToRefs } from "pinia";
import type { UploadedFileRecord } from "~~/shared/types";
import { useGatewayComposerStore } from "@/stores/gateway-composer";
import { useGatewayNavigationStore } from "@/stores/gateway-navigation";
import { useAuthStore } from "@/stores/auth";
import { selectedThreadKey } from "@/stores/gateway/thread-utils/identity";
import type { ComposerFileReference } from "@/stores/gateway/types";
import {
  readComposerTextDraft,
  textDraftScopeKey,
  writeComposerTextDraft,
} from "./text-draft-storage";

export type ComposerAttachment = UploadedFileRecord & { id: string; dataUrl?: string };

export function useComposerDraft() {
  const composer = useGatewayComposerStore();
  const navigation = useGatewayNavigationStore();
  const auth = useAuthStore();
  const { selectedHostId, selectedProjectId, selectedThreadId } = storeToRefs(navigation);
  const turnText = ref("");
  const attachedFiles = ref<ComposerAttachment[]>([]);
  const fileReferences = ref<ComposerFileReference[]>([]);
  let activeHostId: number | null = null;
  let activeThreadId: string | null = null;
  let activeTextDraftKey: string | null = null;
  let syncingDraft = false;

  watch(
    [selectedHostId, selectedProjectId, selectedThreadId],
    ([hostId, projectId, threadId]) => {
      syncingDraft = true;
      activeHostId = hostId;
      activeThreadId = threadId;
      activeTextDraftKey = textDraftScopeKey(hostId, projectId, threadId);
      const key = selectedThreadKey(hostId, threadId);
      const draft = key === null ? undefined : composer.composerDraftsByKey[key];
      turnText.value = draft?.text ?? readComposerTextDraft(auth.username, activeTextDraftKey);
      attachedFiles.value = [...(draft?.attachedFiles ?? [])];
      fileReferences.value = [...(draft?.fileReferences ?? [])];
      syncingDraft = false;
      restoreQueuedFailedDrafts();
    },
    // Scope changes and local v-model writes are one transaction. A deferred watcher can observe
    // the new navigation scope while persisting the old textarea value and leak a draft between
    // threads, so both hydration and persistence intentionally run synchronously.
    { flush: "sync", immediate: true },
  );

  watch(
    [turnText, attachedFiles, fileReferences],
    () => {
      if (syncingDraft) return;
      writeComposerTextDraft(auth.username, activeTextDraftKey, turnText.value);
      if (activeHostId === null || activeThreadId === null) return;
      composer.saveComposerDraft(activeHostId, activeThreadId, {
        text: turnText.value,
        attachedFiles: attachedFiles.value,
        fileReferences: fileReferences.value,
      });
    },
    { deep: true, flush: "sync" },
  );

  watch(
    [
      turnText,
      attachedFiles,
      fileReferences,
      () => {
        const key = selectedThreadKey(activeHostId, activeThreadId);
        return key === null ? 0 : (composer.failedComposerDraftsByKey[key]?.length ?? 0);
      },
    ],
    restoreQueuedFailedDrafts,
    { deep: true, flush: "sync" },
  );

  function clearDraft() {
    syncingDraft = true;
    turnText.value = "";
    attachedFiles.value = [];
    fileReferences.value = [];
    writeComposerTextDraft(auth.username, activeTextDraftKey, "");
    if (activeHostId !== null && activeThreadId !== null) {
      composer.clearComposerDraft(activeHostId, activeThreadId);
    }
    syncingDraft = false;
    restoreQueuedFailedDrafts();
  }

  function restoreQueuedFailedDrafts() {
    if (
      syncingDraft ||
      activeHostId === null ||
      activeThreadId === null ||
      turnText.value !== "" ||
      attachedFiles.value.length > 0 ||
      fileReferences.value.length > 0
    ) {
      return;
    }
    const drafts = composer.takeFailedComposerDrafts(activeHostId, activeThreadId);
    if (drafts.length === 0) return;
    syncingDraft = true;
    turnText.value = drafts
      .map((draft) => draft.text)
      .filter((text) => text !== "")
      .join("\n\n");
    attachedFiles.value = drafts.flatMap((draft) => draft.attachedFiles);
    fileReferences.value = drafts.flatMap((draft) => draft.fileReferences);
    writeComposerTextDraft(auth.username, activeTextDraftKey, turnText.value);
    composer.saveComposerDraft(activeHostId, activeThreadId, {
      text: turnText.value,
      attachedFiles: attachedFiles.value,
      fileReferences: fileReferences.value,
    });
    syncingDraft = false;
  }

  return {
    turnText,
    attachedFiles,
    fileReferences,
    clearDraft,
  };
}
