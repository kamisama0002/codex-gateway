<script setup lang="ts">
import { computed } from "vue";
import type { ThreadResponseUsage, ThreadTimelineItem } from "~~/shared/types";
import { componentForThreadItem } from "@/utils/thread-item-registry";
import type { DisplayedTurnTiming } from "@/utils/turn-timing";

const props = defineProps<{
  item: ThreadTimelineItem;
  hostId: number | null;
  threadId: string | null;
  userMessageVariant?: "normal" | "steer";
  turnTiming?: DisplayedTurnTiming | null;
  responseUsage?: ThreadResponseUsage[];
  agentActionsAvailable?: boolean;
  messageTimeMs?: number | null;
}>();

const itemComponent = computed(() => componentForThreadItem(props.item.type));
</script>

<template>
  <component
    :is="itemComponent"
    :item="item"
    :host-id="hostId"
    :thread-id="threadId"
    :variant="userMessageVariant"
    :turn-timing="item.type === 'agentMessage' ? turnTiming : undefined"
    :response-usage="item.type === 'agentMessage' ? responseUsage : undefined"
    :agent-actions-available="item.type === 'agentMessage' && agentActionsAvailable"
    :message-time-ms="
      item.type === 'userMessage' || item.type === 'agentMessage' ? messageTimeMs : undefined
    "
  />
</template>
