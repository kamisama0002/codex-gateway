<script setup lang="ts">
import { SidebarTrigger } from "@codex-gateway/ui/sidebar";
</script>

<template>
  <div class="flex h-10 shrink-0 items-center justify-end px-3">
    <SidebarTrigger
      data-testid="desktop-sidebar-collapse"
      class="size-8 shrink-0"
      :title="$t('app.hideSidebar')"
      :aria-label="$t('app.hideSidebar')"
    />
  </div>
</template>
