<script setup lang="ts">
import { Loader2Icon, PencilIcon, PlusIcon, RefreshCwIcon, ServerIcon } from "@lucide/vue";
import { computed, onMounted, reactive, ref } from "vue";
import { Badge } from "@codex-gateway/ui/badge";
import { Button } from "@codex-gateway/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@codex-gateway/ui/dialog";
import { Input } from "@codex-gateway/ui/input";
import { Label } from "@codex-gateway/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@codex-gateway/ui/select";
import { gatewayApi } from "@/utils/gateway-api";
import { gatewayErrorMessage } from "@/utils/gateway-error";

type RuntimeNodeState = "active" | "draining" | "disabled";

interface RuntimeNodeCapacity {
  cpuMillis: number;
  memoryBytes: number;
  maxRuntimes: number;
  minimumFreeDiskBytes: number;
}

interface RuntimeNodeReservation {
  cpuMillis: number;
  memoryBytes: number;
  runtimes: number;
}

interface RuntimeNodeHealth {
  managerVersion: string;
  dockerAvailable: boolean;
  dataRootWritable: boolean;
  availableDiskBytes: number;
  totalDiskBytes: number;
  managedRuntimeCount: number;
  runningRuntimeCount: number;
  lastSeenAt: string | null;
  lastError: string | null;
}

interface RuntimeNodeView {
  id: string;
  name: string;
  state: RuntimeNodeState;
  configRevision: number;
  capacity: RuntimeNodeCapacity;
  reservation: RuntimeNodeReservation;
  health: RuntimeNodeHealth | null;
}

interface RuntimeNodeForm {
  id: string;
  name: string;
  baseUrl: string;
  sharedSecret: string;
  state: RuntimeNodeState;
  cpuMillis: number;
  memoryBytes: number;
  maxRuntimes: number;
  minimumFreeDiskBytes: number;
}

const { t } = useI18n();
const loading = ref(true);
const saving = ref(false);
const probingNodeId = ref<string | null>(null);
const error = ref("");
const nodes = ref<RuntimeNodeView[]>([]);
const nodeStates: RuntimeNodeState[] = ["active", "draining", "disabled"];
const editorOpen = ref(false);
const editingNodeId = ref<string | null>(null);
const nodeForm = reactive<RuntimeNodeForm>(emptyNodeForm());

const editorTitle = computed(() =>
  editingNodeId.value === null ? t("app.runtimeNodeCreate") : t("app.runtimeNodeEdit"),
);
const editorDescription = computed(() =>
  editingNodeId.value === null
    ? t("app.runtimeNodeCreateDescription")
    : t("app.runtimeNodeEditDescription"),
);

onMounted(() => void load());

async function load() {
  loading.value = true;
  error.value = "";
  try {
    nodes.value = await gatewayApi<RuntimeNodeView[]>("/api/admin/runtime-nodes");
  } catch (caught: unknown) {
    error.value = gatewayErrorMessage(caught, t("app.runtimeNodeLoadFailed"));
  } finally {
    loading.value = false;
  }
}

function openCreateNode() {
  editingNodeId.value = null;
  Object.assign(nodeForm, emptyNodeForm());
  editorOpen.value = true;
}

function openEditNode(node: RuntimeNodeView) {
  editingNodeId.value = node.id;
  Object.assign(nodeForm, {
    id: node.id,
    name: node.name,
    baseUrl: "",
    sharedSecret: "",
    state: node.state,
    cpuMillis: node.capacity.cpuMillis,
    memoryBytes: node.capacity.memoryBytes,
    maxRuntimes: node.capacity.maxRuntimes,
    minimumFreeDiskBytes: node.capacity.minimumFreeDiskBytes,
  });
  editorOpen.value = true;
}

async function saveNode() {
  if (!nodeForm.id.trim() || !nodeForm.name.trim()) return;
  if (editingNodeId.value === null && (!nodeForm.baseUrl.trim() || !nodeForm.sharedSecret.trim())) {
    return;
  }

  saving.value = true;
  error.value = "";
  try {
    const capacity = {
      cpuMillis: nodeForm.cpuMillis,
      memoryBytes: nodeForm.memoryBytes,
      maxRuntimes: nodeForm.maxRuntimes,
      minimumFreeDiskBytes: nodeForm.minimumFreeDiskBytes,
    };

    if (editingNodeId.value === null) {
      await gatewayApi("/api/admin/runtime-nodes", {
        method: "POST",
        body: {
          id: nodeForm.id.trim(),
          name: nodeForm.name.trim(),
          baseUrl: nodeForm.baseUrl.trim(),
          sharedSecret: nodeForm.sharedSecret,
          capacity,
        },
      });
    } else {
      await gatewayApi(`/api/admin/runtime-nodes/${encodeURIComponent(editingNodeId.value)}`, {
        method: "PATCH",
        body: {
          name: nodeForm.name.trim(),
          state: nodeForm.state,
          capacity,
        },
      });
    }

    editorOpen.value = false;
    await load();
  } catch (caught: unknown) {
    error.value = gatewayErrorMessage(caught, t("app.runtimeNodeSaveFailed"));
  } finally {
    saving.value = false;
  }
}

async function setNodeState(node: RuntimeNodeView, state: RuntimeNodeState) {
  if (node.state === state || saving.value) return;
  saving.value = true;
  error.value = "";
  try {
    await gatewayApi(`/api/admin/runtime-nodes/${encodeURIComponent(node.id)}`, {
      method: "PATCH",
      body: {
        name: node.name,
        state,
        capacity: node.capacity,
      },
    });
    await load();
  } catch (caught: unknown) {
    error.value = gatewayErrorMessage(caught, t("app.runtimeNodeSaveFailed"));
  } finally {
    saving.value = false;
  }
}

async function probeNode(node: RuntimeNodeView) {
  if (probingNodeId.value !== null) return;
  probingNodeId.value = node.id;
  error.value = "";
  try {
    await gatewayApi(`/api/admin/runtime-nodes/${encodeURIComponent(node.id)}/probe`, {
      method: "POST",
    });
    await load();
  } catch (caught: unknown) {
    error.value = gatewayErrorMessage(caught, t("app.runtimeNodeProbeFailed"));
  } finally {
    probingNodeId.value = null;
  }
}

function emptyNodeForm(): RuntimeNodeForm {
  return {
    id: "",
    name: "",
    baseUrl: "",
    sharedSecret: "",
    state: "active",
    cpuMillis: 1000,
    memoryBytes: 8 * 1024 * 1024 * 1024,
    maxRuntimes: 1,
    minimumFreeDiskBytes: 0,
  };
}

function stateLabel(state: RuntimeNodeState) {
  const key =
    state === "active"
      ? "app.runtimeNodeStateActive"
      : state === "draining"
        ? "app.runtimeNodeStateDraining"
        : "app.runtimeNodeStateDisabled";
  return t(key);
}

function stateVariant(state: RuntimeNodeState) {
  if (state === "active") return "default" as const;
  if (state === "draining") return "secondary" as const;
  return "destructive" as const;
}

function formatCpuMillis(value: number) {
  if (value < 1000) return `${value}m`;
  const cpu = value / 1000;
  return Number.isInteger(cpu) ? `${cpu} CPU` : `${cpu.toFixed(1)} CPU`;
}

function formatBytes(value: number) {
  const units = ["B", "KiB", "MiB", "GiB", "TiB"];
  let current = value;
  let unit = 0;
  while (current >= 1024 && unit < units.length - 1) {
    current /= 1024;
    unit += 1;
  }
  const digits = current >= 10 || unit === 0 ? 0 : 1;
  return `${current.toFixed(digits)} ${units[unit]}`;
}

function formatDateTime(value: string | null) {
  if (value === null) return t("app.runtimeNodeNeverSeen");
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? value : new Date(parsed).toLocaleString();
}
</script>

<template>
  <section class="space-y-3 border-t border-hairline pt-4">
    <div class="flex flex-wrap items-start justify-between gap-3">
      <div class="min-w-0 space-y-1">
        <div class="text-sm font-medium text-ink-secondary">{{ t("app.runtimeNodeSettings") }}</div>
        <p class="text-sm text-ink-muted">{{ t("app.runtimeNodeSettingsDescription") }}</p>
      </div>
      <Button type="button" size="sm" class="shrink-0 gap-1.5" @click="openCreateNode">
        <PlusIcon class="size-4" />
        {{ t("app.runtimeNodeAdd") }}
      </Button>
    </div>

    <div
      v-if="error"
      role="alert"
      class="whitespace-pre-line border-l-2 border-destructive py-1 pl-3 text-sm text-destructive"
    >
      {{ error }}
    </div>

    <div v-if="loading" class="flex items-center gap-2 py-4 text-sm text-ink-muted">
      <Loader2Icon class="size-4 animate-spin" />
      {{ t("app.runtimeNodeLoading") }}
    </div>

    <div v-else class="space-y-3">
      <div
        v-if="!nodes.length"
        class="rounded-md border border-hairline bg-canvas-soft p-3 text-sm text-ink-secondary"
      >
        {{ t("app.runtimeNodeEmpty") }}
      </div>

      <article
        v-for="node in nodes"
        :key="node.id"
        class="rounded-xl border border-hairline bg-canvas-soft/70 p-4"
      >
        <div class="flex flex-wrap items-start justify-between gap-3">
          <div class="min-w-0 space-y-1.5">
            <div class="flex flex-wrap items-center gap-2">
              <ServerIcon class="size-4 shrink-0 text-ink-muted" />
              <div class="min-w-0">
                <div class="truncate text-sm font-medium text-ink">{{ node.name }}</div>
                <div class="truncate text-xs text-ink-faint">{{ node.id }}</div>
              </div>
              <Badge :variant="stateVariant(node.state)">{{ stateLabel(node.state) }}</Badge>
              <Badge variant="outline"
                >{{ t("app.runtimeNodeConfigRevision") }} {{ node.configRevision }}</Badge
              >
            </div>
            <div class="flex flex-wrap gap-3 text-xs text-ink-muted">
              <span>
                {{ t("app.runtimeNodeCapacity") }}:
                {{ formatCpuMillis(node.capacity.cpuMillis) }}
                · {{ formatBytes(node.capacity.memoryBytes) }} · {{ node.capacity.maxRuntimes }}
                {{ t("app.runtimeNodeRuntimes") }}
              </span>
              <span>
                {{ t("app.runtimeNodeReservation") }}:
                {{ formatCpuMillis(node.reservation.cpuMillis) }}
                · {{ formatBytes(node.reservation.memoryBytes) }} · {{ node.reservation.runtimes }}
                {{ t("app.runtimeNodeRuntimes") }}
              </span>
            </div>
          </div>

          <div class="flex flex-wrap items-center gap-2">
            <Button
              v-for="state in nodeStates"
              :key="state"
              type="button"
              size="sm"
              :variant="node.state === state ? 'default' : 'outline'"
              :disabled="saving"
              class="h-8 px-2.5 text-xs"
              @click="setNodeState(node, state)"
            >
              {{ stateLabel(state) }}
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              class="h-8 gap-1.5 px-2.5 text-xs"
              :disabled="probingNodeId === node.id"
              @click="probeNode(node)"
            >
              <Loader2Icon v-if="probingNodeId === node.id" class="size-4 animate-spin" />
              <RefreshCwIcon v-else class="size-4" />
              {{ t("app.runtimeNodeProbe") }}
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              class="h-8 gap-1.5 px-2.5 text-xs"
              @click="openEditNode(node)"
            >
              <PencilIcon class="size-4" />
              {{ t("app.edit") }}
            </Button>
          </div>
        </div>

        <div class="mt-4 grid gap-3 text-sm sm:grid-cols-2 xl:grid-cols-3">
          <div class="space-y-1 rounded-lg border border-hairline/70 bg-canvas p-3">
            <div class="text-xs font-medium text-ink-secondary">
              {{ t("app.runtimeNodeHealth") }}
            </div>
            <div v-if="node.health" class="space-y-1 text-ink-secondary">
              <div>{{ t("app.runtimeNodeManagerVersion") }}: {{ node.health.managerVersion }}</div>
              <div class="flex flex-wrap gap-2">
                <Badge :variant="node.health.dockerAvailable ? 'secondary' : 'destructive'">
                  {{
                    node.health.dockerAvailable
                      ? t("app.runtimeNodeAvailable")
                      : t("app.runtimeNodeUnavailable")
                  }}
                </Badge>
                <Badge :variant="node.health.dataRootWritable ? 'secondary' : 'destructive'">
                  {{
                    node.health.dataRootWritable
                      ? t("app.runtimeNodeAvailable")
                      : t("app.runtimeNodeUnavailable")
                  }}
                </Badge>
              </div>
            </div>
            <div v-else class="text-ink-muted">{{ t("app.runtimeNodeHealthMissing") }}</div>
          </div>

          <div class="space-y-1 rounded-lg border border-hairline/70 bg-canvas p-3">
            <div class="text-xs font-medium text-ink-secondary">{{ t("app.runtimeNodeDisk") }}</div>
            <div v-if="node.health" class="space-y-1 text-ink-secondary">
              <div>
                {{ formatBytes(node.health.availableDiskBytes) }} /
                {{ formatBytes(node.health.totalDiskBytes) }}
              </div>
              <div>
                {{ t("app.runtimeNodeMinimumFreeDisk") }}:
                {{ formatBytes(node.capacity.minimumFreeDiskBytes) }}
              </div>
            </div>
            <div v-else class="text-ink-muted">{{ t("app.runtimeNodeHealthMissing") }}</div>
          </div>

          <div class="space-y-1 rounded-lg border border-hairline/70 bg-canvas p-3">
            <div class="text-xs font-medium text-ink-secondary">
              {{ t("app.runtimeNodeActivity") }}
            </div>
            <div v-if="node.health" class="space-y-1 text-ink-secondary">
              <div>
                {{ t("app.runtimeNodeManagedRuntimeCount") }}: {{ node.health.managedRuntimeCount }}
              </div>
              <div>
                {{ t("app.runtimeNodeRunningRuntimeCount") }}: {{ node.health.runningRuntimeCount }}
              </div>
              <div>
                {{ t("app.runtimeNodeLastSeen") }}: {{ formatDateTime(node.health.lastSeenAt) }}
              </div>
              <p v-if="node.health.lastError" class="text-destructive">
                {{ node.health.lastError }}
              </p>
            </div>
            <div v-else class="text-ink-muted">{{ t("app.runtimeNodeHealthMissing") }}</div>
          </div>
        </div>
      </article>
    </div>

    <Dialog v-model:open="editorOpen">
      <DialogContent class="max-w-2xl">
        <DialogHeader>
          <DialogTitle>{{ editorTitle }}</DialogTitle>
          <DialogDescription>{{ editorDescription }}</DialogDescription>
        </DialogHeader>

        <form class="space-y-4" @submit.prevent="saveNode">
          <div class="grid gap-3 sm:grid-cols-2">
            <div class="space-y-1.5">
              <Label for="runtime-node-id">{{ t("app.runtimeNodeId") }}</Label>
              <Input
                id="runtime-node-id"
                v-model="nodeForm.id"
                :disabled="editingNodeId !== null"
                placeholder="node__alpha"
              />
            </div>
            <div class="space-y-1.5">
              <Label for="runtime-node-name">{{ t("app.runtimeNodeName") }}</Label>
              <Input id="runtime-node-name" v-model="nodeForm.name" />
            </div>
          </div>

          <div v-if="editingNodeId === null" class="space-y-1.5">
            <Label for="runtime-node-base-url">{{ t("app.runtimeNodeBaseUrl") }}</Label>
            <Input
              id="runtime-node-base-url"
              v-model="nodeForm.baseUrl"
              placeholder="https://runtime.example.com"
            />
          </div>

          <div v-if="editingNodeId === null" class="space-y-1.5">
            <Label for="runtime-node-secret">{{ t("app.runtimeNodeSharedSecret") }}</Label>
            <Input
              id="runtime-node-secret"
              v-model="nodeForm.sharedSecret"
              type="password"
              autocomplete="off"
              :placeholder="t('app.runtimeNodeSharedSecretPlaceholder')"
            />
          </div>

          <div class="grid gap-3 sm:grid-cols-2">
            <div class="space-y-1.5">
              <Label>{{ t("app.runtimeNodeState") }}</Label>
              <Select v-model="nodeForm.state">
                <SelectTrigger class="w-full"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="active">{{ t("app.runtimeNodeStateActive") }}</SelectItem>
                  <SelectItem value="draining">{{ t("app.runtimeNodeStateDraining") }}</SelectItem>
                  <SelectItem value="disabled">{{ t("app.runtimeNodeStateDisabled") }}</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div class="space-y-1.5">
              <Label for="runtime-node-cpu">{{ t("app.runtimeNodeCpuMillis") }}</Label>
              <Input
                id="runtime-node-cpu"
                v-model.number="nodeForm.cpuMillis"
                type="number"
                min="1"
              />
            </div>
          </div>

          <div class="grid gap-3 sm:grid-cols-2">
            <div class="space-y-1.5">
              <Label for="runtime-node-memory">{{ t("app.runtimeNodeMemoryBytes") }}</Label>
              <Input
                id="runtime-node-memory"
                v-model.number="nodeForm.memoryBytes"
                type="number"
                min="1"
              />
            </div>
            <div class="space-y-1.5">
              <Label for="runtime-node-max-runtimes">{{ t("app.runtimeNodeMaxRuntimes") }}</Label>
              <Input
                id="runtime-node-max-runtimes"
                v-model.number="nodeForm.maxRuntimes"
                type="number"
                min="1"
              />
            </div>
          </div>

          <div class="space-y-1.5">
            <Label for="runtime-node-min-free-disk">{{
              t("app.runtimeNodeMinimumFreeDisk")
            }}</Label>
            <Input
              id="runtime-node-min-free-disk"
              v-model.number="nodeForm.minimumFreeDiskBytes"
              type="number"
              min="0"
            />
          </div>

          <DialogFooter>
            <Button type="button" variant="ghost" @click="editorOpen = false">
              {{ t("app.cancel") }}
            </Button>
            <Button type="submit" :disabled="saving">
              <Loader2Icon v-if="saving" class="size-4 animate-spin" />
              {{ t("app.save") }}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  </section>
</template>
