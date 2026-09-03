import type { AppServerThread, GatewayThread, ProjectRecord } from "~~/shared/types";
import { gatewayThreadFromAppServer } from "./gateway-thread";

export interface ThreadListIndexRecord {
  id: string;
  projectId: number | null;
  cwd: string | null;
}

export function projectGatewayThreadsForList(input: {
  hostId: number;
  remoteThreads: AppServerThread[];
  cachedThreads: AppServerThread[];
  indexedThreads: ThreadListIndexRecord[];
  projects: ProjectRecord[];
  projectId?: number | null;
  searchTerm: string | null;
  archived: boolean;
}): GatewayThread[] {
  const metadataById = new Map(input.indexedThreads.map((thread) => [thread.id, thread]));
  const threadsById = new Map(input.remoteThreads.map((thread) => [thread.id, thread]));
  if (!input.archived) {
    for (const thread of input.cachedThreads) {
      const metadata = metadataById.get(thread.id);
      if (metadata === undefined || threadsById.has(thread.id)) continue;
      if (input.projectId != null && metadata.projectId !== input.projectId) continue;
      // A freshly started thread can precede rollout materialization and therefore be absent from
      // thread/list briefly. The open snapshot is the complete official DTO returned by
      // thread/start; never synthesize an AppServerThread from the metadata index.
      threadsById.set(thread.id, thread);
    }
  }
  const normalizedSearch = input.searchTerm?.trim().toLowerCase() ?? "";
  return [...threadsById.values()]
    .map((thread) => {
      const metadata = metadataById.get(thread.id);
      const projectId =
        metadata?.projectId ??
        input.projects.find((project) => project.remotePath === thread.cwd)?.id ??
        null;
      return gatewayThreadFromAppServer(input.hostId, projectId, thread);
    })
    .filter((thread) => {
      if (input.projectId != null && thread.projectId !== input.projectId) {
        return false;
      }
      if (!normalizedSearch) {
        return true;
      }
      return [thread.id, thread.title, thread.name, thread.preview, thread.cwd]
        .filter((value): value is string => typeof value === "string")
        .some((value) => String(value).toLowerCase().includes(normalizedSearch));
    })
    .sort(
      (left, right) =>
        Number(right.recencyAt ?? right.updatedAt ?? 0) -
        Number(left.recencyAt ?? left.updatedAt ?? 0),
    );
}
