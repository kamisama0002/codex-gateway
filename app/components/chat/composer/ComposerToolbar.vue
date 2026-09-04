<script setup lang="ts">
import {
  CheckIcon,
  FileUpIcon,
  FolderUpIcon,
  Loader2Icon,
  PaperclipIcon,
  PlusIcon,
  SendIcon,
  SquareIcon,
} from "@lucide/vue";
import type {
  ApprovalPolicy,
  ModelRecord,
  ReasoningEffort,
  ThreadRuntimeStatus,
  ThreadTokenUsageState,
} from "~~/shared/types";
import { Button } from "@codex-gateway/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@codex-gateway/ui/dropdown-menu";
import ApprovalPolicyPicker from "@/components/chat/composer/ApprovalPolicyPicker.vue";
import ContextUsageMeter from "@/components/chat/composer/ContextUsageMeter.vue";
import ModelEffortPicker from "@/components/chat/composer/ModelEffortPicker.vue";

defineProps<{
  uploadingAttachments: boolean;
  uploadingWorkspace: boolean;
  selectedThreadId: string | null;
  selectedApprovalMode: ApprovalPolicy | "custom";
  selectedThreadTokenUsage: ThreadTokenUsageState | null;
  models: ModelRecord[];
  loadingModels: boolean;
  activeModel: string;
  activeModelLabel: string;
  activeEffortValue: string;
  activeEffortCompactLabel: string;
  effortOptions: Array<{ value: ReasoningEffort; label?: string }>;
  labelEffortOption: (option: { value: ReasoningEffort; label?: string }) => string;
  modelOptionValue: (modelOption: { model?: string; id: string }) => string;
  hasComposerInput: boolean;
  canInterruptTurn: boolean;
  canUsePrimaryAction: boolean;
  interruptingTurn: boolean;
  submissionPending: boolean;
  canAttachFiles: boolean;
  canUploadWorkspace: boolean;
  selectedThreadStatus: ThreadRuntimeStatus;
  sendButtonLabel: string;
}>();

const emit = defineEmits<{
  attach: [];
  uploadWorkspaceFiles: [];
  uploadWorkspaceFolder: [];
  primaryAction: [];
  selectModel: [model: string];
  selectEffort: [effort: ReasoningEffort];
  updateSelectedApprovalMode: [mode: ApprovalPolicy | "custom"];
}>();
</script>

<template>
  <div class="flex min-w-0 items-center gap-2 pt-0 sm:flex-wrap sm:justify-between sm:gap-3">
    <div class="flex min-w-0 items-center gap-2 text-sm text-ink-muted">
      <DropdownMenu>
        <DropdownMenuTrigger as-child>
          <Button
            data-testid="composer-add-content"
            type="button"
            variant="ghost"
            size="icon"
            class="size-7 rounded-full bg-muted text-ink hover:bg-muted hover:text-ink"
            :disabled="uploadingAttachments || uploadingWorkspace || !canAttachFiles"
            :aria-label="$t('app.addContent')"
          >
            <Loader2Icon
              v-if="uploadingAttachments || uploadingWorkspace"
              class="size-4 animate-spin"
            />
            <PlusIcon v-else class="size-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" class="w-56 border-hairline">
          <DropdownMenuItem @select="emit('attach')">
            <PaperclipIcon class="size-4" />
            {{ $t("app.attachToConversation") }}
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem :disabled="!canUploadWorkspace" @select="emit('uploadWorkspaceFiles')">
            <FileUpIcon class="size-4" />
            {{ $t("app.uploadFilesToWorkspace") }}
          </DropdownMenuItem>
          <DropdownMenuItem :disabled="!canUploadWorkspace" @select="emit('uploadWorkspaceFolder')">
            <FolderUpIcon class="size-4" />
            {{ $t("app.uploadFolderToWorkspace") }}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <div class="hidden sm:block">
        <ApprovalPolicyPicker
          :model-value="selectedApprovalMode"
          @update:model-value="emit('updateSelectedApprovalMode', $event)"
        />
      </div>
    </div>
    <div class="ml-auto flex min-w-0 items-center justify-end gap-3">
      <ContextUsageMeter :token-usage="selectedThreadTokenUsage" />
      <div class="min-w-0">
        <ModelEffortPicker
          :models="models"
          :loading-models="loadingModels"
          :active-model="activeModel"
          :active-model-label="activeModelLabel"
          :active-effort-value="activeEffortValue"
          :active-effort-compact-label="activeEffortCompactLabel"
          :effort-options="effortOptions"
          :label-effort-option="labelEffortOption"
          :model-option-value="modelOptionValue"
          @select-model="emit('selectModel', $event)"
          @select-effort="emit('selectEffort', $event)"
        />
      </div>
      <Button
        data-testid="send-turn-button"
        class="size-[2.125rem] shrink-0 -translate-y-0.5 rounded-full bg-primary p-0 text-white hover:bg-primary-active disabled:opacity-40"
        :aria-label="sendButtonLabel"
        :disabled="!canUsePrimaryAction || interruptingTurn"
        @click="emit('primaryAction')"
      >
        <SquareIcon v-if="submissionPending" class="size-3.5 fill-current" />
        <Loader2Icon v-else-if="uploadingAttachments" class="size-3.5 animate-spin" />
        <Loader2Icon v-else-if="interruptingTurn" class="size-3.5 animate-spin" />
        <SendIcon v-else-if="hasComposerInput" class="size-3.5" />
        <SquareIcon v-else-if="canInterruptTurn" class="size-3.5 fill-current" />
        <CheckIcon v-else-if="selectedThreadStatus === 'completed'" class="size-3.5" />
        <SendIcon v-else class="size-3.5 opacity-60" />
      </Button>
    </div>
  </div>
</template>
