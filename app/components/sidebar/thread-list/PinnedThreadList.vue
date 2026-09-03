<script setup lang="ts">
import ThreadRow from "./ThreadRow.vue";
import { formatRelative, pinnedThreadId, pinnedThreadKey } from "../sidebar-utils";
import type { HostRecord, PinnedThreadRecord } from "../sidebar-types";
import type { ThreadRuntimePhase } from "@/stores/gateway/types";
import type { ThreadHistoryState } from "~~/shared/types";

const props = defineProps<{
  threads: PinnedThreadRecord[];
  hosts: HostRecord[];
  selectedHostId: number | null;
  selectedThreadId: string | null;
  longPressHandlers?: Record<string, unknown>;
  runtimeStatus: (thread: PinnedThreadRecord) => ThreadRuntimePhase;
  completionAttention: (thread: PinnedThreadRecord) => boolean;
  threadHistory: (hostId: number, threadId: string) => ThreadHistoryState | null;
}>();

const emit = defineEmits<{
  open: [thread: PinnedThreadRecord];
  unpin: [thread: PinnedThreadRecord];
  rename: [thread: PinnedThreadRecord];
  archive: [thread: PinnedThreadRecord];
}>();

function isSelectedPinnedThread(thread: PinnedThreadRecord) {
  return (
    pinnedThreadId(thread) === String(props.selectedThreadId) &&
    thread.hostId === props.selectedHostId
  );
}
</script>

<template>
  <section v-if="threads.length" class="flex min-w-0 max-w-full flex-col overflow-hidden">
    <div class="flex h-8 items-center justify-between gap-2 px-1 text-sm text-ink-muted">
      <span>{{ $t("app.pinned") }}</span>
      <slot name="header-action" />
    </div>
    <div v-if="threads.length" class="space-y-0.5">
      <ThreadRow
        v-for="thread in threads"
        :key="pinnedThreadKey(thread)"
        compact
        :thread="thread"
        :test-id="`pinned-thread-button-${pinnedThreadId(thread)}`"
        :selected="isSelectedPinnedThread(thread)"
        :history="threadHistory(thread.hostId, pinnedThreadId(thread))"
        :status="runtimeStatus(thread)"
        :completion-attention="completionAttention(thread)"
        :subtitle="formatRelative(thread.updatedAt)"
        :pin-label="$t('app.unpinThread')"
        :long-press-handlers="longPressHandlers"
        show-pinned-icon
        @open="emit('open', thread)"
        @toggle-pin="emit('unpin', thread)"
        @rename="emit('rename', thread)"
        @archive="emit('archive', thread)"
      />
    </div>
  </section>
</template>
