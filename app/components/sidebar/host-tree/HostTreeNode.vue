<script setup lang="ts">
import { computed } from "vue";
import { FolderIcon, FolderXIcon, ChartNoAxesCombinedIcon, Trash2Icon } from "@lucide/vue";
import { Button } from "@codex-gateway/ui/button";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
} from "@codex-gateway/ui/context-menu";
import type { HostRecord } from "../sidebar-types";
import { formatRelative } from "../sidebar-utils";
import HostStatusIndicator from "./HostStatusIndicator.vue";
import SidebarProjectRow from "./SidebarProjectRow.vue";
import ThreadRow from "../thread-list/ThreadRow.vue";
import { requireHostTreeController } from "./controller";
import {
  isManagedRuntimeHost,
  isManagedWorkspaceRootProject,
} from "~~/shared/runtime/managed-runtime";

const props = defineProps<{ host: HostRecord }>();
const controller = requireHostTreeController();
const isLocalHost = computed(() => isManagedRuntimeHost(props.host));
const hostTitle = computed(() => props.host.name);

function archivedForProject(projectId: number) {
  return controller.value.archivedThreads.filter((thread) => thread.projectId === projectId);
}

function hostStatus() {
  return controller.value.hostConnectionStatuses[props.host.id]?.status ?? "idle";
}

function projectThreadsExpanded(project: { id: number; hostId: number; remotePath: string }) {
  return (
    isManagedWorkspaceRootProject(project) || controller.value.expandedProjectIds.has(project.id)
  );
}
</script>

<template>
  <div class="min-w-0 overflow-hidden">
    <ContextMenu v-if="!isLocalHost">
      <ContextMenuTrigger as-child>
        <Button
          :data-testid="`host-button-${host.id}`"
          v-bind="controller.longPressHandlers"
          variant="ghost"
          class="h-8 w-full min-w-0 justify-start gap-1.5 overflow-hidden rounded-lg px-2 text-sm font-medium text-ink-muted hover:bg-muted hover:text-ink"
          @click="controller.selectHost(host.id)"
        >
          <span class="min-w-0 flex-1 truncate text-left" :title="hostTitle">
            {{ hostTitle }}
          </span>
          <HostStatusIndicator
            :status="hostStatus()"
            :label="controller.hostConnectionStatuses[host.id]?.message"
          />
        </Button>
      </ContextMenuTrigger>
      <ContextMenuContent :collision-padding="12" prioritize-position class="w-44">
        <ContextMenuItem @select="controller.monitorHost(host.id)">
          <ChartNoAxesCombinedIcon class="mr-2 size-4" />
          {{ $t("app.openHostMonitor") }}
        </ContextMenuItem>
        <ContextMenuItem @select="controller.addProject(host)">
          <FolderIcon class="mr-2 size-4" />
          {{ $t("app.addProject") }}
        </ContextMenuItem>
        <ContextMenuItem
          class="text-destructive focus:text-destructive"
          @select="controller.deleteHost(host.id)"
        >
          <Trash2Icon class="mr-2 size-4" />
          {{ $t("app.deleteHost") }}
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>

    <div
      v-if="isLocalHost || controller.expandedHostIds.has(host.id)"
      class="min-w-0 overflow-hidden"
    >
      <div
        v-for="project in controller.availableProjectsByHost.get(host.id) ?? []"
        :key="project.id"
        class="min-w-0 overflow-hidden"
      >
        <SidebarProjectRow
          v-if="!isManagedWorkspaceRootProject(project)"
          :project="project"
          :expanded="controller.expandedProjectIds.has(project.id)"
          :selected="project.id === controller.selectedProjectId"
          :long-press-handlers="controller.longPressHandlers"
          @select="controller.selectProject(project.id, $event)"
          @edit="controller.editProject(project)"
          @delete="controller.deleteProject(project.id)"
          @start-thread="controller.startThreadInProject(project)"
        />
        <div
          v-if="projectThreadsExpanded(project)"
          class="min-w-0 space-y-0.5 overflow-hidden"
          :class="isManagedWorkspaceRootProject(project) ? '' : 'pl-5'"
        >
          <template v-if="controller.archivedFilterActive">
            <ThreadRow
              v-for="thread in archivedForProject(project.id)"
              :key="thread.id"
              compact
              :thread="thread"
              :test-id="`archived-thread-button-${thread.id}`"
              :selected="false"
              :status="controller.threadRuntimeStatus(project.hostId, String(thread.id))"
              :subtitle="formatRelative(thread.updatedAt)"
              :pin-label="$t('app.pinThread')"
              archived
              :long-press-handlers="controller.longPressHandlers"
              @open="
                controller.openArchivedThread({
                  ...thread,
                  hostId: project.hostId,
                  projectId: project.id,
                })
              "
              @unarchive="controller.unarchive({ ...thread, hostId: project.hostId })"
              @delete="controller.deleteThread({ ...thread, hostId: project.hostId })"
            />
            <div
              v-if="
                !isManagedWorkspaceRootProject(project) && !archivedForProject(project.id).length
              "
              class="px-2 py-1 text-sm text-ink-faint"
            >
              {{
                controller.archivedLoading
                  ? $t("app.loadingArchivedThreads")
                  : $t("app.noAgentsYet")
              }}
            </div>
          </template>
          <template v-else>
            <ThreadRow
              v-for="thread in controller.threadsForProject(project.id)"
              :key="thread.id"
              compact
              :thread="thread"
              :test-id="`thread-button-${thread.id}`"
              :selected="String(thread.id) === String(controller.selectedThreadId)"
              :status="controller.threadRuntimeStatus(project.hostId, String(thread.id))"
              :completion-attention="
                controller.threadCompletionAttention(project.hostId, String(thread.id))
              "
              :subtitle="formatRelative(thread.updatedAt)"
              :pin-label="thread.pinned ? $t('app.unpinThread') : $t('app.pinThread')"
              :long-press-handlers="controller.longPressHandlers"
              :show-pinned-icon="thread.pinned"
              @open="
                controller.openThread(String(thread.id), {
                  hostId: project.hostId,
                  projectId: project.id,
                })
              "
              @toggle-pin="controller.toggleThreadPin(String(thread.id), !thread.pinned)"
              @rename="controller.rename({ ...thread, hostId: project.hostId })"
              @archive="controller.archive({ ...thread, hostId: project.hostId })"
            />
            <div
              v-if="
                !isManagedWorkspaceRootProject(project) &&
                !controller.threadsForProject(project.id).length
              "
              class="px-2 py-1 text-sm text-ink-faint"
            >
              {{ $t("app.noAgentsYet") }}
            </div>
          </template>
        </div>
      </div>

      <div
        v-if="(controller.missingProjectsByHost.get(host.id)?.length ?? 0) > 0"
        class="min-w-0 overflow-hidden"
      >
        <Button
          :data-testid="`missing-projects-toggle-${host.id}`"
          variant="ghost"
          class="h-[2.125rem] w-full justify-start gap-1.5 rounded-lg px-2 text-sm font-normal text-ink-muted hover:bg-muted"
          @click="controller.toggleMissingProjects(host.id)"
        >
          <FolderXIcon class="size-3.5 shrink-0 text-destructive/70" />
          <span class="min-w-0 flex-1 truncate text-left">{{ $t("app.missingProjects") }}</span>
          <span class="shrink-0 tabular-nums text-ink-faint">{{
            controller.missingProjectsByHost.get(host.id)?.length ?? 0
          }}</span>
        </Button>
        <div
          v-if="controller.expandedMissingProjectHostIds.has(host.id)"
          class="min-w-0 space-y-0.5 overflow-hidden pl-5"
        >
          <SidebarProjectRow
            v-for="project in controller.missingProjectsByHost.get(host.id) ?? []"
            :key="project.id"
            :project="project"
            :expanded="false"
            :selected="project.id === controller.selectedProjectId"
            :missing="true"
            :long-press-handlers="controller.longPressHandlers"
            @edit="controller.editProject(project)"
            @delete="controller.deleteProject(project.id)"
          />
        </div>
      </div>

      <div
        v-if="
          !controller.availableProjectsByHost.get(host.id)?.length &&
          !controller.missingProjectsByHost.get(host.id)?.length
        "
        class="px-2 py-1 text-sm text-ink-faint"
      >
        {{ $t("app.noProjects") }}
      </div>
    </div>
  </div>
</template>
