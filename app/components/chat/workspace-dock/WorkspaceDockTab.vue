<script setup lang="ts">
import type { IDockviewPanelHeaderProps } from "dockview-vue";
import { XIcon } from "@lucide/vue";

import { computed, onBeforeUnmount, ref } from "vue";
import type { WorkspaceDockPanelParams } from "./types";
import { requireWorkspaceDockUiContext } from "./context";
import { workspacePanelPolicy } from "./panel-registry";
import WorkspaceAgentTab from "./WorkspaceAgentTab.vue";

const props = defineProps<{ params: IDockviewPanelHeaderProps<WorkspaceDockPanelParams> }>();
const context = requireWorkspaceDockUiContext();
const kind = computed(() => props.params.params.kind);
const title = ref(props.params.api.title ?? "");
const titleSubscription = props.params.api.onDidTitleChange((event) => {
  title.value = event.title;
});
onBeforeUnmount(() => titleSubscription.dispose());
const policy = computed(() => workspacePanelPolicy(kind.value));

function closePanel(event: MouseEvent) {
  event.stopPropagation();
  const panel = props.params.containerApi.getPanel(props.params.api.id);
  if (panel) context.closePanel(panel);
}

function toggleMaximize() {
  if (context.layout.value === "mobile") return;
  if (props.params.api.isMaximized()) {
    props.params.api.exitMaximized();
  } else {
    props.params.api.maximize();
  }
}
</script>

<template>
  <div
    data-testid="workspace-dock-tab"
    :data-panel-kind="kind"
    :data-panel-title="title"
    class="group flex h-full w-full min-w-0 items-center gap-1 px-2 text-sm"
    @dblclick="toggleMaximize"
  >
    <WorkspaceAgentTab v-if="kind === 'agent'" />
    <template v-else>
      <component :is="policy.icon" class="size-3.5 shrink-0" />
      <span class="max-w-44 truncate" :title="title">{{ title }}</span>
    </template>
    <button
      v-if="policy.closable"
      type="button"
      class="ml-0.5 inline-flex size-4 items-center justify-center rounded text-ink-faint opacity-70 hover:bg-muted hover:text-ink"
      :aria-label="$t('app.closeTab')"
      @click="closePanel"
    >
      <XIcon class="size-3" />
    </button>
  </div>
</template>
