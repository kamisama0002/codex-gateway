<script setup lang="ts">
import WorkspaceToolCatalog from "@/components/chat/workspace-tools/WorkspaceToolCatalog.vue";
import { requireWorkspaceDockUiContext } from "./context";

const { toolCatalog } = requireWorkspaceDockUiContext();
</script>

<template>
  <div
    data-testid="workspace-tool-home"
    class="flex h-full min-h-0 items-center overflow-y-auto bg-surface px-4 py-8"
  >
    <WorkspaceToolCatalog :items="toolCatalog" variant="panel" />
  </div>
</template>
