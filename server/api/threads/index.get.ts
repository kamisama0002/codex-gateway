import { getValidatedQuery } from "h3";
import { threadBroker } from "../../utils/gateway/runtime/broker";
import {
  defineGatewayEventHandler,
  hostLogContext,
  setGatewayRequestLogContext,
} from "../../utils/gateway/http/errors";
import { requireRecord } from "../../utils/gateway/http/validation/common";
import { threadListSchema } from "../../utils/gateway/http/validation/threads";
import { hostStore } from "../../utils/gateway/state/hosts";
import { projectStore } from "../../utils/gateway/state/projects";
import { threadMetadataStore } from "../../utils/gateway/state/thread-metadata";
import { threadSnapshotStore } from "../../utils/gateway/state/thread-snapshots";
import { remoteFiles } from "../../utils/gateway/infra/host-services";
import { withAllThreadSources } from "../../utils/gateway/protocol/thread-list";
import { projectGatewayThreadsForList } from "../../utils/gateway/protocol/thread-list-projection";
import { threadProjectDiscovery } from "../../utils/gateway/runtime/thread-project-discovery";
import type { HostWithSecret } from "../../utils/gateway/infra/ssh/ssh-types";
import { trimmedOrNull } from "~~/shared/utils/strings";

export default defineGatewayEventHandler(async (event) => {
  const query = await getValidatedQuery(event, (body) => threadListSchema.parse(body));
  const host = requireRecord(hostStore.getWithSecret(query.hostId), "Host not found");
  const userId = event.context.auth?.user.id;
  const discoveryGeneration =
    userId === undefined ? null : threadProjectDiscovery.captureGeneration(userId, host.id);
  setGatewayRequestLogContext(event, "threads/list", {
    ...hostLogContext(host),
    projectId: query.projectId ?? null,
    cwd: query.cwd ?? null,
    limit: query.limit,
    cursor: query.cursor ?? null,
    searchTerm: query.searchTerm ?? null,
    useRemoteStateIndexOnly: query.useRemoteStateIndexOnly ?? false,
  });

  const archived = query.archived === true;
  const listParams = withAllThreadSources({
    limit: query.limit,
    cursor: trimmedOrNull(query.cursor),
    cwd: trimmedOrNull(query.cwd) ?? undefined,
    searchTerm: trimmedOrNull(query.searchTerm) ?? undefined,
    useStateDbOnly: query.useRemoteStateIndexOnly ?? false,
    ...(archived ? { archived: true } : {}),
  });
  const page = await threadBroker.listThreads(host, listParams);
  if (userId !== undefined && discoveryGeneration !== null) {
    const current = threadProjectDiscovery.indexPageIfCurrent(
      userId,
      host.id,
      discoveryGeneration,
      page,
    );
    if (current && shouldDiscoverHostProjects(query)) {
      threadProjectDiscovery.schedule(userId, host, page, listParams, discoveryGeneration);
    }
  }
  const projects = projectStore.list(host.id);
  // Host-wide metadata is the Gateway project binding written at thread/start. Do not pre-filter
  // it by cwd: a started thread can keep the requested projectId while app-server still reports a
  // previous workspace path, and cwd-scoped metadata would hide it from both project lists.
  const indexedThreads = threadMetadataStore.list(host.id);
  const gatewayThreads = projectGatewayThreadsForList({
    hostId: host.id,
    remoteThreads: page.data,
    cachedThreads: archived
      ? []
      : threadSnapshotStore.listForHost(host.id).map((record) => record.snapshot.thread),
    indexedThreads,
    projects,
    projectId: query.projectId ?? null,
    searchTerm: query.searchTerm ?? null,
    archived,
  });
  const projectDirectoryAvailability = await inspectProjectAvailability(host, projects);
  return {
    ...page,
    data: gatewayThreads,
    projects,
    projectDirectoryAvailability,
  };
});

async function inspectProjectAvailability(
  host: HostWithSecret,
  projects: Array<{ id: number; remotePath: string }>,
) {
  try {
    const byPath = await remoteFiles.inspectProjectDirectories(
      host,
      projects.map((project) => project.remotePath),
    );
    return Object.fromEntries(
      projects.flatMap((project) => {
        const availability = byPath.get(project.remotePath.trim());
        return availability === undefined ? [] : [[project.id, availability]];
      }),
    );
  } catch (error) {
    // Availability is advisory; an SFTP outage must not hide projects or fail thread listing.
    console.warn("[gateway] project directory inspection failed", {
      hostId: host.id,
      hostName: host.name,
      error: error instanceof Error ? error.message : String(error),
    });
    return {};
  }
}

function shouldDiscoverHostProjects(query: {
  projectId?: number | null;
  cwd?: string | null;
  searchTerm?: string | null;
  cursor?: string | null;
  archived?: boolean;
}) {
  return (
    query.archived !== true &&
    (query.projectId === null || query.projectId === undefined) &&
    trimmedOrNull(query.cwd) === null &&
    trimmedOrNull(query.searchTerm) === null &&
    trimmedOrNull(query.cursor) === null
  );
}
