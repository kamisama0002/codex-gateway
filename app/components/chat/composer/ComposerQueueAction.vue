<script setup lang="ts">
import { Button } from "@codex-gateway/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@codex-gateway/ui/tooltip";

defineProps<{
  label: string;
  disabled?: boolean;
}>();

defineEmits<{ click: [] }>();
</script>

<template>
  <Tooltip>
    <TooltipTrigger as-child>
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        :disabled="disabled"
        :aria-label="label"
        @click="$emit('click')"
      >
        <slot />
      </Button>
    </TooltipTrigger>
    <TooltipContent>{{ label }}</TooltipContent>
  </Tooltip>
</template>
