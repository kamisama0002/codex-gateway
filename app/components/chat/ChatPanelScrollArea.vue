<script setup lang="ts">
import type { HTMLAttributes } from "vue";
import { ScrollArea } from "@codex-gateway/ui/scroll-area";

defineProps<{
  class?: HTMLAttributes["class"];
}>();
</script>

<template>
  <ScrollArea data-testid="chat-scroll-area" class="h-full min-h-0 flex-1 overflow-hidden">
    <div
      class="thread-column min-h-full px-[clamp(0.875rem,4vw,1.5rem)] py-4"
      :class="$props.class"
    >
      <slot />
    </div>
  </ScrollArea>
</template>
