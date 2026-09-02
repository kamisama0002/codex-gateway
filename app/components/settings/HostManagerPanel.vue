<script setup lang="ts">
import { ServerIcon, Trash2Icon } from "@lucide/vue";
import { storeToRefs } from "pinia";
import { Badge } from "@codex-gateway/ui/badge";
import { Button } from "@codex-gateway/ui/button";
import { ScrollArea } from "@codex-gateway/ui/scroll-area";
import { hostConnectionClass, hostConnectionLabelKey } from "@/components/sidebar/sidebar-utils";
import { useGatewayCatalogStore } from "@/stores/gateway-catalog";
import { useGatewayNavigationStore } from "@/stores/gateway-navigation";
import { isManagedRuntimeHost } from "~~/shared/runtime/managed-runtime";

const catalog = useGatewayCatalogStore();
const navigation = useGatewayNavigationStore();
const { hosts, hostConnectionStatuses } = storeToRefs(catalog);
const { selectedHostId } = storeToRefs(navigation);
const { t } = useI18n();

async function selectHost(hostId: number) {
  await catalog.selectHost(hostId);
}

async function deleteHost(hostId: number) {
  if (isManagedRuntimeHost({ id: hostId })) return;
  await catalog.deleteHost(hostId);
}

function hostTitle(host: { id: number; name: string; connectionKind?: string | null }) {
  return isManagedRuntimeHost(host) ? t("app.localHost") : host.name;
}

function hostSubtitle(host: { sshHost: string; connectionKind?: string | null }) {
  return isManagedRuntimeHost(host) ? t("app.localHostSubtitle") : host.sshHost;
}

function hostConnectionStatus(hostId: number) {
  return hostConnectionStatuses.value[hostId] ?? { status: "idle" as const, message: null };
}

function hostConnectionLabel(hostId: number) {
  const connection = hostConnectionStatus(hostId);
  return (
    connection.message ||
    (connection.status === "idle" ? "" : t(hostConnectionLabelKey(connection.status)))
  );
}

function hostStatusMessage(hostId: number) {
  return hostConnectionLabel(hostId);
}

function hostStatusClass(hostId: number) {
  if (hostConnectionLabel(hostId)) {
    return hostConnectionClass(hostConnectionStatus(hostId).status);
  }
  return "text-destructive";
}
</script>

<template>
  <section class="space-y-2">
    <div class="flex items-center justify-between px-1">
      <div class="text-xs font-medium text-ink-secondary">{{ t("app.hosts") }}</div>
      <Badge variant="secondary">{{ hosts.length }}</Badge>
    </div>

    <ScrollArea class="max-h-56">
      <div class="space-y-1 pr-2">
        <div
          v-for="host in hosts"
          :key="host.id"
          class="rounded-lg p-1"
          :class="host.id === selectedHostId ? 'bg-primary/10' : 'hover:bg-canvas-soft'"
        >
          <div class="flex items-center gap-2">
            <Button
              variant="ghost"
              class="min-w-0 flex-1 justify-start gap-2 px-2 text-left"
              @click="selectHost(host.id)"
            >
              <ServerIcon class="size-4 shrink-0" />
              <span class="min-w-0 flex-1">
                <span class="block truncate text-sm">{{ hostTitle(host) }}</span>
                <span class="block truncate text-[0.6875rem] text-ink-muted">
                  {{ hostSubtitle(host) }}
                </span>
              </span>
            </Button>
            <Button
              v-if="!isManagedRuntimeHost(host)"
              variant="ghost"
              size="sm"
              class="size-8 p-0 text-destructive hover:text-destructive/80"
              :aria-label="t('app.deleteHost')"
              @click="deleteHost(host.id)"
            >
              <Trash2Icon class="size-4" />
            </Button>
          </div>
          <div
            v-if="hostStatusMessage(host.id)"
            class="whitespace-pre-line px-2 pb-1 text-[0.6875rem]"
            :class="hostStatusClass(host.id)"
          >
            {{ hostStatusMessage(host.id) }}
          </div>
        </div>
      </div>
    </ScrollArea>
  </section>
</template>
