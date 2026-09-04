<script setup lang="ts">
import { CheckIcon, Loader2Icon, PlusIcon, SendIcon, SquareIcon } from "@lucide/vue";
import type {
  ApprovalPolicy,
  ModelRecord,
  ReasoningEffort,
  ThreadRuntimeStatus,
  ThreadTokenUsageState,
} from "~~/shared/types";
import { Button } from "@codex-gateway/ui/button";
import ApprovalPolicyPicker from "@/components/chat/composer/ApprovalPolicyPicker.vue";
import ContextUsageMeter from "@/components/chat/composer/ContextUsageMeter.vue";
import ModelEffortPicker from "@/components/chat/composer/ModelEffortPicker.vue";

defineProps<{
  uploadingAttachments: boolean;
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
  creatingFirstThread: boolean;
  canAttachFiles: boolean;
  selectedThreadStatus: ThreadRuntimeStatus;
  sendButtonLabel: string;
}>();

const emit = defineEmits<{
  attach: [];
  primaryAction: [];
  selectModel: [model: string];
  selectEffort: [effort: ReasoningEffort];
  updateSelectedApprovalMode: [mode: ApprovalPolicy | "custom"];
}>();
</script>

<template>
  <div class="flex min-w-0 items-center gap-2 pt-0 sm:flex-wrap sm:justify-between sm:gap-3">
    <div class="flex min-w-0 items-center gap-2 text-sm text-ink-muted">
      <Button
        type="button"
        variant="ghost"
        size="icon"
        class="size-7 rounded-full bg-muted text-ink hover:bg-muted hover:text-ink"
        :disabled="uploadingAttachments || creatingFirstThread || !canAttachFiles"
        :aria-label="$t('app.attachFile')"
        @click="emit('attach')"
      >
        <Loader2Icon v-if="uploadingAttachments" class="size-4 animate-spin" />
        <PlusIcon v-else class="size-4" />
      </Button>
      <div class="hidden sm:block">
        <ApprovalPolicyPicker
          :model-value="selectedApprovalMode"
          :disabled="creatingFirstThread"
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
          :disabled="creatingFirstThread"
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
        <SquareIcon v-if="creatingFirstThread" class="size-3.5 fill-current" />
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
