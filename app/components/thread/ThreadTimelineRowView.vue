<script setup lang="ts">
import IntermediateStepsToggle from "@/components/thread/IntermediateStepsToggle.vue";
import ThreadItemView from "@/components/thread/ThreadItemView.vue";
import TurnDurationLabel from "@/components/thread/TurnDurationLabel.vue";
import TurnUsageAmountLabel from "@/components/thread/TurnUsageAmountLabel.vue";
import type { ThreadTimelineRow } from "@/components/thread/timeline-rows";

const props = defineProps<{
  row: ThreadTimelineRow;
  hostId: number | null;
  threadId: string | null;
}>();

const emit = defineEmits<{
  intermediateToggle: [turnId: string, open: boolean];
}>();

// Read the reactive row directly. App-server stream reducers update nested item proxies in place;
// cloning them into a presentation snapshot hides those deltas from Vue and prevents TanStack's
// ResizeObserver from seeing the new height. TanStack owns mounting and position, not data flow.
</script>

<template>
  <IntermediateStepsToggle
    v-if="props.row.type === 'intermediateHeader'"
    :open="props.row.open"
    :count="props.row.count"
    :tool-call-count="props.row.toolCallCount"
    :message-count="props.row.messageCount"
    :subagent-count="props.row.subagentCount"
    :loading="props.row.loading"
    :loaded="props.row.loaded"
    :active="props.row.active"
    @toggle="emit('intermediateToggle', props.row.turnId, $event)"
  />
  <ThreadItemView
    v-else-if="props.row.type === 'item'"
    :item="props.row.item"
    :host-id="hostId"
    :thread-id="threadId"
    :user-message-variant="props.row.userMessageVariant"
    :turn-timing="props.row.turnTiming"
    :response-usage="props.row.responseUsage"
    :agent-actions-available="props.row.agentActionsAvailable"
  />
  <div v-else class="flex items-center gap-3">
    <TurnDurationLabel :timing="props.row" />
    <TurnUsageAmountLabel :usage="props.row.responseUsage" />
  </div>
</template>
