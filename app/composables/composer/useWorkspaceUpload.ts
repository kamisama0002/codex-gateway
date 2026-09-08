import { ref, type Ref } from "vue";
import { toast } from "@codex-gateway/ui/sonner";
import type { WorkspaceUploadResult } from "~~/shared/types";
import { useGatewayTranslator } from "@/composables/i18n/useGatewayTranslator";
import { useGatewayBootstrapStore } from "@/stores/gateway-bootstrap";
import { useGatewayFileWorkspaceStore } from "@/stores/file-workspace";
import { gatewayApi } from "@/utils/gateway-api";
import { gatewayErrorMessage } from "@/utils/gateway-error";
import { captureSessionEpoch } from "@/utils/session-epoch";
import {
  buildWorkspaceUploadFormData,
  workspaceUploadLimitViolation,
  type WorkspaceUploadSelection,
} from "./workspace-upload";

export interface WorkspaceUploadConflictState {
  files: File[];
  selection: WorkspaceUploadSelection;
  conflicts: string[];
  hostId: number;
  projectId: number;
}

export function useWorkspaceUpload(input: {
  selectedHostId: Ref<number | null>;
  selectedProjectId: Ref<number | null>;
  selectedThreadId: Ref<string | null>;
}) {
  const t = useGatewayTranslator();
  const gateway = useGatewayBootstrapStore();
  const fileWorkspace = useGatewayFileWorkspaceStore();
  const uploadingWorkspace = ref(false);
  const pendingConflict = ref<WorkspaceUploadConflictState | null>(null);

  async function uploadFiles(files: File[], selection: WorkspaceUploadSelection) {
    const violation = workspaceUploadLimitViolation(files);
    if (violation !== null) {
      gateway.setError(t(limitMessageKey(violation)), {
        hostId: input.selectedHostId.value,
        projectId: input.selectedProjectId.value,
        threadId: input.selectedThreadId.value,
      });
      return;
    }
    const hostId = input.selectedHostId.value;
    const projectId = input.selectedProjectId.value;
    if (files.length === 0) return;
    if (hostId === null || projectId === null) {
      gateway.setError(t("app.selectProjectFirst"));
      return;
    }
    await executeUpload({ files, selection, hostId, projectId }, false);
  }

  async function confirmOverwrite() {
    const pending = pendingConflict.value;
    if (pending === null) return;
    if (
      input.selectedHostId.value !== pending.hostId ||
      input.selectedProjectId.value !== pending.projectId
    ) {
      pendingConflict.value = null;
      gateway.setError(t("app.workspaceUploadScopeChanged"));
      return;
    }
    await executeUpload(pending, true);
  }

  function cancelConflict() {
    pendingConflict.value = null;
  }

  function handleWorkspaceSelection(event: Event, selection: WorkspaceUploadSelection) {
    const target = event.target;
    if (!(target instanceof HTMLInputElement)) return;
    void uploadFiles(Array.from(target.files ?? []), selection);
    target.value = "";
  }

  async function executeUpload(
    batch: Omit<WorkspaceUploadConflictState, "conflicts">,
    overwrite: boolean,
  ) {
    const sessionIsCurrent = captureSessionEpoch();
    uploadingWorkspace.value = true;
    try {
      const result = await gatewayApi<WorkspaceUploadResult>("/api/workspace/uploads", {
        method: "POST",
        query: { hostId: batch.hostId, projectId: batch.projectId, overwrite },
        body: buildWorkspaceUploadFormData(batch.files, batch.selection),
      });
      if (!sessionIsCurrent()) return;
      if (result.status === "conflict") {
        pendingConflict.value = { ...batch, conflicts: result.conflicts };
        return;
      }
      pendingConflict.value = null;
      if (
        input.selectedHostId.value === batch.hostId &&
        input.selectedProjectId.value === batch.projectId &&
        input.selectedThreadId.value !== null
      ) {
        fileWorkspace.markRemoteFilesChanged(
          batch.hostId,
          input.selectedThreadId.value,
          result.files.map((file) => file.path),
        );
      }
      toast.success(t("app.workspaceUploadSucceeded", { count: result.files.length }));
    } catch (error: unknown) {
      if (!sessionIsCurrent()) return;
      gateway.setError(gatewayErrorMessage(error, t("app.workspaceUploadFailed")), {
        hostId: batch.hostId,
        projectId: batch.projectId,
        threadId: input.selectedThreadId.value,
      });
    } finally {
      if (sessionIsCurrent()) uploadingWorkspace.value = false;
    }
  }

  return {
    uploadingWorkspace,
    pendingConflict,
    uploadFiles,
    confirmOverwrite,
    cancelConflict,
    handleWorkspaceSelection,
  };
}

function limitMessageKey(violation: NonNullable<ReturnType<typeof workspaceUploadLimitViolation>>) {
  return {
    count: "app.workspaceUploadTooManyFiles",
    fileSize: "app.workspaceUploadFileTooLarge",
    totalSize: "app.workspaceUploadBatchTooLarge",
  }[violation];
}
