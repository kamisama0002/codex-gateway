import { defineStore, skipHydrate } from "pinia";
import { ref } from "vue";
import { useAccountLocalStorage } from "@/composables/storage/useAccountLocalStorage";
import type { GatewayThread } from "~~/shared/types";
import type { GatewayRouteSelection } from "@/stores/gateway/route-state";
import { createThreadListActions } from "./actions/thread-list";
import { createThreadPinningActions } from "./actions/thread-pinning";
import { createThreadLifecycleActions } from "./actions/thread-lifecycle";

const emptySelection = (): GatewayRouteSelection => ({
  hostId: null,
  projectId: null,
  threadId: null,
});

export const useGatewayNavigationStore = defineStore("gateway-navigation", () => {
  const lastOpenThread = useAccountLocalStorage<GatewayRouteSelection>(
    "last-open-thread",
    emptySelection(),
  );
  const threads = ref<GatewayThread[]>([]);
  const hostThreads = ref<GatewayThread[]>([]);
  const archivedThreads = ref<GatewayThread[]>([]);
  const archivedFilterActive = ref(false);
  const archivedLoading = ref(false);
  const archivedLoadedKey = ref<string | null>(null);
  const selectedHostId = ref<number | null>(null);
  const selectedProjectId = ref<number | null>(null);
  const selectedThreadId = ref<string | null>(null);
  const openingPinnedThreadKey = ref<string | null>(null);
  const actions = {
    ...createThreadListActions(),
    ...createThreadPinningActions(),
    ...createThreadLifecycleActions(),
  };

  function rememberOpenThread(selection: GatewayRouteSelection) {
    lastOpenThread.value = { ...selection };
  }

  function resetState() {
    threads.value = [];
    hostThreads.value = [];
    archivedThreads.value = [];
    archivedFilterActive.value = false;
    archivedLoading.value = false;
    archivedLoadedKey.value = null;
    selectedHostId.value = null;
    selectedProjectId.value = null;
    selectedThreadId.value = null;
    openingPinnedThreadKey.value = null;
  }

  return {
    lastOpenThread: skipHydrate(lastOpenThread),
    threads,
    hostThreads,
    archivedThreads,
    archivedFilterActive,
    archivedLoading,
    archivedLoadedKey,
    selectedHostId,
    selectedProjectId,
    selectedThreadId,
    openingPinnedThreadKey,
    rememberOpenThread,
    resetState,
    ...actions,
  };
});
