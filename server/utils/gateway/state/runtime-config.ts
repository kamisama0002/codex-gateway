import type { GatewayConfig } from "~~/shared/types";
import { normalizeNotificationSettings, normalizePetSettings } from "~~/shared/config";
import { gatewayEventStore } from "./gateway-events";
import { gatewayMemoryState } from "./memory";
import { normalizePinnedThreads } from "./memory";
import { hostStore } from "./hosts";
import { projectStore } from "./projects";
import { subAgentThreadStore } from "./sub-agent-threads";
import { threadMetadataStore } from "./thread-metadata";
import { threadSnapshotStore } from "./thread-snapshots";
import {
  overlayPublicHosts,
  overlayPublicProjects,
  workspaceHostIds,
} from "../runtime-manager/local-workspace";

export const runtimeConfigStore = {
  replace(config: GatewayConfig) {
    hostStore.replaceHosts(config.hosts);
    projectStore.replaceProjects(config.projects ?? []);
    const hostIds = workspaceHostIds(hostStore.hostIds());
    projectStore.pruneToHosts(hostIds);
    threadMetadataStore.pruneToHosts(hostIds);
    threadSnapshotStore.pruneToHosts(hostIds);
    subAgentThreadStore.pruneToHosts(hostIds);
    gatewayEventStore.pruneToHosts(hostIds);
    gatewayMemoryState.pinnedThreads = normalizePinnedThreads(config.pinnedThreads ?? []).filter(
      (thread) => hostIds.has(thread.hostId),
    );
    gatewayMemoryState.notifications = normalizeNotificationSettings(config.notifications);
    gatewayMemoryState.pet = normalizePetSettings(config.pet);
  },

  replacePinnedThreads(pinnedThreads: GatewayConfig["pinnedThreads"]) {
    const hostIds = workspaceHostIds(hostStore.hostIds());
    gatewayMemoryState.pinnedThreads = normalizePinnedThreads(pinnedThreads).filter((thread) =>
      hostIds.has(thread.hostId),
    );
  },

  replaceNotifications(notifications: GatewayConfig["notifications"]) {
    gatewayMemoryState.notifications = normalizeNotificationSettings(notifications);
  },

  replacePet(pet: GatewayConfig["pet"]) {
    gatewayMemoryState.pet = normalizePetSettings(pet);
  },

  export(): GatewayConfig {
    return {
      version: 1,
      hosts: overlayPublicHosts(
        hostStore.listWithSecret().map((host) => ({
          ...host,
          hasPassword: Boolean(host.password),
        })),
      ),
      projects: overlayPublicProjects(projectStore.listConfigured()),
      pinnedThreads: gatewayMemoryState.pinnedThreads,
      notifications: normalizeNotificationSettings(gatewayMemoryState.notifications),
      pet: normalizePetSettings(gatewayMemoryState.pet),
    };
  },

  counts() {
    return {
      hosts: hostStore.count(),
      projects: projectStore.count(),
    };
  },
};
