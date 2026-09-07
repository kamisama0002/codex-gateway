<script setup lang="ts">
import { computed } from "vue";
import { useTimestamp } from "@vueuse/core";

const props = defineProps<{ startedAtMs: number | null }>();
const { t } = useI18n();
const mountedAt = Date.now();
const now = useTimestamp({ interval: 1000 });
const elapsedMs = computed(() => Math.max(0, now.value - (props.startedAtMs ?? mountedAt)));
const showClock = computed(() => elapsedMs.value >= 15_000);
const elapsedLabel = computed(() => {
  const totalSeconds = Math.floor(elapsedMs.value / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return minutes > 0
    ? t("app.turnStatusMinutes", { minutes, seconds: String(seconds).padStart(2, "0") })
    : t("app.turnStatusSeconds", { seconds });
});
</script>

<template>
  <div data-testid="turn-status" class="turn-status" role="status" aria-live="polite">
    {{ t("app.thinking") }}
    <span v-if="showClock" class="turn-status-clock" aria-hidden="true">{{ elapsedLabel }}</span>
  </div>
</template>

<style scoped>
.turn-status {
  display: inline-flex;
  width: fit-content;
  height: 1.625rem;
  flex: none;
  align-items: center;
  background: linear-gradient(
    90deg,
    var(--primary) 0%,
    var(--primary) 40%,
    color-mix(in srgb, var(--primary) 24%, white) 50%,
    var(--primary) 60%,
    var(--primary) 100%
  );
  background-position: 100% 0;
  background-size: 250% 100%;
  background-clip: text;
  color: transparent;
  font-size: 0.875rem;
  font-weight: 600;
  line-height: 1.375rem;
  white-space: nowrap;
  animation: turn-status-shimmer 1.8s linear infinite;
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
}

.turn-status-clock {
  margin-left: 0.5rem;
  color: var(--ink-faint);
  font-size: 0.8125rem;
  font-variant-numeric: tabular-nums;
  font-weight: 400;
  -webkit-text-fill-color: var(--ink-faint);
}

@keyframes turn-status-shimmer {
  to {
    background-position: 0 0;
  }
}

@media (prefers-reduced-motion: reduce) {
  .turn-status {
    background-position: 0 0;
    background-size: 100% 100%;
    animation: none;
  }
}
</style>
