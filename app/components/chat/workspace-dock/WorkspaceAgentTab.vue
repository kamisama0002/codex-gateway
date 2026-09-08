<script setup lang="ts">
import { computed } from "vue";
import { storeToRefs } from "pinia";
import { useGatewayCatalogStore } from "@/stores/gateway-catalog";
import { projectById } from "@/stores/gateway-catalog/selectors";
import { useGatewayNavigationStore } from "@/stores/gateway-navigation";
import { useGatewayThreadViewStore } from "@/stores/gateway-thread-view";
import { threadTitleFallbacks, titleForThread } from "@/stores/gateway/thread-utils/identity";
import { useGatewayThreadRuntimeStore } from "@/stores/gateway-thread-runtime";
import { statusLabelKey } from "@/components/sidebar/sidebar-utils";
import ThreadStatusIndicator from "@/components/sidebar/thread-list/ThreadStatusIndicator.vue";

const { t } = useI18n();
const navigation = useGatewayNavigationStore();
const { selectedThreadId, selectedProjectId } = storeToRefs(navigation);
const { currentThread, history } = storeToRefs(useGatewayThreadViewStore());
const { projects } = storeToRefs(useGatewayCatalogStore());
const runtime = useGatewayThreadRuntimeStore();

const selectedProject = computed(() => projectById(projects.value, selectedProjectId.value));
const title = computed(() => {
  if (selectedThreadId.value === null || currentThread.value === null) return t("app.newChat");
  return titleForThread(currentThread.value, threadTitleFallbacks(t), history.value);
});
const phase = computed(() => {
  if (navigation.selectedHostId === null || selectedThreadId.value === null) return "idle";
  return runtime.phaseFor(navigation.selectedHostId, selectedThreadId.value);
});
const showPhase = computed(() => phase.value !== "idle" && phase.value !== "completed");
</script>

<template>
  <div
    data-testid="workspace-agent-header"
    class="flex h-full min-w-0 items-center gap-2 px-1 text-left"
  >
    <span class="max-w-64 truncate text-sm font-medium text-ink" :title="title">{{ title }}</span>
    <span
      v-if="selectedProject?.name"
      class="max-w-40 truncate text-xs text-ink-faint"
      :title="selectedProject.name"
    >
      {{ selectedProject.name }}
    </span>
    <span
      v-if="showPhase"
      data-testid="thread-runtime-phase"
      class="inline-flex shrink-0 items-center gap-1 text-xs text-ink-muted"
    >
      <ThreadStatusIndicator :status="phase" />
      <span>{{ $t(statusLabelKey(phase)) }}</span>
    </span>
  </div>
</template>
