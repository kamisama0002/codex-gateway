<script setup lang="ts">
import type { IDockviewHeaderActionsProps } from "dockview-vue";
import { PlusIcon } from "@lucide/vue";
import { onBeforeUnmount, ref } from "vue";
import { Button } from "@codex-gateway/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@codex-gateway/ui/dropdown-menu";
import WorkspaceToolCatalog from "@/components/chat/workspace-tools/WorkspaceToolCatalog.vue";
import { TOOLS_WORKSPACE_GROUP_ID } from "./workspace-layout";
import { requireWorkspaceDockUiContext } from "./context";

const props = defineProps<{ params?: IDockviewHeaderActionsProps }>();
if (!props.params) throw new Error("Dockview header action parameters are unavailable");
const { toolCatalog } = requireWorkspaceDockUiContext();
const groupVisible = ref(props.params.group.api.isVisible);
const visibilitySubscription = props.params.group.api.onDidVisibilityChange((event) => {
  groupVisible.value = event.isVisible;
});
onBeforeUnmount(() => visibilitySubscription.dispose());
</script>

<template>
  <DropdownMenu v-if="props.params?.group.id === TOOLS_WORKSPACE_GROUP_ID && groupVisible">
    <DropdownMenuTrigger as-child>
      <Button
        data-testid="workspace-tool-menu-trigger"
        variant="ghost"
        size="icon-xs"
        class="size-6"
        :aria-label="$t('app.addWorkspaceTool')"
        :title="$t('app.addWorkspaceTool')"
      >
        <PlusIcon class="size-3.5" />
      </Button>
    </DropdownMenuTrigger>
    <DropdownMenuContent align="start" class="w-52 border-hairline">
      <WorkspaceToolCatalog :items="toolCatalog" variant="menu" />
    </DropdownMenuContent>
  </DropdownMenu>
</template>
