import { storeToRefs } from "pinia";
import { computed } from "vue";
import type { GatewayThread, ThreadHistoryState } from "~~/shared/types";
import type { GatewayErrorState } from "@/stores/gateway/types";
import { useGatewayBootstrapStore } from "@/stores/gateway-bootstrap";
import { useGatewayCatalogStore } from "@/stores/gateway-catalog";
import { hostById } from "@/stores/gateway-catalog/selectors";
import { useGatewayNavigationStore } from "@/stores/gateway-navigation";
import { useGatewayThreadRuntimeStore } from "@/stores/gateway-thread-runtime";
import { useGatewayThreadViewStore } from "@/stores/gateway-thread-view";
import { isManagedRuntimeHost } from "~~/shared/runtime/managed-runtime";

export function useChatWorkspaceState() {
  const bootstrapRefs = storeToRefs(useGatewayBootstrapStore());
  const catalog = useGatewayCatalogStore();
  const navigationRefs = storeToRefs(useGatewayNavigationStore());
  const selectedHost = computed(() => hostById(catalog.hosts, navigationRefs.selectedHostId.value));
  const runtime = useGatewayThreadRuntimeStore();
  const viewRefs = storeToRefs(useGatewayThreadViewStore());
  // The backend projects snapshot history once and realtime reducers update this Pinia array only
  // when data changes. A thread switch must select the cached reference, not rescan every item.
  const historyTurns = computed(() => viewRefs.timelineTurns.value);
  const selectedThreadViewReady = computed(() =>
    isSelectedThreadViewReady({
      selectedThreadId: navigationRefs.selectedThreadId.value,
      currentThread: viewRefs.currentThread.value,
      history: viewRefs.history.value,
    }),
  );
  const visibleError = computed(() =>
    scopedVisibleError({
      errors: bootstrapRefs.errors.value,
      selectedHostId: navigationRefs.selectedHostId.value,
      selectedProjectId: navigationRefs.selectedProjectId.value,
      selectedThreadId: navigationRefs.selectedThreadId.value,
    }),
  );
  return {
    ...bootstrapRefs,
    ...navigationRefs,
    ...viewRefs,
    historyTurns,
    threadItems: computed(() => historyTurns.value.flatMap((turn) => turn.items)),
    openingThread: computed(
      () =>
        navigationRefs.selectedThreadId.value !== null &&
        viewRefs.loading.value &&
        historyTurns.value.length === 0,
    ),
    selectedThreadStatus: computed(() => {
      const hostId = navigationRefs.selectedHostId.value;
      const threadId = navigationRefs.selectedThreadId.value;
      return hostId !== null && threadId !== null ? runtime.statusFor(hostId, threadId) : "idle";
    }),
    selectedThreadPhase: computed(() => {
      const hostId = navigationRefs.selectedHostId.value;
      const threadId = navigationRefs.selectedThreadId.value;
      return hostId !== null && threadId !== null ? runtime.phaseFor(hostId, threadId) : "idle";
    }),
    selectedThreadViewReady,
    visibleError,
    canOpenTerminal: computed(
      () =>
        navigationRefs.selectedHostId.value !== null &&
        (selectedHost.value === null || !isManagedRuntimeHost(selectedHost.value)),
    ),
  };
}

function isSelectedThreadViewReady(input: {
  selectedThreadId: string | null;
  currentThread: GatewayThread | null;
  history: ThreadHistoryState | null;
}) {
  if (input.selectedThreadId === null) return true;
  return (
    input.currentThread?.id === input.selectedThreadId ||
    input.history?.thread.id === input.selectedThreadId
  );
}

function scopedVisibleError(input: {
  errors: GatewayErrorState[];
  selectedHostId: number | null;
  selectedProjectId: number | null;
  selectedThreadId: string | null;
}) {
  return (
    [...input.errors]
      .reverse()
      .find(
        (current) =>
          (current.hostId === null || current.hostId === input.selectedHostId) &&
          (current.projectId === null || current.projectId === input.selectedProjectId) &&
          (current.threadId === null || current.threadId === input.selectedThreadId),
      ) ?? null
  );
}
