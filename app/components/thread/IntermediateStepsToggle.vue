<script setup lang="ts">
import { ChevronDownIcon } from "@lucide/vue";
import { computed } from "vue";
import StateDot from "@/components/common/StateDot.vue";

const props = defineProps<{
  open: boolean;
  count: number;
  toolCallCount: number;
  messageCount: number;
  subagentCount: number;
  loading: boolean;
  loaded: boolean;
  active: boolean;
}>();

const emit = defineEmits<{
  toggle: [open: boolean];
}>();

const { t } = useI18n();
const summaryLabel = computed(() => {
  if (!props.loaded) return t("app.viewIntermediateSteps");
  const parts: string[] = [];
  if (props.toolCallCount > 0) {
    parts.push(t("app.turnProcessToolCalls", { count: props.toolCallCount }));
  }
  if (props.messageCount > 0) {
    parts.push(t("app.turnProcessMessages", { count: props.messageCount }));
  }
  if (props.subagentCount > 0) {
    parts.push(t("app.turnProcessSubagents", { count: props.subagentCount }));
  }
  if (parts.length > 0) return parts.join(t("app.turnProcessSeparator"));
  return props.active ? t("app.thinking") : t("app.turnProcessThoughtForAWhile");
});
const accessibleLabel = computed(() =>
  t("app.turnProcessAccessibleLabel", {
    title: t("app.intermediateSteps"),
    summary: summaryLabel.value,
  }),
);
</script>

<template>
  <button
    type="button"
    class="process-toggle thread-column"
    :aria-expanded="open"
    :aria-label="accessibleLabel"
    :disabled="loading"
    :data-state="open ? 'open' : 'closed'"
    :data-testid="open ? 'intermediate-steps' : undefined"
    @click="emit('toggle', !props.open)"
  >
    <StateDot v-if="loading || active" state="ongoing" />
    <span class="min-w-0 truncate">{{ summaryLabel }}</span>
    <ChevronDownIcon
      class="process-chevron size-4 shrink-0 text-ink-faint"
      :class="open ? 'rotate-0' : '-rotate-90'"
    />
  </button>
</template>

<style scoped>
.process-toggle {
  display: flex;
  min-height: 2.0625rem;
  align-items: center;
  gap: 0.375rem;
  border-bottom: 0.0625rem solid var(--hairline);
  padding: 0 0 0.5rem;
  background: transparent;
  color: var(--ink-muted);
  text-align: left;
  font-size: 0.875rem;
  line-height: 1.5rem;
}

.process-toggle[data-state="closed"] {
  margin-bottom: 0.5rem;
}

.process-toggle:hover {
  color: var(--ink-secondary);
}

.process-chevron {
  transition: transform 100ms ease;
}

@media (prefers-reduced-motion: reduce) {
  .process-chevron {
    transition: none;
  }
}
</style>
