<script setup lang="ts">
import { computed, ref, toRef, watch } from "vue";
import type { ThreadRuntimeStatus, ThreadTimelineTurn } from "~~/shared/types";
import { Button } from "@codex-gateway/ui/button";
import ThreadTimelineRowView from "@/components/thread/ThreadTimelineRowView.vue";
import VirtualTimelineViewport from "@/components/thread/VirtualTimelineViewport.vue";
import {
  buildThreadTimelineRows,
  estimateThreadTimelineRow,
  reuseUnchangedTimelineRows,
  type ThreadTimelineRow,
} from "@/components/thread/timeline-rows";
import { buildThreadTurnSections } from "@/components/thread/thread-turn-sections";
import { useIntermediateStepsDisclosure } from "@/components/thread/useIntermediateStepsDisclosure";
import { provideFilePreviewContext } from "@/composables/files/useFilePreviewContext";
import { useGatewayComposerStore } from "@/stores/gateway-composer";
import { useGatewayThreadTurnsStore } from "@/stores/gateway-thread-turns";
import { collaborationModeFromThreadSettings } from "@/utils/thread-collaboration-mode";

const props = defineProps<{
  threadId: string | null;
  threadStatus: ThreadRuntimeStatus;
  turns: ThreadTimelineTurn[];
  hostId: number | null;
  projectId?: number | null;
  workspaceRoot?: string | null;
  loading: boolean;
  loadingOlder: boolean;
  olderTurnsCursor: string | null;
  scrollToLatestToken?: number;
}>();

const emit = defineEmits<{
  loadOlder: [];
}>();

const { t } = useI18n();
const composer = useGatewayComposerStore();
const threadTurns = useGatewayThreadTurnsStore();
const userDetachedFromLatest = ref(false);
const projectId = computed(() => props.projectId ?? null);
const planModeActive = computed(() => selectedThreadMode() === "plan");
const threadIsRunning = computed(() => props.threadStatus === "running");
const autoCollapseIntermediate = computed(() => !userDetachedFromLatest.value);

provideFilePreviewContext({
  hostId: toRef(props, "hostId"),
  projectId,
  threadId: toRef(props, "threadId"),
  workspaceRoot: computed(() => props.workspaceRoot ?? null),
});

const turnStates = computed(() =>
  props.turns.map((turn) => ({
    turn,
    sections: buildThreadTurnSections(turn, { planModeActive: planModeActive.value }),
  })),
);
const disclosureTurns = computed(() =>
  turnStates.value.map(({ turn, sections }) => ({
    id: turn.id,
    status: turn.status,
    items: sections.items,
    turnIsActive: sections.turnIsActive,
  })),
);
const { isIntermediateOpen, setIntermediateOpen } = useIntermediateStepsDisclosure({
  turns: disclosureTurns,
  threadIsRunning,
  autoCollapseIntermediate,
});
function isTurnItemsLoading(turnId: string) {
  if (props.hostId === null || props.threadId === null) return false;
  const key = threadTurns.turnItemsKey(props.hostId, props.threadId, turnId);
  return threadTurns.loadingTurnItemsByKey[key] === true;
}
const rows = computed<ThreadTimelineRow[]>((previous) => {
  const timelineTurns = turnStates.value.map(({ turn, sections }) => ({
    turn,
    sections,
    intermediateOpen: isIntermediateOpen(turn.id),
    intermediateLoading: isTurnItemsLoading(turn.id),
  }));
  // The disclosure controller owns only process visibility. A reader reopening completed work
  // must not lose the answer's copy, duration, or usage actions; those depend solely on whether the
  // Agent loop is still active across automatic continuations and Goals.
  const agentActionsAvailable = !threadIsRunning.value;
  const next = buildThreadTimelineRows({
    threadId: props.threadId,
    turns: timelineTurns,
    agentActionsAvailable,
  });
  // A streaming delta invalidates the row list but normally changes only one item. Preserve all
  // other row identities so Vue and Markdown renderers do not repeat work inside the virtual
  // viewport; TanStack can then measure only the row whose content actually changed.
  return reuseUnchangedTimelineRows(previous, next);
});

function selectedThreadMode() {
  if (!props.hostId || !props.threadId) return "default";
  return collaborationModeFromThreadSettings(
    composer.threadSettingsByKey[`${props.hostId}:${props.threadId}`],
  );
}

function handleReachStart() {
  if (props.olderTurnsCursor && !props.loadingOlder) emit("loadOlder");
}

function handleUserDetachedChange(detached: boolean) {
  userDetachedFromLatest.value = detached;
}

async function handleIntermediateToggle(turnId: string, open: boolean) {
  if (!open) {
    setIntermediateOpen(turnId, false);
    return;
  }
  const turn = props.turns.find((candidate) => candidate.id === turnId);
  if (turn?.itemsView !== "full" && !(await threadTurns.loadTurnItems(turnId))) return;
  setIntermediateOpen(turnId, true);
}

function estimateRowSize(row: unknown) {
  return estimateThreadTimelineRow(row as ThreadTimelineRow | undefined);
}

function timelineRow(row: unknown) {
  return row as ThreadTimelineRow;
}

watch(
  () => props.threadId,
  () => {
    // Detachment belongs to the conversation being read, so it must not leak into the next
    // thread's disclosure policy. Scroll initialization is deliberately absent here: the keyed
    // viewport below owns its one official TanStack initial-layout transaction.
    userDetachedFromLatest.value = false;
  },
);
</script>

<template>
  <!--
    Key the viewport by thread so each conversation gets one clean TanStack Chat lifecycle.
    Do not also watch threadId and imperatively reset the child: after a keyed replacement the ref
    already points at the new viewport, so a parent reset would duplicate its initial layout scroll.
  -->
  <VirtualTimelineViewport
    :key="threadId ?? 'empty-thread'"
    :rows="rows"
    :estimate-size="estimateRowSize"
    :scroll-to-latest-token="scrollToLatestToken"
    @reach-start="handleReachStart"
    @user-detached-change="handleUserDetachedChange"
  >
    <template #overlay="{ visible }">
      <div v-if="olderTurnsCursor && visible" class="pointer-events-auto flex justify-center pt-2">
        <Button
          data-testid="load-older-turns-button"
          variant="outline"
          size="sm"
          :disabled="loadingOlder"
          @click="emit('loadOlder')"
        >
          {{ loadingOlder ? t("app.loadingOlder") : t("app.loadOlder") }}
        </Button>
      </div>
    </template>

    <template #default="{ row }">
      <ThreadTimelineRowView
        :row="timelineRow(row)"
        :host-id="hostId"
        :thread-id="threadId"
        @intermediate-toggle="handleIntermediateToggle"
      />
    </template>
  </VirtualTimelineViewport>
</template>
