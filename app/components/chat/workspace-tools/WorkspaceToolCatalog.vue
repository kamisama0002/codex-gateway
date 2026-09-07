<script setup lang="ts">
import type { Component } from "vue";
import {
  ActivityIcon,
  BotIcon,
  FilesIcon,
  GitCompareArrowsIcon,
  GlobeIcon,
  MonitorCogIcon,
  TerminalIcon,
} from "@lucide/vue";
import { Button } from "@codex-gateway/ui/button";
import { DropdownMenuItem } from "@codex-gateway/ui/dropdown-menu";
import type { WorkspaceToolCatalogItem } from "./tool-catalog";

defineProps<{
  items: WorkspaceToolCatalogItem[];
  variant: "panel" | "menu";
}>();

const icons: Record<WorkspaceToolCatalogItem["kind"], Component> = {
  files: FilesIcon,
  gitReview: GitCompareArrowsIcon,
  terminal: TerminalIcon,
  browser: GlobeIcon,
  subagent: BotIcon,
  tmux: ActivityIcon,
  hostMetrics: MonitorCogIcon,
};
</script>

<template>
  <div v-if="variant === 'panel'" class="mx-auto flex w-full max-w-lg flex-col gap-1">
    <Button
      v-for="item in items"
      :key="item.id"
      data-testid="workspace-tool-catalog-item"
      :data-tool-id="item.id"
      variant="ghost"
      class="h-auto min-h-12 w-full justify-start gap-3 rounded-md px-3 py-2 text-left"
      :disabled="item.disabled"
      :title="item.unavailableReasonKey ? $t(item.unavailableReasonKey) : undefined"
      @click="item.activate"
    >
      <component :is="icons[item.kind]" class="size-4 shrink-0 text-ink-muted" />
      <span class="min-w-0 flex-1">
        <span class="block truncate text-sm font-medium text-ink">
          {{ item.label ?? $t(item.labelKey) }}
        </span>
        <span class="block truncate text-xs font-normal text-ink-muted">
          {{ $t(item.unavailableReasonKey ?? item.descriptionKey) }}
        </span>
      </span>
    </Button>
  </div>

  <template v-else>
    <DropdownMenuItem
      v-for="item in items"
      :key="item.id"
      :disabled="item.disabled"
      class="gap-2"
      :title="item.unavailableReasonKey ? $t(item.unavailableReasonKey) : undefined"
      @select="item.activate"
    >
      <component :is="icons[item.kind]" class="size-4 shrink-0 text-ink-muted" />
      <span class="min-w-0 flex-1 truncate">{{ item.label ?? $t(item.labelKey) }}</span>
    </DropdownMenuItem>
  </template>
</template>
