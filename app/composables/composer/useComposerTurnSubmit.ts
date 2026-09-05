import { computed, onScopeDispose, ref, watch, type Ref } from "vue";

import type { ComposerTurnOptions } from "~~/shared/types";
import type { ComposerFileReference } from "@/stores/gateway/types";
import { useGatewayBootstrapStore } from "@/stores/gateway-bootstrap";
import { useGatewayComposerStore } from "@/stores/gateway-composer";
import { useGatewayNavigationStore } from "@/stores/gateway-navigation";
import { useGatewayThreadViewStore } from "@/stores/gateway-thread-view";
import { useGatewayThreadTurnsStore } from "@/stores/gateway-thread-turns";
import { buildThreadCollaborationMode } from "@/utils/thread-collaboration-mode";

type AttachedFile = {
  id: string;
  name: string;
  path: string;
  mimeType?: string | null;
  size: number;
  isImage: boolean;
  dataUrl?: string;
};

interface SubmittedDraft {
  text: string;
  attachedFiles: AttachedFile[];
  fileReferences: ComposerFileReference[];
}

export function useComposerTurnSubmit(input: {
  turnText: Ref<string>;
  attachedFiles: Ref<AttachedFile[]>;
  fileReferences: Ref<ComposerFileReference[]>;
  clearDraft: () => void;
  selectedTurnOptions: () => ComposerTurnOptions;
  collaborationModel: Ref<string>;
  selectedEffort: Ref<string>;
  fileReferencesLabel: Ref<string>;
}) {
  const gateway = useGatewayBootstrapStore();
  const composer = useGatewayComposerStore();
  const navigation = useGatewayNavigationStore();
  const threadView = useGatewayThreadViewStore();
  const threadTurns = useGatewayThreadTurnsStore();
  const interruptingTurn = ref(false);
  const submittingNewThread = ref(false);
  const submissionPending = ref(false);
  const failedDrafts: SubmittedDraft[] = [];
  let submissionController: AbortController | null = null;
  let submissionThreadId: string | null = null;
  let composerReleased = false;
  let restoringFailedDrafts = false;
  const planModeActive = computed(() => composer.selectedThreadCollaborationMode === "plan");
  const hasComposerInput = computed(() =>
    Boolean(input.turnText.value.trim() || input.attachedFiles.value.length),
  );

  async function activatePlanMode() {
    if (await saveCollaborationMode("plan")) input.turnText.value = "";
  }

  async function deactivatePlanMode() {
    await saveCollaborationMode("default");
  }

  async function startNewThread() {
    input.clearDraft();
    await threadView.startThread(input.selectedTurnOptions());
  }

  async function submitTurn() {
    if (submissionPending.value) return;
    const text = input.turnText.value.trim();
    if (!text && !input.attachedFiles.value.length) return;
    const files = [...input.attachedFiles.value];
    const remoteFiles = files.filter((file) => !file.isImage);
    const attachedImages = files.filter((file) => file.isImage);
    const references = input.fileReferences.value.map(({ type, path, name }) => ({
      type,
      path,
      name,
    }));
    const collaborationMode = composer.selectedThreadSettings.collaborationMode ?? undefined;
    const turnOptions = input.selectedTurnOptions();
    const message = messageWithFileReferences(text, remoteFiles, input.fileReferencesLabel.value);
    const sendOptions = {
      ...turnOptions,
      collaborationMode,
      images: attachedImages
        .map((file) => ({ url: file.dataUrl, detail: "auto" as const }))
        .filter((image): image is { url: string; detail: "auto" } => Boolean(image.url)),
      files: remoteFiles,
      references,
    };
    const startingNewThread = navigation.selectedThreadId === null;
    if (startingNewThread && navigation.selectedProjectId === null) return;
    submissionThreadId = navigation.selectedThreadId;
    const draftSnapshot: SubmittedDraft = {
      text: input.turnText.value,
      attachedFiles: [...input.attachedFiles.value],
      fileReferences: [...input.fileReferences.value],
    };
    const controller = new AbortController();
    submissionController = controller;
    submissionPending.value = true;

    if (startingNewThread) submittingNewThread.value = true;
    try {
      if (startingNewThread) {
        const threadId = await threadView.startThread(
          turnOptions,
          { onStarted: (startedThreadId) => (submissionThreadId = startedThreadId) },
          controller.signal,
        );
        if (threadId === null || navigation.selectedThreadId !== threadId) return;
      }
      if (planModeActive.value) {
        composer.dismissLatestSelectedPlanPrompt();
      }
      input.clearDraft();
      const accepted = await threadTurns.sendTurn(message, sendOptions, controller);
      if (!accepted) rememberFailedDraft(draftSnapshot);
    } finally {
      if (startingNewThread) submittingNewThread.value = false;
      if (submissionController === controller) {
        submissionController = null;
        submissionThreadId = null;
        submissionPending.value = false;
      }
    }
  }

  function cancelSubmission() {
    const controller = submissionController;
    if (controller === null || controller.signal.aborted) return;
    controller.abort(new Error("Submission cancelled"));
    if (navigation.selectedThreadId !== null) void threadTurns.interruptActiveTurn();
  }

  async function interruptTurn() {
    if (interruptingTurn.value) {
      return;
    }
    interruptingTurn.value = true;
    try {
      await threadTurns.interruptActiveTurn();
    } finally {
      interruptingTurn.value = false;
    }
  }

  async function saveCollaborationMode(mode: "default" | "plan") {
    const collaborationMode = buildThreadCollaborationMode({
      mode,
      modelCandidates: [input.collaborationModel.value],
      effort: input.selectedEffort.value === "default" ? null : input.selectedEffort.value,
    });
    if (collaborationMode === null) {
      gateway.setError(gateway.t("app.planModeModelUnavailable"));
      return false;
    }
    // The strip reflects the app-server's accepted next-turn settings. A local-only mode flag can
    // diverge from Codex during thread hydration, which was the regression fixed here.
    return composer.saveSelectedThreadSettings({ collaborationMode });
  }

  function rememberFailedDraft(draft: SubmittedDraft) {
    if (composerReleased && submissionThreadId !== null && navigation.selectedHostId !== null) {
      composer.queueFailedComposerDraft(navigation.selectedHostId, submissionThreadId, draft);
      return;
    }
    failedDrafts.push(draft);
    restoreFailedDrafts();
  }

  function restoreFailedDrafts() {
    if (restoringFailedDrafts || failedDrafts.length === 0 || !composerIsEmpty()) return;
    const drafts = failedDrafts.splice(0);
    restoringFailedDrafts = true;
    input.turnText.value = drafts.map((draft) => draft.text).join("\n\n");
    input.attachedFiles.value = drafts.flatMap((draft) => draft.attachedFiles);
    input.fileReferences.value = drafts.flatMap((draft) => draft.fileReferences);
    restoringFailedDrafts = false;
  }

  function composerIsEmpty() {
    return (
      input.turnText.value === "" &&
      input.attachedFiles.value.length === 0 &&
      input.fileReferences.value.length === 0
    );
  }

  watch([input.turnText, input.attachedFiles, input.fileReferences], restoreFailedDrafts, {
    deep: true,
    flush: "sync",
  });
  onScopeDispose(() => {
    composerReleased = true;
    if (submissionThreadId !== null && navigation.selectedThreadId === submissionThreadId) {
      return;
    }
    submissionController?.abort(new Error("Composer released"));
  });

  return {
    planModeActive,
    hasComposerInput,
    interruptingTurn,
    submittingNewThread,
    submissionPending,
    activatePlanMode,
    deactivatePlanMode,
    startNewThread,
    submitTurn,
    cancelSubmission,
    interruptTurn,
  };
}

function messageWithFileReferences(text: string, remoteFiles: AttachedFile[], label: string) {
  const fileReferences = remoteFiles.map((file) => `- ${file.name}: ${file.path}`);
  return fileReferences.length
    ? `${text}${text ? "\n\n" : ""}${label}\n${fileReferences.join("\n")}`
    : text;
}
