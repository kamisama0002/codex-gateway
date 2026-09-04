<script setup lang="ts">
import { FolderIcon, FolderOpenIcon } from "@lucide/vue";
import { computed, ref, watch } from "vue";
import type { HostRecord, ProjectRecord, RemoteDirectoryEntry } from "~~/shared/types";
import {
  isManagedRuntimeHost,
  MANAGED_WORKSPACE_PATH,
  managedWorkspaceFolderFromName,
} from "~~/shared/runtime/managed-runtime";
import { Button } from "@codex-gateway/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@codex-gateway/ui/dialog";
import { Input } from "@codex-gateway/ui/input";
import { Separator } from "@codex-gateway/ui/separator";
import { useGatewayCatalogStore } from "@/stores/gateway-catalog";
import { errorMessageLabels, messageFromError } from "@/stores/gateway/thread-utils/identity";

const open = defineModel<boolean>("open", { required: true });
const props = defineProps<{
  host: HostRecord | null;
  project?: ProjectRecord | null;
}>();

const catalog = useGatewayCatalogStore();
const { t } = useI18n();
const errorLabels = computed(() => errorMessageLabels(t));
const projectForm = ref({ name: "", remotePath: "" });
const directoryPath = ref("~");
const directories = ref<RemoteDirectoryEntry[]>([]);
const directoryError = ref("");
const browsing = ref(false);
const saving = ref(false);
const pathLocked = ref(false);
const managedHost = computed(() => props.host !== null && isManagedRuntimeHost(props.host));
const visibleDirectories = computed(() =>
  directories.value.filter((entry) => entry.type === "directory").slice(0, 12),
);
const editing = computed(() => Boolean(props.project));
const dialogTitleKey = computed(() => {
  if (editing.value) return managedHost.value ? "app.editWorkspace" : "app.editProject";
  return managedHost.value ? "app.addWorkspace" : "app.addProject";
});
const dialogDescriptionKey = computed(() => {
  if (editing.value)
    return managedHost.value ? "app.editWorkspaceDescription" : "app.editProjectDescription";
  return managedHost.value ? "app.addWorkspaceDescription" : "app.addProjectDescription";
});
const saveLabelKey = computed(() => {
  if (!editing.value) return dialogTitleKey.value;
  return managedHost.value ? "app.saveWorkspace" : "app.saveProject";
});
const defaultBrowsePath = computed(() => (managedHost.value ? MANAGED_WORKSPACE_PATH : "~"));
const canSave = computed(
  () =>
    props.host !== null &&
    projectForm.value.name.trim() !== "" &&
    projectForm.value.remotePath.trim() !== "",
);

watch(open, (isOpen) => {
  if (isOpen) {
    resetForm();
  }
});

watch(
  () => projectForm.value.name,
  (name) => {
    if (!managedHost.value || editing.value || pathLocked.value) return;
    if (name.trim() === "") {
      projectForm.value.remotePath = "";
      return;
    }
    const path = managedWorkspaceFolderFromName(name);
    projectForm.value.remotePath = path === MANAGED_WORKSPACE_PATH ? "" : path;
  },
);

async function saveProject() {
  if (!props.host || !projectForm.value.name || !projectForm.value.remotePath) {
    return;
  }
  saving.value = true;
  try {
    const input = {
      hostId: props.host.id,
      name: projectForm.value.name,
      remotePath: projectForm.value.remotePath,
    };
    if (props.project) {
      await catalog.updateProject(props.project.id, input);
    } else {
      await catalog.createProject(input);
    }
    open.value = false;
  } finally {
    saving.value = false;
  }
}

async function browseDirectories() {
  if (!props.host) {
    return;
  }
  browsing.value = true;
  directoryError.value = "";
  try {
    const result = await catalog.listRemoteDirectories(
      directoryPath.value || defaultBrowsePath.value,
      props.host.id,
    );
    directoryPath.value = result.path;
    directories.value = result.entries;
  } catch (error: unknown) {
    directories.value = [];
    directoryError.value = messageFromError(error, t("app.browseFailed"), errorLabels.value);
  } finally {
    browsing.value = false;
  }
}

function chooseDirectory(entry: RemoteDirectoryEntry) {
  directoryPath.value = entry.path;
  projectForm.value.remotePath = entry.path;
  pathLocked.value = true;
  if (!projectForm.value.name) {
    projectForm.value.name = entry.name;
  }
}

function resetForm() {
  projectForm.value = props.project
    ? { name: props.project.name, remotePath: props.project.remotePath }
    : { name: "", remotePath: "" };
  directoryPath.value = props.project?.remotePath || defaultBrowsePath.value;
  directories.value = [];
  directoryError.value = "";
  browsing.value = false;
  saving.value = false;
  pathLocked.value = Boolean(props.project);
}
</script>

<template>
  <Dialog v-model:open="open">
    <DialogContent class="flex max-h-[min(42rem,calc(100vh-2rem))] flex-col overflow-hidden">
      <DialogHeader>
        <DialogTitle>{{ t(dialogTitleKey) }}</DialogTitle>
        <DialogDescription>
          {{ t(dialogDescriptionKey, { host: host?.name ?? "" }) }}
        </DialogDescription>
      </DialogHeader>

      <div class="min-h-0 flex-1 space-y-3 overflow-y-auto">
        <div v-if="!managedHost" class="grid grid-cols-[1fr_auto] gap-2">
          <Input
            v-model="directoryPath"
            data-testid="project-browse-path-input"
            :aria-label="t('app.remotePath')"
            :placeholder="t('app.remotePath')"
          />
          <Button variant="secondary" :disabled="!host || browsing" @click="browseDirectories">
            <FolderOpenIcon class="size-4" />
            {{ t("app.browse") }}
          </Button>
        </div>

        <div v-if="!managedHost && visibleDirectories.length" class="grid grid-cols-2 gap-1">
          <Button
            v-for="entry in visibleDirectories"
            :key="entry.path"
            variant="ghost"
            class="h-9 justify-start gap-2 px-2 text-sm font-normal"
            @click="chooseDirectory(entry)"
          >
            <FolderIcon class="size-4 shrink-0" />
            <span class="truncate">{{ entry.name }}</span>
          </Button>
        </div>

        <div
          v-if="!managedHost && directoryError"
          class="whitespace-pre-line rounded-md bg-destructive/10 p-3 text-sm text-destructive"
        >
          {{ directoryError }}
        </div>

        <Separator v-if="!managedHost" />

        <div class="grid gap-3" :class="managedHost ? 'grid-cols-1' : 'md:grid-cols-2'">
          <Input
            v-model="projectForm.name"
            data-testid="project-name-input"
            :aria-label="t(managedHost ? 'app.workspaceName' : 'app.projectName')"
            :placeholder="t(managedHost ? 'app.workspaceName' : 'app.projectName')"
          />
          <Input
            v-if="!managedHost"
            v-model="projectForm.remotePath"
            data-testid="project-path-input"
            :aria-label="t('app.remotePath')"
            :placeholder="t('app.remotePath')"
            @input="pathLocked = true"
          />
        </div>
      </div>

      <Button
        data-testid="add-project-button"
        class="w-full"
        :disabled="!canSave || saving"
        @click="saveProject"
      >
        <FolderIcon class="size-4" />
        {{ t(saveLabelKey) }}
      </Button>
    </DialogContent>
  </Dialog>
</template>
