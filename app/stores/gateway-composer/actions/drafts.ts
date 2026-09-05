import { useGatewayComposerStore } from "@/stores/gateway-composer";
import type { ComposerDraft } from "@/stores/gateway/types";
import { selectedThreadKey } from "@/stores/gateway/thread-utils/identity";

export function createComposerActions() {
  return {
    saveComposerDraft(hostId: number, threadId: string, draft: ComposerDraft) {
      const composer = useGatewayComposerStore();
      const key = selectedThreadKey(hostId, threadId);
      if (key === null) return;
      composer.composerDraftsByKey = {
        ...composer.composerDraftsByKey,
        [key]: {
          text: draft.text,
          attachedFiles: [...draft.attachedFiles],
          fileReferences: [...draft.fileReferences],
        },
      };
    },

    clearComposerDraft(hostId: number, threadId: string) {
      const composer = useGatewayComposerStore();
      const key = selectedThreadKey(hostId, threadId);
      if (key === null) return;
      const { [key]: _removed, ...drafts } = composer.composerDraftsByKey;
      composer.composerDraftsByKey = drafts;
    },

    queueFailedComposerDraft(hostId: number, threadId: string, draft: ComposerDraft) {
      const composer = useGatewayComposerStore();
      const key = selectedThreadKey(hostId, threadId);
      if (key === null) return;
      composer.failedComposerDraftsByKey = {
        ...composer.failedComposerDraftsByKey,
        [key]: [...(composer.failedComposerDraftsByKey[key] ?? []), cloneDraft(draft)],
      };
    },

    takeFailedComposerDrafts(hostId: number, threadId: string) {
      const composer = useGatewayComposerStore();
      const key = selectedThreadKey(hostId, threadId);
      if (key === null) return [];
      const queued = composer.failedComposerDraftsByKey[key] ?? [];
      if (queued.length === 0) return [];
      const { [key]: _removed, ...remaining } = composer.failedComposerDraftsByKey;
      composer.failedComposerDraftsByKey = remaining;
      return queued.map(cloneDraft);
    },
  };
}

function cloneDraft(draft: ComposerDraft): ComposerDraft {
  return {
    text: draft.text,
    attachedFiles: [...draft.attachedFiles],
    fileReferences: [...draft.fileReferences],
  };
}
