<script setup lang="ts">
import { PanelRightCloseIcon, PanelRightOpenIcon } from "@lucide/vue";
import { Button } from "@codex-gateway/ui/button";

defineProps<{ toolsOpen: boolean }>();
const emit = defineEmits<{
  toggleTools: [];
}>();
</script>

<template>
  <header
    class="flex min-h-11 shrink-0 items-center gap-2 border-b border-hairline bg-surface px-3 pt-[env(safe-area-inset-top)]"
  >
    <div class="flex min-w-0 basis-[34vw] flex-none items-center gap-2 overflow-hidden">
      <slot name="start" />
    </div>
    <div class="relative z-10 ml-auto flex min-w-0 flex-1 items-center justify-end gap-2">
      <Button
        data-testid="mobile-workspace-tools-toggle"
        variant="ghost"
        size="icon"
        class="size-8 shrink-0 rounded-md text-ink-muted hover:bg-muted hover:text-ink"
        :aria-label="$t(toolsOpen ? 'app.hideWorkspaceTools' : 'app.showWorkspaceTools')"
        :title="$t(toolsOpen ? 'app.hideWorkspaceTools' : 'app.showWorkspaceTools')"
        @click="emit('toggleTools')"
      >
        <PanelRightCloseIcon v-if="toolsOpen" class="size-4" />
        <PanelRightOpenIcon v-else class="size-4" />
      </Button>
    </div>
  </header>
</template>
