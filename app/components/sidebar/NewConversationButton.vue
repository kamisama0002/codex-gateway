<script setup lang="ts">
import { MessageCirclePlusIcon } from "@lucide/vue";
import { Button } from "@codex-gateway/ui/button";

defineProps<{
  disabled?: boolean;
}>();

const emit = defineEmits<{
  click: [];
}>();
</script>

<template>
  <Button
    data-testid="new-conversation-button"
    type="button"
    variant="outline"
    :disabled="disabled"
    class="h-[2.375rem] w-full justify-center gap-1.5 rounded-xl border-hairline bg-surface px-4 text-sm font-medium text-ink shadow-none hover:bg-canvas-soft"
    @click="emit('click')"
  >
    <MessageCirclePlusIcon class="size-3.5" />
    {{ $t("app.newChat") }}
  </Button>
</template>
