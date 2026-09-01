<script setup lang="ts">
import { ChevronDownIcon, ChevronRightIcon, ListTreeIcon, Loader2Icon } from "@lucide/vue";
import { Badge } from "@codex-gateway/ui/badge";

const props = defineProps<{
  open: boolean;
  count: number;
  loading: boolean;
}>();

const emit = defineEmits<{
  toggle: [open: boolean];
}>();

const { t } = useI18n();
</script>

<template>
  <button
    type="button"
    class="flex w-full max-w-3xl items-center gap-2 rounded-lg px-2 py-1.5 text-left text-sm text-ink-secondary hover:bg-muted"
    :aria-expanded="open"
    :disabled="loading"
    :data-state="open ? 'open' : 'closed'"
    :data-testid="open ? 'intermediate-steps' : undefined"
    @click="emit('toggle', !props.open)"
  >
    <ChevronDownIcon v-if="open" class="size-4 shrink-0 text-ink-faint" />
    <ChevronRightIcon v-else class="size-4 shrink-0 text-ink-faint" />
    <ListTreeIcon class="size-4 shrink-0 text-ink-faint" />
    <span class="min-w-0 flex-1 truncate">{{ t("app.intermediateSteps") }}</span>
    <Loader2Icon v-if="loading" class="size-4 animate-spin text-ink-muted" />
    <Badge v-else-if="count > 0" variant="outline">{{ count }}</Badge>
  </button>
</template>
