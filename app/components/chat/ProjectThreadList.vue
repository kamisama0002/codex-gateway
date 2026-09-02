<script setup lang="ts">
import {
  Clock3Icon,
  FolderIcon,
  MessageSquareTextIcon,
  PlusIcon,
  RefreshCwIcon,
} from "@lucide/vue";
import { storeToRefs } from "pinia";
import { computed } from "vue";
import { Badge } from "@codex-gateway/ui/badge";
import { Button } from "@codex-gateway/ui/button";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
} from "@codex-gateway/ui/context-menu";
import { useLongPressContextMenu } from "@/composables/interactions/useLongPressContextMenu";
import { useGatewayCatalogStore } from "@/stores/gateway-catalog";
import { projectById } from "@/stores/gateway-catalog/selectors";
import { useGatewayNavigationStore } from "@/stores/gateway-navigation";
import { useGatewayThreadViewStore } from "@/stores/gateway-thread-view";
import { titleForThread } from "@/stores/gateway/thread-utils/identity";
import type { GatewayThread } from "~~/shared/types";

const catalog = useGatewayCatalogStore();
const navigation = useGatewayNavigationStore();
const threadView = useGatewayThreadViewStore();
const { t } = useI18n();
const { projects } = storeToRefs(catalog);
const { selectedHostId, selectedProjectId, selectedThreadId, threads } = storeToRefs(navigation);
const { currentThread, loading } = storeToRefs(threadView);
const selectedProject = computed(() => projectById(projects.value, selectedProjectId.value));
const { longPressTriggered, longPressContextMenuHandlers } = useLongPressContextMenu();

const sortedThreads = computed(() => {
  return [...threads.value].sort(
    (a, b) => Number(b.recencyAt || b.updatedAt || 0) - Number(a.recencyAt || a.updatedAt || 0),
  );
});

function titleFor(thread: GatewayThread) {
  if (String(thread.id) === String(selectedThreadId.value) && currentThread.value) {
    return titleForThread({ ...thread, ...currentThread.value });
  }
  return titleForThread(thread);
}

function formatDate(seconds?: number | null) {
  if (!seconds) return "";
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(seconds * 1000));
}

function openThread(threadId: string) {
  if (longPressTriggered.value) {
    return;
  }
  void threadView.openThread(threadId, {
    hostId: selectedHostId.value ?? undefined,
    projectId: selectedProjectId.value,
  });
}

function startProjectThread() {
  if (selectedHostId.value === null) return;
  void threadView.startThread(
    {},
    { hostId: selectedHostId.value, projectId: selectedProjectId.value },
  );
}
</script>

<template>
  <section data-testid="project-thread-list" class="thread-column">
    <div class="mb-4 flex items-start justify-between gap-3">
      <div class="min-w-0">
        <div class="mb-1 flex items-center gap-1.5 text-xs text-ink-muted">
          <FolderIcon class="size-3.5" />
          {{ t("app.projectThreads") }}
        </div>
        <h2 class="truncate text-base font-medium text-ink">{{ selectedProject?.name }}</h2>
        <p class="mt-0.5 truncate text-xs text-ink-muted">{{ selectedProject?.remotePath }}</p>
        <p class="mt-2 max-w-2xl text-sm leading-6 text-ink-secondary">
          {{ t("app.projectThreadsHint") }}
        </p>
      </div>
      <div class="flex shrink-0 items-center gap-1.5">
        <Button
          variant="secondary"
          size="sm"
          :disabled="loading"
          @click="navigation.listThreads('')"
        >
          <RefreshCwIcon class="size-3.5" />
          {{ t("app.refresh") }}
        </Button>
        <Button size="sm" @click="startProjectThread">
          <PlusIcon class="size-3.5" />
          {{ t("app.newThread") }}
        </Button>
      </div>
    </div>

    <div v-if="sortedThreads.length" class="space-y-0.5">
      <ContextMenu v-for="thread in sortedThreads" :key="thread.id">
        <ContextMenuTrigger as-child>
          <Button
            variant="ghost"
            :data-testid="`project-thread-row-${thread.id}`"
            v-bind="longPressContextMenuHandlers"
            class="group h-auto w-full items-start justify-between gap-3 rounded-lg px-2.5 py-2 text-left font-normal hover:bg-canvas-soft"
            @click="openThread(String(thread.id))"
          >
            <span class="flex min-w-0 gap-2.5">
              <MessageSquareTextIcon class="mt-0.5 size-3.5 shrink-0 text-ink-muted" />
              <span class="min-w-0">
                <span class="line-clamp-1 text-sm leading-5 text-ink">{{ titleFor(thread) }}</span>
                <span class="mt-0.5 flex items-center gap-1.5 text-xs text-ink-faint">
                  <Clock3Icon class="size-3" />
                  {{ formatDate(thread.recencyAt || thread.updatedAt) }}
                </span>
              </span>
            </span>
            <Badge variant="secondary" class="opacity-0 transition-opacity group-hover:opacity-100">
              {{ t("app.openThread") }}
            </Badge>
          </Button>
        </ContextMenuTrigger>
        <ContextMenuContent class="w-40">
          <ContextMenuItem @select="navigation.setThreadPinned(String(thread.id), !thread.pinned)">
            {{ thread.pinned ? t("app.unpinThread") : t("app.pinThread") }}
          </ContextMenuItem>
        </ContextMenuContent>
      </ContextMenu>
    </div>

    <div v-else class="py-8 text-center text-sm leading-6 text-ink-muted">
      {{ loading ? t("app.thinking") : t("app.noProjectThreads") }}
    </div>
  </section>
</template>
