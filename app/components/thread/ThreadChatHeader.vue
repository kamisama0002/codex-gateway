<script setup lang="ts">
import { computed, inject } from "vue";
import { storeToRefs } from "pinia";
import { WORKSPACE_DOCK_UI_CONTEXT } from "@/components/chat/workspace-dock/context";
import { useGatewayCatalogStore } from "@/stores/gateway-catalog";
import { projectById } from "@/stores/gateway-catalog/selectors";
import { useGatewayNavigationStore } from "@/stores/gateway-navigation";
import { useGatewayThreadViewStore } from "@/stores/gateway-thread-view";
import { titleForThread } from "@/stores/gateway/thread-utils/identity";

const dockUi = inject(WORKSPACE_DOCK_UI_CONTEXT);
const navigation = useGatewayNavigationStore();
const { selectedThreadId, selectedProjectId } = storeToRefs(navigation);
const { currentThread } = storeToRefs(useGatewayThreadViewStore());
const { projects } = storeToRefs(useGatewayCatalogStore());
const selectedProject = computed(() => projectById(projects.value, selectedProjectId.value));
const visible = computed(
  () => dockUi?.layout.value !== "mobile" && Boolean(selectedThreadId.value),
);
const title = computed(() => titleForThread(currentThread.value));
</script>

<template>
  <header
    v-if="visible"
    data-testid="thread-chat-header"
    class="flex min-h-8 shrink-0 items-center border-b border-hairline px-3"
  >
    <div class="min-w-0">
      <p class="truncate text-sm leading-5 text-ink">
        {{ title }}
        <span v-if="selectedProject?.name" class="text-ink-faint"> · {{ selectedProject.name }}</span>
      </p>
    </div>
  </header>
</template>
