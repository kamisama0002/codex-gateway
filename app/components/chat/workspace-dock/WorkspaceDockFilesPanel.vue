<script setup lang="ts">
import type { IDockviewPanelProps } from "dockview-vue";
import { onBeforeUnmount, ref } from "vue";
import FileWorkspacePane from "@/components/files/FileWorkspacePane.vue";

import { requireWorkspaceFilesPanelContext } from "./context";

const props = defineProps<{ params: IDockviewPanelProps }>();
const context = requireWorkspaceFilesPanelContext();
const visible = ref(props.params.api.isVisible);
const visibilitySubscription = props.params.api.onDidVisibilityChange((event) => {
  visible.value = event.isVisible;
});
onBeforeUnmount(() => visibilitySubscription.dispose());
</script>

<template>
  <div class="flex h-full min-h-0 flex-col overflow-hidden">
    <FileWorkspacePane
      v-if="context.selectedHostId.value && context.workspaceThreadId.value"
      :layout="context.layout.value"
      :host-id="context.selectedHostId.value"
      :project-id="context.selectedProjectId.value"
      :thread-id="context.workspaceThreadId.value"
      :root-path="context.rootPath.value"
      :active="visible"
    />
  </div>
</template>
