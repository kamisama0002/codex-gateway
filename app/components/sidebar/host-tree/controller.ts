import type { InjectionKey, Ref } from "vue";
import type { ThreadRuntimePhase } from "@/stores/gateway/types";
import type { HostRecord, ProjectRecord, SidebarThread } from "../sidebar-types";

export interface HostTreeController {
  hosts: HostRecord[];
  availableProjectsByHost: Map<number, ProjectRecord[]>;
  missingProjectsByHost: Map<number, ProjectRecord[]>;
  projectThreads: SidebarThread[];
  threadsForProject: (projectId: number) => SidebarThread[];
  expandedHostIds: Set<number>;
  expandedProjectIds: Set<number>;
  expandedMissingProjectHostIds: Set<number>;
  selectedHostId: number | null;
  selectedProjectId: number | null;
  selectedThreadId: string | null;
  hostConnectionStatuses: Record<number, { status: string; message?: string | null }>;
  longPressHandlers?: Record<string, unknown>;
  selectHost: (hostId: number) => void;
  addProject: (host: HostRecord) => void;
  deleteHost: (hostId: number) => void;
  monitorHost: (hostId: number) => void;
  selectProject: (projectId: number, event: MouseEvent) => void;
  toggleMissingProjects: (hostId: number) => void;
  editProject: (project: ProjectRecord) => void;
  deleteProject: (projectId: number) => void;
  startThreadInProject: (project: ProjectRecord) => void;
  openThread: (threadId: string, context: { hostId: number; projectId: number }) => void;
  toggleThreadPin: (threadId: string, pinned: boolean) => void;
  rename: (thread: SidebarThread & { hostId: number }) => void;
  archive: (thread: SidebarThread & { hostId: number }) => void;
  archivedFilterActive: boolean;
  archivedThreads: SidebarThread[];
  archivedLoading: boolean;
  setArchivedFilter: (active: boolean) => void;
  openArchivedThread: (thread: SidebarThread & { hostId: number; projectId: number }) => void;
  unarchive: (thread: SidebarThread & { hostId: number }) => void;
  deleteThread: (thread: SidebarThread & { hostId: number }) => void;
  threadRuntimeStatus: (hostId: number, threadId: string) => ThreadRuntimePhase;
  threadCompletionAttention: (hostId: number, threadId: string) => boolean;
}

export const HOST_TREE_CONTROLLER: InjectionKey<Ref<HostTreeController>> =
  Symbol("host-tree-controller");

export function requireHostTreeController() {
  const controller = inject(HOST_TREE_CONTROLLER);
  if (!controller) throw new Error("Host tree controller is unavailable");
  return controller;
}
