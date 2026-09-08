<script setup lang="ts">
import type { ThreadHistoryItem } from "~~/shared/types";
import { useTimestamp } from "@vueuse/core";
import { BrainIcon, ChevronDownIcon } from "@lucide/vue";
import { computed, watch } from "vue";
import { Collapsible, CollapsibleTrigger } from "@codex-gateway/ui/collapsible";
import DeferredCollapsibleContent from "@/components/common/DeferredCollapsibleContent.vue";
import MarkdownContent from "@/components/common/MarkdownContent.vue";
import { isItemInProgress, threadItemText } from "@/utils/thread-items";
import { formatDurationMs, itemCompletedAtMs, itemStartedAtMs } from "@/utils/item-timing";

const props = defineProps<{ item: ThreadHistoryItem }>();
const { t } = useI18n();
const { timestamp: now, pause, resume } = useTimestamp({ controls: true, interval: 100 });
const text = computed(() => threadItemText(props.item));
const inProgress = computed(() => isItemInProgress(props.item));
const startedAt = computed(() => itemStartedAtMs(props.item));
const completedAt = computed(() => itemCompletedAtMs(props.item));
const elapsedMs = computed(() => {
  if (startedAt.value === null) return null;
  return (inProgress.value ? now.value : (completedAt.value ?? now.value)) - startedAt.value;
});
const timeLabel = computed(() =>
  elapsedMs.value === null ? null : formatDurationMs(elapsedMs.value),
);
const summary = computed(() => {
  const visible = text.value.trimEnd();
  if (visible === "") {
    return inProgress.value ? t("app.thinking") : t("app.turnProcessThoughtForAWhile");
  }
  const lines = visible.split("\n");
  return inProgress.value ? (lines.at(-1) ?? visible) : (lines[0] ?? visible);
});

watch(inProgress, (active) => (active ? resume() : pause()), { immediate: true });
</script>

<template>
  <Collapsible v-slot="{ open }" class="max-w-4xl text-ink-muted">
    <CollapsibleTrigger
      class="timeline-process-row group/reasoning flex h-6 w-full min-w-0 items-center text-left text-sm"
      :data-state="inProgress ? 'running' : undefined"
      :aria-label="t('app.turnProcessAccessibleLabel', { title: t('app.reasoning'), summary })"
    >
      <span class="relative mr-1.5 inline-flex size-4 shrink-0 items-center justify-center">
        <ChevronDownIcon v-if="open" class="size-3.5 text-ink-muted" />
        <template v-else>
          <BrainIcon class="size-3.5 text-ink-muted group-hover/reasoning:hidden" />
          <ChevronDownIcon
            class="hidden size-3.5 -rotate-90 text-ink-muted group-hover/reasoning:block"
          />
        </template>
      </span>
      <span class="shrink-0 text-ink-muted">{{ t("app.reasoning") }}</span>
      <span class="mx-2 size-0.5 shrink-0 rounded-full bg-ink-faint" aria-hidden="true" />
      <span class="min-w-0 flex-1 truncate text-[0.8125rem] text-ink-faint">{{ summary }}</span>
      <span
        v-if="timeLabel !== null"
        class="ml-2 shrink-0 font-mono text-[0.6875rem] text-ink-faint"
      >
        {{ timeLabel }}
      </span>
    </CollapsibleTrigger>
    <DeferredCollapsibleContent :open="open">
      <div class="py-1 pl-6 text-[0.8125rem] leading-5 text-ink-faint">
        <MarkdownContent v-if="text" :content="text" :streaming="inProgress" compact />
      </div>
    </DeferredCollapsibleContent>
  </Collapsible>
</template>
