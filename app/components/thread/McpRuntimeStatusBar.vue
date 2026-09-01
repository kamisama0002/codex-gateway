<script setup lang="ts">
import { computed, watch } from "vue";
import { PlugZapIcon } from "@lucide/vue";
import { Badge } from "@codex-gateway/ui/badge";
import { useGatewayMcpRuntimeStore } from "@/stores/gateway-mcp-runtime";
import { pinnedKey } from "@/stores/gateway/thread-utils/identity";
import { isAppServerThreadId } from "~~/shared/runtime/app-server";

const props = defineProps<{ hostId: number | null; threadId: string }>();
const runtime = useGatewayMcpRuntimeStore();
const servers = computed(() =>
  props.hostId === null
    ? []
    : (runtime.serversByThreadKey[pinnedKey(props.hostId, props.threadId)] ?? []),
);
const attention = computed(() =>
  servers.value.filter(
    (server) =>
      server.runtimeStatus !== null &&
      server.runtimeStatus !== "connected" &&
      server.runtimeStatus !== "disabled",
  ),
);

watch(
  () => [props.hostId, props.threadId] as const,
  ([hostId, threadId]) => {
    if (hostId !== null && isAppServerThreadId(threadId)) {
      void runtime.refreshStatuses(hostId, threadId);
    }
  },
  { immediate: true },
);
</script>

<template>
  <div
    v-if="attention.length"
    class="flex min-h-9 shrink-0 items-center gap-2 overflow-x-auto border-b border-hairline bg-canvas-soft/55 px-3 text-xs"
    data-testid="mcp-runtime-status"
  >
    <PlugZapIcon class="size-3.5 shrink-0 text-ink-muted" />
    <span class="shrink-0 font-medium text-ink-muted">{{ $t("app.mcpConnections") }}</span>
    <Badge
      v-for="server in attention"
      :key="server.name"
      :variant="server.runtimeStatus === 'failed' ? 'destructive' : 'outline'"
      class="shrink-0"
    >
      {{ server.name }} · {{ server.runtimeStatus }}
    </Badge>
  </div>
</template>
