<script setup lang="ts">
import type { ThreadHistoryItem, ThreadResponseUsage } from "~~/shared/types";
import { computed } from "vue";
import { Message, MessageContent } from "@codex-gateway/ai-elements/message";
import MarkdownContent from "@/components/common/MarkdownContent.vue";
import AgentMessageActions from "@/components/thread/items/AgentMessageActions.vue";
import { isItemInProgress, threadItemText } from "@/utils/thread-items";
import type { DisplayedTurnTiming } from "@/utils/turn-timing";

const props = defineProps<{
  item: ThreadHistoryItem;
  turnTiming?: DisplayedTurnTiming | null;
  responseUsage?: ThreadResponseUsage[];
  agentActionsAvailable?: boolean;
}>();

const text = computed(() => threadItemText(props.item));
const inProgress = computed(() => isItemInProgress(props.item));
const hasFooter = computed(
  () =>
    Boolean(text.value) &&
    props.agentActionsAvailable === true &&
    (props.turnTiming != null || (props.responseUsage?.length ?? 0) > 0),
);
</script>

<template>
  <Message from="assistant" class="min-w-0 max-w-full">
    <MessageContent class="min-w-0 w-full gap-0 overflow-visible text-sm leading-6 text-ink">
      <MarkdownContent :content="text" :streaming="inProgress" />
      <AgentMessageActions
        v-if="hasFooter"
        :text="text"
        :turn-timing="turnTiming"
        :response-usage="responseUsage"
      />
    </MessageContent>
  </Message>
</template>
