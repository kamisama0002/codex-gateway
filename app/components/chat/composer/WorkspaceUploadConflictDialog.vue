<script setup lang="ts">
import { computed } from "vue";
import type { WorkspaceUploadConflictState } from "@/composables/composer/useWorkspaceUpload";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@codex-gateway/ui/alert-dialog";

const props = defineProps<{
  conflict: WorkspaceUploadConflictState | null;
  uploading: boolean;
  creatingFirstThread: boolean;
}>();

const emit = defineEmits<{
  cancel: [];
  overwrite: [];
}>();

const dialogOpen = computed(() => props.conflict !== null && !props.creatingFirstThread);
const visibleConflicts = computed(() => props.conflict?.conflicts.slice(0, 8) ?? []);

function handleOpenChange(open: boolean) {
  if (!open && !props.creatingFirstThread) emit("cancel");
}
</script>

<template>
  <AlertDialog :open="dialogOpen" @update:open="handleOpenChange">
    <AlertDialogContent data-testid="workspace-upload-conflict-dialog">
      <AlertDialogHeader>
        <AlertDialogTitle>{{ $t("app.workspaceUploadConflictTitle") }}</AlertDialogTitle>
        <AlertDialogDescription>
          {{
            $t("app.workspaceUploadConflictDescription", { count: conflict?.conflicts.length ?? 0 })
          }}
        </AlertDialogDescription>
      </AlertDialogHeader>
      <ul class="max-h-48 space-y-1 overflow-y-auto text-sm text-ink-secondary">
        <li v-for="path in visibleConflicts" :key="path" class="truncate" :title="path">
          {{ path }}
        </li>
        <li
          v-if="(conflict?.conflicts.length ?? 0) > visibleConflicts.length"
          class="text-ink-muted"
        >
          {{
            $t("app.workspaceUploadMoreConflicts", {
              count: (conflict?.conflicts.length ?? 0) - visibleConflicts.length,
            })
          }}
        </li>
      </ul>
      <AlertDialogFooter>
        <AlertDialogCancel :disabled="uploading || creatingFirstThread" @click="emit('cancel')">
          {{ $t("app.cancel") }}
        </AlertDialogCancel>
        <AlertDialogAction
          variant="destructive"
          data-testid="workspace-upload-overwrite"
          :disabled="uploading || creatingFirstThread"
          @click.capture="emit('overwrite')"
        >
          {{ $t("app.workspaceUploadOverwrite") }}
        </AlertDialogAction>
      </AlertDialogFooter>
    </AlertDialogContent>
  </AlertDialog>
</template>
