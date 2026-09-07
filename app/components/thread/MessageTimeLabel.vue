<script setup lang="ts">
import { computed } from "vue";
import { formatMessageClock } from "@/utils/message-time";

const props = defineProps<{ timeMs: number | null }>();
const { t } = useI18n();
const label = computed(() =>
  props.timeMs === null ? "" : formatMessageClock(props.timeMs, (key, params) => t(key, params)),
);
const dateTime = computed(() =>
  props.timeMs === null ? undefined : new Date(props.timeMs).toISOString(),
);
</script>

<template>
  <time
    v-if="timeMs !== null"
    data-testid="message-time"
    :datetime="dateTime"
    class="shrink-0 text-[0.8125rem] leading-5 tabular-nums text-ink-faint"
  >
    {{ label }}
  </time>
</template>
