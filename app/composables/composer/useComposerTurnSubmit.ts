import { computed, type Ref } from "vue";

import type { ComposerTurnOptions } from "~~/shared/types";
import type { ComposerFileReference } from "@/stores/gateway/types";
import { useGatewayBootstrapStore } from "@/stores/gateway-bootstrap";
import { useGatewayComposerStore } from "@/stores/gateway-composer";
import { useGatewayNavigationStore } from "@/stores/gateway-navigation";
import { useGatewayThreadViewStore } from "@/stores/gateway-thread-view";
import { useGatewayThreadTurnsStore } from "@/stores/gateway-thread-turns";
import { buildThreadCollaborationMode } from "@/utils/thread-collaboration-mode";

type AttachedFile = {
  name: string;
  path: string;
  mimeType?: string | null;
  size: number;
  isImage: boolean;
  dataUrl?: string;
};

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
  let pendingThreadStart: AbortController | null = null;
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
    if (submittingNewThread.value) return;
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

    if (startingNewThread) {
      const controller = new AbortController();
      pendingThreadStart = controller;
      submittingNewThread.value = true;
      try {
        const threadId = await threadView.startThread(turnOptions, { signal: controller.signal });
        if (
          controller.signal.aborted ||
          threadId === null ||
          navigation.selectedThreadId !== threadId
        ) {
          return;
        }
      } finally {
        if (pendingThreadStart === controller) pendingThreadStart = null;
        submittingNewThread.value = false;
      }
    }
    if (planModeActive.value) {
      composer.dismissLatestSelectedPlanPrompt();
    }
    input.clearDraft();
    await threadTurns.sendTurn(message, sendOptions);
  }

  function cancelPendingThreadStart() {
    pendingThreadStart?.abort();
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

  return {
    planModeActive,
    hasComposerInput,
    interruptingTurn,
    submittingNewThread,
    activatePlanMode,
    deactivatePlanMode,
    startNewThread,
    submitTurn,
    cancelPendingThreadStart,
    interruptTurn,
  };
}

function messageWithFileReferences(text: string, remoteFiles: AttachedFile[], label: string) {
  const fileReferences = remoteFiles.map((file) => `- ${file.name}: ${file.path}`);
  return fileReferences.length
    ? `${text}${text ? "\n\n" : ""}${label}\n${fileReferences.join("\n")}`
    : text;
}
