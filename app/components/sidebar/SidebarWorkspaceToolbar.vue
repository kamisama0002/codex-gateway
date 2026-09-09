<script setup lang="ts">
import { SidebarTrigger } from "@codex-gateway/ui/sidebar";
</script>

<template>
  <div class="flex h-10 shrink-0 items-center justify-between px-3">
    <div class="flex min-w-0 items-center gap-2" data-testid="gateway-brand">
      <img src="/cleaver-mark.svg" alt="" class="size-6 shrink-0" />
      <span class="truncate text-sm font-semibold tracking-tight text-ink">Cleaver</span>
    </div>
    <SidebarTrigger
      data-testid="desktop-sidebar-collapse"
      class="size-8 shrink-0"
      :title="$t('app.hideSidebar')"
      :aria-label="$t('app.hideSidebar')"
    />
  </div>
</template>
