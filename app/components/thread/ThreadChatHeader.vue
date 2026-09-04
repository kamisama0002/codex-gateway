<script setup lang="ts">
import { computed, inject } from "vue";
import { storeToRefs } from "pinia";
import { WORKSPACE_DOCK_UI_CONTEXT } from "@/components/chat/workspace-dock/context";
import { useGatewayCatalogStore } from "@/stores/gateway-catalog";
import { projectById } from "@/stores/gateway-catalog/selectors";
import { useGatewayNavigationStore } from "@/stores/gateway-navigation";
import { useGatewayThreadViewStore } from "@/stores/gateway-thread-view";
import { threadTitleFallbacks, titleForThread } from "@/stores/gateway/thread-utils/identity";
import { useGatewayThreadRuntimeStore } from "@/stores/gateway-thread-runtime";
import { statusLabelKey } from "@/components/sidebar/sidebar-utils";
import ThreadStatusIndicator from "@/components/sidebar/thread-list/ThreadStatusIndicator.vue";

const dockUi = inject(WORKSPACE_DOCK_UI_CONTEXT);
const { t } = useI18n();
const navigation = useGatewayNavigationStore();
const { selectedThreadId, selectedProjectId } = storeToRefs(navigation);
const { currentThread, history } = storeToRefs(useGatewayThreadViewStore());
const { projects } = storeToRefs(useGatewayCatalogStore());
const selectedProject = computed(() => projectById(projects.value, selectedProjectId.value));
const visible = computed(
  () => dockUi?.layout.value !== "mobile" && Boolean(selectedThreadId.value),
);
const title = computed(() =>
  titleForThread(currentThread.value, threadTitleFallbacks(t), history.value),
);
const runtime = useGatewayThreadRuntimeStore();
const phase = computed(() => {
  if (navigation.selectedHostId === null || selectedThreadId.value === null) return "idle";
  return runtime.phaseFor(navigation.selectedHostId, selectedThreadId.value);
});
const showPhase = computed(() => phase.value !== "idle" && phase.value !== "completed");
</script>

<template>
  <header
    v-if="visible"
    data-testid="thread-chat-header"
    class="flex min-h-8 shrink-0 items-center border-b border-hairline px-3"
  >
    <div class="flex min-w-0 flex-1 items-center gap-2">
      <p class="truncate text-sm font-medium leading-5 text-ink">
        {{ title }}
        <span v-if="selectedProject?.name" class="text-ink-faint">
          · {{ selectedProject.name }}</span
        >
      </p>
      <div
        v-if="showPhase"
        data-testid="thread-runtime-phase"
        class="inline-flex shrink-0 items-center gap-1 text-xs text-ink-muted"
      >
        <ThreadStatusIndicator :status="phase" />
        <span>{{ $t(statusLabelKey(phase)) }}</span>
      </div>
    </div>
  </header>
</template>
