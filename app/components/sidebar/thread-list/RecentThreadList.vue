<script setup lang="ts">
import ThreadRow from "./ThreadRow.vue";
import { formatRelative, threadKey } from "../sidebar-utils";
import type { ThreadActivitySummary } from "@/stores/gateway-thread-activity";
import type { ThreadRuntimeStatus } from "@/stores/gateway/types";

type RecentThread = ThreadActivitySummary & {
  id: string;
  hostName: string | null;
  status: ThreadRuntimeStatus;
  completionAttention: boolean;
};

defineProps<{
  threads: RecentThread[];
  selectedHostId: number | null;
  selectedThreadId: string | null;
  longPressHandlers?: Record<string, unknown>;
}>();

const emit = defineEmits<{
  open: [thread: RecentThread];
  pin: [thread: RecentThread];
  rename: [thread: RecentThread];
  archive: [thread: RecentThread];
}>();
</script>

<template>
  <section v-if="threads.length" class="flex min-w-0 max-w-full flex-col overflow-hidden">
    <div class="flex h-8 items-center px-1 text-sm text-ink-muted">
      {{ $t("app.recentlyRunning") }}
    </div>
    <div class="space-y-0.5">
      <ThreadRow
        v-for="thread in threads"
        :key="threadKey(thread.hostId, thread.threadId)"
        compact
        :thread="thread"
        :test-id="`recent-thread-button-${thread.threadId}`"
        :selected="thread.hostId === selectedHostId && thread.threadId === selectedThreadId"
        :status="thread.status"
        :completion-attention="thread.completionAttention"
        :subtitle="formatRelative(thread.updatedAt)"
        :pin-label="$t('app.pinThread')"
        :long-press-handlers="longPressHandlers"
        @open="emit('open', thread)"
        @toggle-pin="emit('pin', thread)"
        @rename="emit('rename', thread)"
        @archive="emit('archive', thread)"
      />
    </div>
  </section>
</template>
