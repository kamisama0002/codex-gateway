import { storeToRefs } from "pinia";
import { computed, nextTick, ref, watch, type Ref } from "vue";
import { useGatewayCatalogStore } from "@/stores/gateway-catalog";
import { useGatewayPinnedThreads } from "@/stores/gateway-config";
import { useGatewayNavigationStore } from "@/stores/gateway-navigation";
import { useGatewayThreadActivityStore } from "@/stores/gateway-thread-activity";
import { useGatewayThreadRuntimeStore } from "@/stores/gateway-thread-runtime";
import { useGatewayThreadViewStore } from "@/stores/gateway-thread-view";
import {
  pinnedThreadId,
  pinnedThreadKey,
  sortPinnedThreadsForDisplay,
  threadKey,
} from "../sidebar-utils";
import type { PinnedThreadRecord, ProjectRecord, SidebarThread } from "../sidebar-types";
import { firstNonEmptyString } from "~~/shared/utils/strings";
import { isManagedWorkspaceRootProject } from "~~/shared/runtime/managed-runtime";
import {
  findReusableEmptyThread,
  isEmptyThreadHistory,
} from "@/stores/gateway/thread-utils/identity";

export function useSidebarTree(longPressTriggered: Ref<boolean>) {
  const store = useGatewayCatalogStore();
  const navigation = useGatewayNavigationStore();
  const activity = useGatewayThreadActivityStore();
  const runtime = useGatewayThreadRuntimeStore();
  const threadView = useGatewayThreadViewStore();
  const { hosts, projects, projectDirectoryAvailability, hostConnectionStatuses } =
    storeToRefs(store);
  const storedPinnedThreads = useGatewayPinnedThreads();
  const {
    threads,
    hostThreads,
    openingPinnedThreadKey,
    selectedHostId,
    selectedProjectId,
    selectedThreadId,
  } = storeToRefs(navigation);
  const { unviewedCompletedThreadKeys } = storeToRefs(runtime);
  const { observedRunningThreadKeys, summariesByKey } = storeToRefs(activity);
  const expandedHostIds = ref<Set<number>>(new Set());
  const expandedProjectIds = ref<Set<number>>(new Set());
  const expandedMissingProjectHostIds = ref<Set<number>>(new Set());
  const suppressTreeAutoExpand = ref(false);
  const newConversationPending = ref(false);
  const pinnedThreads = computed(() =>
    sortPinnedThreadsForDisplay(storedPinnedThreads.value, hosts.value),
  );
  const newConversationProject = computed(() => {
    const hostId = selectedHostId.value;
    if (hostId === null) return undefined;
    const selected = projects.value.find(
      (project) => project.id === selectedProjectId.value && project.hostId === hostId,
    );
    return (
      selected ??
      projects.value.find(
        (project) => project.hostId === hostId && isManagedWorkspaceRootProject(project),
      )
    );
  });
  const canStartNewConversation = computed(() => newConversationProject.value !== undefined);

  const projectThreads = computed(() =>
    threads.value.filter((thread) => thread.pinned !== true).slice(0, 20),
  );

  function threadsForProject(projectId: number) {
    const selectedSource = projectThreads.value.filter((thread) => thread.projectId === projectId);
    const source =
      projectId === selectedProjectId.value && selectedSource.length > 0
        ? selectedSource
        : hostThreads.value;
    const catalogThreads = source.filter(
      (thread) => thread.projectId === projectId && thread.pinned !== true,
    );
    const catalogIds = new Set(catalogThreads.map((thread) => String(thread.id)));
    const pinnedKeys = new Set(pinnedThreads.value.map(pinnedThreadKey));
    const activityThreads = observedRunningThreadKeys.value
      .flatMap((key): SidebarThread[] => {
        const summary = summariesByKey.value[key];
        if (
          summary === undefined ||
          summary.projectId !== projectId ||
          summary.isSubAgent ||
          catalogIds.has(summary.threadId) ||
          pinnedKeys.has(threadKey(summary.hostId, summary.threadId))
        ) {
          return [];
        }
        return [
          {
            id: summary.threadId,
            hostId: summary.hostId,
            projectId: summary.projectId,
            title: summary.title,
            updatedAt: summary.updatedAt,
          },
        ];
      })
      .toSorted((left, right) => Number(right.updatedAt ?? 0) - Number(left.updatedAt ?? 0));
    return [...activityThreads, ...catalogThreads].slice(0, 20);
  }
  const selectedThreadIsPinned = computed(() => {
    if (
      selectedHostId.value === null ||
      selectedThreadId.value === null ||
      selectedThreadId.value === ""
    ) {
      return false;
    }
    return pinnedThreads.value.some(
      (thread) =>
        thread.hostId === selectedHostId.value &&
        pinnedThreadId(thread) === String(selectedThreadId.value),
    );
  });
  const availableProjectsByHost = computed(() => groupProjectsByHost(false));
  const missingProjectsByHost = computed(() => groupProjectsByHost(true));

  function groupProjectsByHost(missing: boolean) {
    const byHost = new Map<number, typeof projects.value>();
    for (const project of projects.value) {
      if ((projectDirectoryAvailability.value[project.id] === "missing") !== missing) {
        continue;
      }
      const group = byHost.get(project.hostId) ?? [];
      group.push(project);
      byHost.set(project.hostId, group);
    }
    return byHost;
  }

  function openThread(
    threadId: string,
    context?: { hostId?: number; projectId?: number | null; replaceRoute?: boolean },
  ) {
    if (longPressTriggered.value) {
      return;
    }
    void threadView.openThread(threadId, context);
  }

  function openPinnedThread(thread: PinnedThreadRecord) {
    if (longPressTriggered.value) {
      return;
    }
    suppressTreeAutoExpand.value = true;
    void navigation.openPinnedThread(thread).finally(() => {
      void nextTick().then(() => {
        expandedHostIds.value = new Set();
        expandedProjectIds.value = new Set();
        suppressTreeAutoExpand.value = false;
      });
    });
  }

  function selectHost(hostId: number) {
    const next = new Set(expandedHostIds.value);
    if (next.has(hostId)) {
      next.delete(hostId);
    } else {
      next.add(hostId);
    }
    expandedHostIds.value = next;
    if (hostId !== selectedHostId.value) {
      void store.selectHost(hostId);
    }
  }

  function selectProject(projectId: number, event?: MouseEvent) {
    if (longPressTriggered.value) {
      return;
    }
    if (event !== undefined && event.button !== 0) {
      return;
    }
    const isProjectListVisible =
      projectId === selectedProjectId.value &&
      (selectedThreadId.value === null || selectedThreadId.value === "");
    const next = new Set(expandedProjectIds.value);
    if (next.has(projectId) && isProjectListVisible) {
      next.delete(projectId);
    } else {
      next.add(projectId);
    }
    expandedProjectIds.value = next;
    if (!isProjectListVisible) {
      void store.selectProject(projectId);
    }
  }

  function expandAllTree() {
    const nextHosts = new Set(expandedHostIds.value);
    const nextProjects = new Set(expandedProjectIds.value);
    for (const host of hosts.value) nextHosts.add(host.id);
    for (const project of projects.value) nextProjects.add(project.id);
    expandedHostIds.value = nextHosts;
    expandedProjectIds.value = nextProjects;
  }

  function toggleMissingProjects(hostId: number) {
    const next = new Set(expandedMissingProjectHostIds.value);
    if (next.has(hostId)) next.delete(hostId);
    else next.add(hostId);
    expandedMissingProjectHostIds.value = next;
  }

  function startThreadInProject(project: ProjectRecord) {
    return threadView.startThread(
      {
        model:
          firstNonEmptyString([store.defaultModel?.model, store.defaultModel?.id]) ?? undefined,
      },
      {
        hostId: project.hostId,
        projectId: project.id,
      },
    );
  }

  async function startNewConversation() {
    if (newConversationPending.value) return;
    const project = newConversationProject.value;
    if (project === undefined) return;
    threadView.cacheSelectedThreadView();
    if (
      selectedHostId.value === project.hostId &&
      selectedProjectId.value === project.id &&
      selectedThreadId.value !== null &&
      isEmptyThreadHistory(threadView.history)
    ) {
      return;
    }
    const cachedThreads = Object.values(threadView.threadViews).flatMap((view) =>
      view.currentThread === null
        ? []
        : [
            {
              ...view.currentThread,
              hostId: view.hostId,
              projectId: view.projectId,
              history: view.history,
            },
          ],
    );
    const reusable = findReusableEmptyThread(cachedThreads, {
      hostId: project.hostId,
      projectId: project.id,
    });
    newConversationPending.value = true;
    try {
      if (reusable !== null) {
        await threadView.openThread(String(reusable.id), {
          hostId: project.hostId,
          projectId: project.id,
        });
        return;
      }
      await startThreadInProject(project);
    } finally {
      newConversationPending.value = false;
    }
  }

  function threadHistory(hostId: number, threadId: string) {
    if (selectedHostId.value === hostId && selectedThreadId.value === threadId) {
      return threadView.history;
    }
    return threadView.threadViews[threadKey(hostId, threadId)]?.history ?? null;
  }

  function threadRuntimeStatus(hostId: number, threadId: string) {
    return runtime.phaseFor(hostId, threadId);
  }

  function threadCompletionAttention(hostId: number, threadId: string) {
    return unviewedCompletedThreadKeys.value.includes(threadKey(hostId, threadId));
  }

  function pinnedRuntimeStatus(thread: PinnedThreadRecord) {
    const key = pinnedThreadKey(thread);
    if (openingPinnedThreadKey.value === key) {
      return "submitting";
    }
    return threadRuntimeStatus(thread.hostId, String(thread.threadId));
  }

  function pinnedCompletionAttention(thread: PinnedThreadRecord) {
    return threadCompletionAttention(thread.hostId, pinnedThreadId(thread));
  }

  watch(
    selectedHostId,
    (hostId) => {
      if (suppressTreeAutoExpand.value) return;
      if (selectedThreadIsPinned.value) return;
      if (hostId === null) return;
      expandedHostIds.value = new Set(expandedHostIds.value).add(hostId);
    },
    { immediate: true },
  );

  watch(
    selectedProjectId,
    (projectId) => {
      if (suppressTreeAutoExpand.value) return;
      if (selectedThreadIsPinned.value) return;
      if (projectId === null) return;
      expandedProjectIds.value = new Set(expandedProjectIds.value).add(projectId);
    },
    { immediate: true },
  );

  watch(selectedThreadIsPinned, (isPinned) => {
    if (isPinned) {
      expandedHostIds.value = new Set();
      expandedProjectIds.value = new Set();
      return;
    }
    if (suppressTreeAutoExpand.value) return;
    if (selectedHostId.value !== null) {
      expandedHostIds.value = new Set(expandedHostIds.value).add(selectedHostId.value);
    }
    if (selectedProjectId.value !== null) {
      expandedProjectIds.value = new Set(expandedProjectIds.value).add(selectedProjectId.value);
    }
  });

  watch(
    [selectedProjectId, projectDirectoryAvailability],
    ([projectId]) => {
      if (projectId === null || projectDirectoryAvailability.value[projectId] !== "missing") return;
      const project = projects.value.find((item) => item.id === projectId);
      if (project === undefined) return;
      expandedMissingProjectHostIds.value = new Set(expandedMissingProjectHostIds.value).add(
        project.hostId,
      );
    },
    { immediate: true, deep: true },
  );

  return {
    hosts,
    threads,
    projects,
    pinnedThreads,
    canStartNewConversation,
    newConversationPending,
    hostConnectionStatuses,
    selectedHostId,
    selectedProjectId,
    selectedThreadId,
    expandedHostIds,
    expandedProjectIds,
    expandedMissingProjectHostIds,
    projectThreads,
    threadsForProject,
    availableProjectsByHost,
    missingProjectsByHost,
    openThread,
    openPinnedThread,
    selectHost,
    selectProject,
    expandAllTree,
    toggleMissingProjects,
    startThreadInProject,
    startNewConversation,
    threadHistory,
    threadRuntimeStatus,
    threadCompletionAttention,
    pinnedRuntimeStatus,
    pinnedCompletionAttention,
  };
}
