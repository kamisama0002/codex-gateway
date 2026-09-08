<script setup lang="ts">
import type { IDockviewHeaderActionsProps } from "dockview-vue";
import {
  ArrowDownToLineIcon,
  Maximize2Icon,
  PanelRightCloseIcon,
  PanelRightOpenIcon,
  PictureInPicture2Icon,
  Rows3Icon,
} from "@lucide/vue";
import { computed, onBeforeUnmount, ref } from "vue";
import { Button } from "@codex-gateway/ui/button";

import { floatDockItem, popoutDockItem } from "./actions";
import { requireWorkspaceDockUiContext } from "./context";
import { AGENT_WORKSPACE_GROUP_ID, TOOLS_WORKSPACE_GROUP_ID } from "./workspace-layout";

const props = defineProps<{ params?: IDockviewHeaderActionsProps }>();
if (!props.params) throw new Error("Dockview header action parameters are unavailable");
const params = props.params;
const { t } = useI18n();
const dockUi = requireWorkspaceDockUiContext();
const location = ref(params.group.api.location.type);
const groupVisible = ref(params.group.api.isVisible);
const locationSubscription = params.group.api.onDidLocationChange((event) => {
  location.value = event.location.type;
  syncDetachmentAvailability();
});
const visibilitySubscription = params.group.api.onDidVisibilityChange((event) => {
  groupVisible.value = event.isVisible;
});
const canDetach = ref(false);
const layoutSubscription = params.containerApi.onDidLayoutChange(syncDetachmentAvailability);
const detachmentDisabled = computed(() => location.value === "grid" && !canDetach.value);
syncDetachmentAvailability();
onBeforeUnmount(() => {
  locationSubscription.dispose();
  visibilitySubscription.dispose();
  layoutSubscription.dispose();
});

function syncDetachmentAvailability() {
  const referenceGroupId = oppositeFixedGroupId();
  const referenceGroup = params.containerApi.groups.find(({ id }) => id === referenceGroupId);
  canDetach.value =
    referenceGroup?.api.location.type === "grid" && referenceGroup.api.isVisible === true;
}

function oppositeFixedGroupId() {
  return params.group.id === AGENT_WORKSPACE_GROUP_ID
    ? TOOLS_WORKSPACE_GROUP_ID
    : AGENT_WORKSPACE_GROUP_ID;
}

function toggleMaximize() {
  const api = params.group.api;
  if (api.isMaximized()) {
    api.exitMaximized();
  } else {
    api.maximize();
  }
}

function toggleFloating() {
  if (location.value === "floating" || location.value === "popout") {
    const referenceGroup = params.containerApi.groups.find(
      ({ id, api }) => id === oppositeFixedGroupId() && api.location.type === "grid",
    );
    if (!referenceGroup) return;
    params.group.api.moveTo({
      group: referenceGroup,
      position: params.group.id === AGENT_WORKSPACE_GROUP_ID ? "left" : "right",
    });
  } else {
    if (detachmentDisabled.value) return;
    floatDockItem(params.containerApi, params.group);
  }
}

function popout() {
  if (detachmentDisabled.value) return;
  void popoutDockItem(params.containerApi, params.group, {
    title: t("app.popupBlocked"),
    description: t("app.popupBlockedDescription"),
  });
}
</script>

<template>
  <div v-if="groupVisible" class="flex h-full items-center gap-px px-0.5">
    <Button
      variant="ghost"
      size="icon-xs"
      class="size-6"
      :aria-label="$t('app.maximizePanel')"
      @click="toggleMaximize"
    >
      <Maximize2Icon class="size-3" />
    </Button>
    <Button
      variant="ghost"
      size="icon-xs"
      class="size-6"
      :disabled="detachmentDisabled"
      :aria-label="$t('app.floatPanel')"
      @click="toggleFloating"
    >
      <Rows3Icon v-if="location === 'floating' || location === 'popout'" class="size-3" />
      <PictureInPicture2Icon v-else class="size-3" />
    </Button>
    <Button
      v-if="location !== 'popout'"
      data-testid="dock-popout-group"
      variant="ghost"
      size="icon-xs"
      class="size-6"
      :disabled="detachmentDisabled"
      :aria-label="$t('app.popoutPanel')"
      @click="popout"
    >
      <ArrowDownToLineIcon class="size-3" />
    </Button>
    <span class="mx-0.5 h-4 border-l border-hairline" />
    <Button
      data-testid="workspace-tool-sidebar-toggle"
      variant="ghost"
      size="icon-xs"
      class="size-6"
      :aria-label="
        $t(dockUi.toolSidebarOpen.value ? 'app.hideWorkspaceTools' : 'app.showWorkspaceTools')
      "
      :title="
        $t(dockUi.toolSidebarOpen.value ? 'app.hideWorkspaceTools' : 'app.showWorkspaceTools')
      "
      @click="dockUi.toggleToolSidebar"
    >
      <PanelRightCloseIcon v-if="dockUi.toolSidebarOpen.value" class="size-3" />
      <PanelRightOpenIcon v-else class="size-3" />
    </Button>
  </div>
</template>
