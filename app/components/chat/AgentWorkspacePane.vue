<script setup lang="ts">
import {
  AlertCircleIcon,
  ChevronDownIcon,
  FolderIcon,
  Loader2Icon,
  RefreshCwIcon,
} from "@lucide/vue";
import { computed } from "vue";
import ChatComposer from "@/components/chat/ChatComposer.vue";
import ChatPanelScrollArea from "@/components/chat/ChatPanelScrollArea.vue";
import ThreadVirtualTimeline from "@/components/thread/ThreadVirtualTimeline.vue";
import ActiveSubAgentsBar from "@/components/thread/subagent/ActiveSubAgentsBar.vue";
import MisalignmentRecoveryCard from "@/components/thread/MisalignmentRecoveryCard.vue";
import RealtimeConnectionIndicator from "@/components/sidebar/RealtimeConnectionIndicator.vue";
import { useGatewayThreadTurnsStore } from "@/stores/gateway-thread-turns";
import { useChatWorkspaceState } from "./chat-workspace-state";

const {
  initializing,
  openingThread,
  selectedThreadId,
  selectedThreadStatus,
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
  if (error === null || error.threadId !== selectedThreadId.value) return null;
  // A hydrated failed turn renders its own durable error row. Keep the banner for malformed or
  // not-yet-persisted failures, where otherwise the user would only see the optimistic message.
  const failedTurn = historyTurns.value.find(
    (turn) => error.turnId !== null && String(turn.id) === error.turnId,
  );
  if (failedTurn?.status === "failed" && failedTurn.error?.message) return null;
  return error;
});
const runtimeErrorDetails = computed(() => {
  const error = runtimeError.value;
  if (error?.details === null || error?.details === undefined || error.details === "") return null;
  return error.message.includes(error.details) ? null : error.details;
});
const runtimeErrorSummary = computed(() => {
  const message = runtimeError.value?.message.trim() ?? "";
  return message.split(/\r?\n/, 1)[0] || t("app.appServerError");
});
const runtimeErrorExpandedText = computed(() => {
  const error = runtimeError.value;
  if (error === null) return "";
  const messageLines = error.message.split(/\r?\n/).slice(1).join("\n").trim();
  return [messageLines, runtimeErrorDetails.value]
    .filter(
      (value, index, values): value is string => Boolean(value) && values.indexOf(value) === index,
    )
    .join("\n");
});
const showThreadLoading = computed(
  () =>
    initializing.value ||
    openingThread.value ||
    (Boolean(selectedThreadId.value) && !selectedThreadViewReady.value && !runtimeError.value),
);

async function retryFailedTurn() {
  await threadTurns.retryLastTurn();
}
</script>

<template>
  <div class="relative flex min-h-0 flex-1 overflow-hidden">
    <div data-testid="chat-main-pane" class="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
      <RealtimeConnectionIndicator class="mx-3 self-end" />
      <ActiveSubAgentsBar
        v-if="selectedThreadId"
        :turns="historyTurns"
        :host-id="selectedHostId"
        :parent-thread-id="selectedThreadId"
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

      <div
        v-if="runtimeError"
        data-testid="thread-runtime-error"
        class="mx-3 mb-2 flex min-w-0 items-start gap-2 px-1 text-xs md:mx-6"
        role="alert"
      >
        <details class="group min-w-0 flex-1">
          <summary
            class="flex min-w-0 cursor-pointer list-none items-center gap-2 rounded-md px-1 py-1 text-ink-muted hover:bg-fill-secondary [&::-webkit-details-marker]:hidden"
          >
            <AlertCircleIcon
              class="size-3.5 shrink-0"
              :class="runtimeError.transient ? 'text-amber-500' : 'text-destructive'"
              aria-hidden="true"
            />
            <span
              class="shrink-0 font-medium"
              :class="runtimeError.transient ? 'text-amber-600' : 'text-destructive'"
            >
              {{
                runtimeError.transient ? t("app.threadRetryingTitle") : t("app.threadFailedTitle")
              }}
            </span>
            <span class="min-w-0 flex-1 truncate" :title="runtimeErrorSummary">
              {{ runtimeErrorSummary }}
            </span>
            <ChevronDownIcon
              class="size-3.5 shrink-0 transition-transform group-open:rotate-180"
              aria-hidden="true"
            />
          </summary>
          <div
            v-if="runtimeErrorExpandedText"
            class="ml-7 max-h-24 overflow-y-auto whitespace-pre-wrap break-words px-1 pb-1 text-[11px] leading-4 text-ink-muted"
          >
            {{ runtimeErrorExpandedText }}
          </div>
        </details>
        <button
          v-if="runtimeError.retryable && !runtimeError.transient"
          type="button"
          class="mt-0.5 inline-flex shrink-0 items-center gap-1 rounded-md px-1.5 py-0.5 font-medium text-destructive hover:bg-destructive/10"
          data-testid="thread-runtime-error-retry"
          @click="retryFailedTurn"
        >
          <RefreshCwIcon class="size-3.5" aria-hidden="true" />
          {{ t("app.retry") }}
        </button>
      </div>

      <MisalignmentRecoveryCard v-if="selectedThreadId" />
      <ChatComposer v-if="selectedThreadId && historyTurns.length > 0" placement="docked" />
    </div>
  </div>
</template>
