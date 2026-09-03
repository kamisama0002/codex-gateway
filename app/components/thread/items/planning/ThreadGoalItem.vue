<script setup lang="ts">
import { TargetIcon } from "@lucide/vue";
import { computed } from "vue";
import type { ThreadGoalStatus } from "~~/shared/types";
import MarkdownContent from "@/components/common/MarkdownContent.vue";
import { Badge } from "@codex-gateway/ui/badge";
import {
  formatGoalElapsed,
  formatGoalTokens,
  goalStatusI18nKey,
} from "@/utils/thread-goal-display";

const props = defineProps<{
  item: {
    objective?: string;
    status?: ThreadGoalStatus;
    tokenBudget?: number | null;
    tokensUsed?: number;
    timeUsedSeconds?: number;
  };
}>();

const { t } = useI18n();

const status = computed(() => props.item.status ?? "active");
const statusLabel = computed(() => t(goalStatusI18nKey(status.value)));
const tokensLabel = computed(() => formatGoalTokens(props.item.tokensUsed ?? 0));
const budgetLabel = computed(() => {
  const budget = props.item.tokenBudget;
  return budget === null || budget === undefined ? "∞" : formatGoalTokens(budget);
});
const elapsedLabel = computed(() => formatGoalElapsed(props.item.timeUsedSeconds ?? 0));
</script>

<template>
  <article
    data-testid="thread-goal-item"
    class="max-w-4xl border-l-2 border-primary/40 bg-primary/5 text-sm text-ink"
  >
    <div class="flex items-start gap-3 px-3 py-2.5">
      <TargetIcon class="mt-0.5 size-4 shrink-0 text-primary" />
      <div class="min-w-0 flex-1">
        <div class="mb-1 flex flex-wrap items-center gap-2">
          <span class="font-medium text-primary">{{ t("app.threadGoal") }}</span>
          <Badge variant="outline" class="border-primary/30 bg-surface/70 text-primary">
            {{ statusLabel }}
          </Badge>
        </div>
        <MarkdownContent
          v-if="item.objective"
          class="thread-goal-objective"
          :content="item.objective"
          compact
        />
        <div class="mt-1.5 flex flex-wrap gap-x-3 gap-y-1 text-xs text-ink-muted">
          <span>{{ t("app.goalElapsed") }}: {{ elapsedLabel }}</span>
          <span>{{ t("app.goalTokensUsed") }}: {{ tokensLabel }}</span>
          <span>{{ t("app.goalTokenBudget") }}: {{ budgetLabel }}</span>
        </div>
      </div>
    </div>
  </article>
</template>

<style scoped>
.thread-goal-objective :deep(.markdown-content),
.thread-goal-objective :deep(.markdown-content p),
.thread-goal-objective :deep(.markdown-content li),
.thread-goal-objective :deep(.markdown-content code),
.thread-goal-objective :deep(.markdown-content a) {
  overflow-wrap: anywhere;
}
</style>
