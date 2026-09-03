<script setup lang="ts">
import { CheckIcon, Loader2Icon, TriangleAlertIcon } from "@lucide/vue";
import { computed, onBeforeUnmount, ref, watch } from "vue";
import { Button } from "@codex-gateway/ui/button";
import { useGatewayRealtimeStore } from "@/stores/gateway-realtime";

const realtime = useGatewayRealtimeStore();
const { t } = useI18n();
const recovered = ref(false);
let recoveryTimer: number | null = null;

const state = computed(() => {
  if (realtime.connected) return recovered.value ? "recovered" : "hidden";
  return realtime.reconnectAttempt > 0 ? "connecting" : "disconnected";
});
const label = computed(() => {
  if (state.value === "recovered") return t("app.realtimeRecovered");
  if (state.value === "connecting") {
    return t("app.realtimeConnecting", { attempt: realtime.reconnectAttempt });
  }
  return t("app.realtimeDisconnected");
});

watch(
  () => realtime.connected,
  (connected, previous) => {
    if (!connected || previous !== false || realtime.readyCount <= 1) return;
    recovered.value = true;
    if (recoveryTimer !== null) window.clearTimeout(recoveryTimer);
    recoveryTimer = window.setTimeout(() => {
      recovered.value = false;
      recoveryTimer = null;
    }, 2_000);
  },
);

onBeforeUnmount(() => {
  if (recoveryTimer !== null) window.clearTimeout(recoveryTimer);
});
</script>

<template>
  <Button
    v-if="state !== 'hidden'"
    type="button"
    variant="ghost"
    size="sm"
    class="h-8 min-w-0 gap-1.5 rounded-lg px-2 text-xs font-medium"
    :class="
      state === 'recovered'
        ? 'bg-accent-green/10 text-accent-green hover:bg-accent-green/10'
        : 'bg-accent-orange/10 text-accent-orange-deep hover:bg-accent-orange/15'
    "
    :disabled="state === 'recovered'"
    :aria-label="
      state === 'connecting' ? t('app.realtimeRestartAction') : t('app.realtimeReconnectAction')
    "
    data-testid="realtime-connection-indicator"
    @click="realtime.reconnectNow"
  >
    <CheckIcon v-if="state === 'recovered'" class="size-3.5 shrink-0" />
    <Loader2Icon v-else-if="state === 'connecting'" class="size-3.5 shrink-0 animate-spin" />
    <TriangleAlertIcon v-else class="size-3.5 shrink-0" />
    <span class="truncate">{{ label }}</span>
  </Button>
</template>
