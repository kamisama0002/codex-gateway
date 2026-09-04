<script setup lang="ts">
import { FolderIcon, Loader2Icon } from "@lucide/vue";
import { computed } from "vue";
import ChatComposer from "@/components/chat/ChatComposer.vue";
import ChatPanelScrollArea from "@/components/chat/ChatPanelScrollArea.vue";
import ThreadChatHeader from "@/components/thread/ThreadChatHeader.vue";
import ThreadVirtualTimeline from "@/components/thread/ThreadVirtualTimeline.vue";
import ActiveSubAgentsBar from "@/components/thread/subagent/ActiveSubAgentsBar.vue";
import MisalignmentRecoveryCard from "@/components/thread/MisalignmentRecoveryCard.vue";
import McpRuntimeStatusBar from "@/components/thread/McpRuntimeStatusBar.vue";
import ThreadRuntimeNotice from "@/components/thread/ThreadRuntimeNotice.vue";
import { useGatewayThreadTurnsStore } from "@/stores/gateway-thread-turns";
import { useChatWorkspaceState } from "./chat-workspace-state";

const {
  initializing,
  openingThread,
  selectedThreadId,
  selectedThreadStatus,
  selectedThreadPhase,
  selectedProjectId,
  selectedHostId,
  currentThread,
  historyTurns,
  loading,
  loadingOlderTurns,
  olderTurnsCursor,
  scrollToLatestToken,
  visibleError,
  selectedThreadViewReady,
} = useChatWorkspaceState();
const threadTurns = useGatewayThreadTurnsStore();

const { t } = useI18n();
const runtimeError = computed(() => {
  const error = visibleError.value;
  return error !== null && error.threadId === selectedThreadId.value ? error : null;
});
const showThreadLoading = computed(
  () =>
    initializing.value ||
    openingThread.value ||
    (Boolean(selectedThreadId.value) && !selectedThreadViewReady.value && !runtimeError.value),
);
</script>

<template>
  <div class="relative flex min-h-0 flex-1 overflow-hidden">
    <div data-testid="chat-main-pane" class="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
      <ThreadChatHeader />
      <ActiveSubAgentsBar
        v-if="selectedThreadId"
        :turns="historyTurns"
        :host-id="selectedHostId"
        :parent-thread-id="selectedThreadId"
      />
      <McpRuntimeStatusBar
        v-if="selectedThreadId"
        :host-id="selectedHostId"
        :thread-id="selectedThreadId"
      />
      <ChatPanelScrollArea
        v-if="showThreadLoading"
        class="flex items-center justify-center text-sm text-ink-muted"
      >
        <div class="flex items-center gap-2">
          <Loader2Icon class="size-4 animate-spin" />
          <span>{{ t("app.loadingGateway") }}</span>
        </div>
      </ChatPanelScrollArea>

      <ThreadVirtualTimeline
        v-else-if="selectedThreadId && historyTurns.length > 0"
        :thread-id="selectedThreadId"
        :thread-status="selectedThreadStatus"
        :turns="historyTurns"
        :host-id="selectedHostId"
        :project-id="selectedProjectId"
        :workspace-root="currentThread?.cwd ?? null"
        :loading="loading"
        :loading-older="loadingOlderTurns"
        :older-turns-cursor="olderTurnsCursor"
        :scroll-to-latest-token="scrollToLatestToken"
        @load-older="threadTurns.loadOlderTurns"
      />

      <div
        v-else-if="selectedProjectId"
        data-testid="new-thread-empty-state"
        class="flex min-h-0 flex-1 items-center overflow-y-auto px-3 py-6 md:px-[clamp(1rem,3vw,2rem)]"
      >
        <div class="flex w-full flex-col gap-6">
          <h1 data-testid="new-thread-welcome" class="text-center text-2xl font-medium text-ink">
            {{ t("app.newThreadWelcome") }}
          </h1>
          <ChatComposer placement="centered" />
        </div>
      </div>

      <ChatPanelScrollArea v-else class="flex items-center justify-center">
        <div class="mx-auto max-w-md text-center text-sm leading-6 text-ink-muted">
          <div class="mb-1 flex items-center justify-center gap-2">
            <FolderIcon class="size-4" />
            {{ t("app.selectProjectFirst") }}
          </div>
          {{ t("app.chooseProject") }}
        </div>
      </ChatPanelScrollArea>

      <MisalignmentRecoveryCard v-if="selectedThreadId" />
      <ThreadRuntimeNotice
        v-if="selectedThreadId"
        :host-id="selectedHostId"
        :project-id="selectedProjectId"
        :thread-id="selectedThreadId"
        :phase="selectedThreadPhase"
        :error="runtimeError"
      />
      <ChatComposer v-if="selectedThreadId && historyTurns.length > 0" placement="docked" />
    </div>
  </div>
</template>
