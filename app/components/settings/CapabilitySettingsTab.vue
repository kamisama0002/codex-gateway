<script setup lang="ts">
import { Loader2Icon, PlusIcon, RefreshCwIcon, Trash2Icon } from "@lucide/vue";
import { storeToRefs } from "pinia";
import { computed, onMounted, ref } from "vue";
import type {
  AdminCapabilityCatalogItem,
  CapabilityAssignment,
  CapabilityCreateInput,
  CapabilityDefinition,
  CapabilityKind,
  CapabilityUpdateInput,
  CredentialCreateInput,
  UserCapabilityCatalogItem,
} from "~~/shared/types";
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
import { Tabs, TabsList, TabsTrigger } from "@codex-gateway/ui/tabs";
import CapabilityCatalog from "@/components/settings/capabilities/CapabilityCatalog.vue";
import CapabilityEditor from "@/components/settings/capabilities/CapabilityEditor.vue";
import CredentialEditor from "@/components/settings/capabilities/CredentialEditor.vue";
import { useGatewayCapabilitiesStore } from "@/stores/gateway-capabilities";
import { gatewayErrorMessage } from "@/utils/gateway-error";

type CatalogItem = AdminCapabilityCatalogItem | UserCapabilityCatalogItem;

const { t } = useI18n();
const store = useGatewayCapabilitiesStore();
const { adminCatalog, userCatalog, loading, isAdmin } = storeToRefs(store);
const activeKind = ref<CapabilityKind>("mcp");
const error = ref("");
const saving = ref(false);
const busyId = ref<string | null>(null);
const editorOpen = ref(false);
const editing = ref<CapabilityDefinition | null>(null);
const credentialOpen = ref(false);
const credentialCapability = ref<CatalogItem | null>(null);
const assignmentOpen = ref(false);
const assignmentCapability = ref<CatalogItem | null>(null);
const assignmentUserId = ref("");
const assignmentProjectId = ref("");
const deleting = ref<CatalogItem | null>(null);
const kinds: CapabilityKind[] = ["skill", "plugin", "app", "mcp", "search"];
const items = computed<CatalogItem[]>(() =>
  (adminCatalog.value?.capabilities ?? userCatalog.value?.capabilities ?? []).filter(
    (item) => item.kind === activeKind.value,
  ),
);
const users = computed(() => adminCatalog.value?.users ?? []);
const currentUserId = computed(() => userCatalog.value?.userId ?? null);

onMounted(() => void load());

async function load() {
  error.value = "";
  try {
    await store.load();
  } catch (caught: unknown) {
    error.value = gatewayErrorMessage(caught, t("app.capabilitiesLoadFailed"));
  }
}

function openCreate() {
  if (!isAdmin.value && activeKind.value !== "mcp") return;
  editing.value = null;
  editorOpen.value = true;
}

function openEdit(item: CatalogItem) {
  editing.value = item;
  editorOpen.value = true;
}

async function saveCapability(payload: { input: CapabilityCreateInput; skillContent: string }) {
  saving.value = true;
  error.value = "";
  try {
    const { input, skillContent } = payload;
    if (editing.value === null) {
      if (isAdmin.value) await store.createCapability(input);
      else await store.createPersonalMcp(input);
    } else {
      const update: CapabilityUpdateInput = {
        displayName: input.displayName,
        description: input.description,
        version: input.version,
        source: input.source,
        config: input.config,
        sensitiveFields: input.sensitiveFields,
        enabled: input.enabled,
      };
      if (isAdmin.value) await store.updateCapability(editing.value.id, update);
      else await store.updatePersonalMcp(editing.value.id, update);
    }
    if (isAdmin.value && input.kind === "skill" && skillContent.trim() !== "") {
      await store.uploadSkillArtifact(input.id, skillContent);
    }
    editorOpen.value = false;
  } catch (caught: unknown) {
    error.value = gatewayErrorMessage(caught, t("app.capabilitySaveFailed"));
  } finally {
    saving.value = false;
  }
}

async function toggleCapability(item: CatalogItem, enabled: boolean) {
  busyId.value = item.id;
  try {
    if (isAdmin.value) await store.updateCapability(item.id, { enabled });
    else await store.updatePersonalMcp(item.id, { enabled });
  } catch (caught: unknown) {
    error.value = gatewayErrorMessage(caught, t("app.capabilitySaveFailed"));
  } finally {
    busyId.value = null;
  }
}

function openAssignment(item: CatalogItem) {
  assignmentCapability.value = item;
  assignmentUserId.value = String(users.value[0]?.id ?? "");
  assignmentProjectId.value = "";
  assignmentOpen.value = true;
}

async function saveAssignment() {
  const capability = assignmentCapability.value;
  if (capability === null) return;
  saving.value = true;
  try {
    await store.setAssignment(capability.id, {
      userId: Number(assignmentUserId.value),
      projectId: assignmentProjectId.value.trim() === "" ? null : Number(assignmentProjectId.value),
      assigned: true,
    });
    assignmentOpen.value = false;
  } catch (caught: unknown) {
    error.value = gatewayErrorMessage(caught, t("app.capabilityAssignmentFailed"));
  } finally {
    saving.value = false;
  }
}

async function removeAssignment(item: CatalogItem, assignment: CapabilityAssignment) {
  busyId.value = item.id;
  try {
    await store.setAssignment(item.id, {
      userId: assignment.userId,
      projectId: assignment.projectId,
      assigned: false,
    });
  } catch (caught: unknown) {
    error.value = gatewayErrorMessage(caught, t("app.capabilityAssignmentFailed"));
  } finally {
    busyId.value = null;
  }
}

function openCredential(item: CatalogItem) {
  if (isAdmin.value && !("assignments" in item)) return;
  if (
    !isAdmin.value &&
    (item.kind !== "mcp" || item.createdByUserId !== currentUserId.value)
  ) {
    return;
  }
  credentialCapability.value = item;
  credentialOpen.value = true;
}

async function saveCredential(input: CredentialCreateInput) {
  saving.value = true;
  try {
    if (isAdmin.value) await store.createCredential(input);
    else await store.createPersonalCredential(input);
    credentialOpen.value = false;
  } catch (caught: unknown) {
    error.value = gatewayErrorMessage(caught, t("app.credentialSaveFailed"));
  } finally {
    saving.value = false;
  }
}

async function revokeCredential(id: string) {
  busyId.value = id;
  try {
    if (isAdmin.value) await store.revokeCredential(id);
    else {
      const capability = items.value.find((item) =>
        item.credentials.some((credential) => credential.id === id),
      );
      if (capability === undefined) return;
      await store.revokePersonalCredential(capability.id, id);
    }
  } catch (caught: unknown) {
    error.value = gatewayErrorMessage(caught, t("app.credentialRevokeFailed"));
  } finally {
    busyId.value = null;
  }
}

async function confirmDelete() {
  if (deleting.value === null) return;
  saving.value = true;
  try {
    if (isAdmin.value) await store.deleteCapability(deleting.value.id);
    else await store.deletePersonalMcp(deleting.value.id);
    deleting.value = null;
  } catch (caught: unknown) {
    error.value = gatewayErrorMessage(caught, t("app.capabilityDeleteFailed"));
  } finally {
    saving.value = false;
  }
}
</script>

<template>
  <div class="mx-auto w-full max-w-4xl">
    <div class="flex items-start justify-between gap-4 border-b border-hairline pb-4">
      <div class="min-w-0">
        <h2 class="font-medium text-ink">{{ t("app.agentCapabilities") }}</h2>
        <p class="mt-1 text-sm leading-5 text-ink-muted">
          {{
            t(
              isAdmin
                ? "app.agentCapabilitiesAdminDescription"
                : "app.agentCapabilitiesUserDescription",
            )
          }}
        </p>
      </div>
      <div class="flex shrink-0 gap-2">
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          :aria-label="t('app.refreshCapabilities')"
          @click="load"
          ><RefreshCwIcon class="size-4" /></Button
        ><Button
          v-if="isAdmin || activeKind === 'mcp'"
          type="button"
          size="sm"
          class="gap-1.5"
          data-testid="add-capability"
          @click="openCreate"
          ><PlusIcon class="size-4" />{{
            t(isAdmin ? "app.addCapability" : "app.addPersonalMcp")
          }}</Button
        >
      </div>
    </div>
    <div
      v-if="error"
      role="alert"
      class="mt-3 border-l-2 border-destructive py-1 pl-3 text-sm text-destructive"
    >
      {{ error }}
    </div>
    <div v-if="loading" class="flex items-center gap-2 py-10 text-sm text-ink-muted">
      <Loader2Icon class="size-4 animate-spin" />{{ t("app.loadingCapabilities") }}
    </div>
    <template v-else>
      <Tabs v-model="activeKind" class="mt-4"
        ><TabsList class="w-full justify-start overflow-x-auto"
          ><TabsTrigger v-for="kind in kinds" :key="kind" :value="kind">{{
            t(`app.capabilityKinds.${kind}`)
          }}</TabsTrigger></TabsList
        ></Tabs
      >
      <CapabilityCatalog
        :items="items"
        :users="users"
        :admin="isAdmin"
        :current-user-id="currentUserId"
        :busy-id="busyId"
        @edit="openEdit"
        @delete="deleting = $event"
        @assign="openAssignment"
        @unassign="removeAssignment"
        @credential="openCredential"
        @revoke-credential="revokeCredential"
        @toggle="toggleCapability"
      />
    </template>
    <CapabilityEditor
      v-model:open="editorOpen"
      :capability="editing"
      :saving="saving"
      :mcp-only="!isAdmin"
      @save="saveCapability"
    />
    <CredentialEditor
      v-model:open="credentialOpen"
      :capability="credentialCapability"
      :users="users"
      :saving="saving"
      :personal-user-id="isAdmin ? null : currentUserId"
      @save="saveCredential"
    />
    <Dialog v-model:open="assignmentOpen"
      ><DialogContent class="max-w-md"
        ><DialogHeader
          ><DialogTitle>{{ t("app.assignCapability") }}</DialogTitle
          ><DialogDescription>{{
            t("app.assignCapabilityDescription")
          }}</DialogDescription></DialogHeader
        >
        <form class="space-y-4" @submit.prevent="saveAssignment">
          <div class="space-y-1.5">
            <Label for="assignment-user">{{ t("app.user") }}</Label
            ><Select v-model="assignmentUserId"
              ><SelectTrigger id="assignment-user" class="w-full"><SelectValue /></SelectTrigger
              ><SelectContent
                ><SelectItem v-for="user in users" :key="user.id" :value="String(user.id)"
                  >{{ user.username }} · #{{ user.id }}</SelectItem
                ></SelectContent
              ></Select
            >
          </div>
          <div class="space-y-1.5">
            <Label for="assignment-project">{{ t("app.projectIdOptional") }}</Label
            ><Input id="assignment-project" v-model="assignmentProjectId" inputmode="numeric" />
          </div>
          <DialogFooter
            ><Button type="button" variant="ghost" @click="assignmentOpen = false">{{
              t("app.cancel")
            }}</Button
            ><Button type="submit" :disabled="saving">{{ t("app.save") }}</Button></DialogFooter
          >
        </form></DialogContent
      ></Dialog
    >
    <Dialog :open="deleting !== null" @update:open="$event || (deleting = null)"
      ><DialogContent class="max-w-md"
        ><DialogHeader
          ><DialogTitle>{{ t("app.deleteCapability") }}</DialogTitle
          ><DialogDescription>{{
            t("app.deleteCapabilityDescription", { name: deleting?.displayName ?? "" })
          }}</DialogDescription></DialogHeader
        ><DialogFooter
          ><Button type="button" variant="ghost" @click="deleting = null">{{
            t("app.cancel")
          }}</Button
          ><Button type="button" variant="destructive" :disabled="saving" @click="confirmDelete"
            ><Trash2Icon class="size-4" />{{ t("app.deleteCapability") }}</Button
          ></DialogFooter
        ></DialogContent
      ></Dialog
    >
  </div>
</template>
