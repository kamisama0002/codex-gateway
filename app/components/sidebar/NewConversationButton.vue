<script setup lang="ts">
import { PlusIcon } from "@lucide/vue";
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
    variant="secondary"
    :disabled="disabled"
    class="h-10 w-full justify-start gap-2 rounded-xl px-3 text-sm font-normal text-ink shadow-none"
    @click="emit('click')"
  >
    <span
      class="inline-flex size-5 shrink-0 items-center justify-center rounded-full border border-ink-muted/40"
    >
      <PlusIcon class="size-3.5" />
    </span>
    {{ $t("app.newChat") }}
  </Button>
</template>
