<script setup lang="ts">
import { ChartNoAxesCombinedIcon } from "@lucide/vue";
import { Button } from "@codex-gateway/ui/button";
import { SidebarTrigger } from "@codex-gateway/ui/sidebar";

defineProps<{ title: string }>();
const emit = defineEmits<{
  openHostMonitor: [];
}>();
</script>

<template>
  <div class="flex h-10 shrink-0 items-center gap-1 px-3">
    <span class="min-w-0 flex-1 truncate text-sm" :title="title">{{ title }}</span>
    <Button
      data-testid="open-host-monitor-button"
      variant="ghost"
      size="icon"
      class="size-8 shrink-0"
      :title="$t('app.openHostMonitor')"
      :aria-label="$t('app.openHostMonitor')"
      @click="emit('openHostMonitor')"
    >
      <ChartNoAxesCombinedIcon class="size-4" />
    </Button>
    <SidebarTrigger
      data-testid="desktop-sidebar-collapse"
      class="size-8 shrink-0"
      :title="$t('app.hideSidebar')"
      :aria-label="$t('app.hideSidebar')"
    />
  </div>
</template>
