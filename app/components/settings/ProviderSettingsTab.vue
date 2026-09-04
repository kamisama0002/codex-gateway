<script setup lang="ts">
import {
  CheckCircle2Icon,
  ChevronDownIcon,
  ChevronRightIcon,
  KeyRoundIcon,
  Loader2Icon,
  PencilIcon,
  PlusIcon,
  Trash2Icon,
} from "@lucide/vue";
import { FetchError } from "ofetch";
import { computed, onMounted, reactive, ref } from "vue";
import type {
  ModelCapabilities,
  ProviderModelDefinition,
  PublicModelProviderDefinition,
  UpstreamWireApi,
  UserProviderModel,
} from "~~/shared/types";
import { Button } from "@codex-gateway/ui/button";
import { Checkbox } from "@codex-gateway/ui/checkbox";
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
import { Switch } from "@codex-gateway/ui/switch";
import { useGatewayCatalogStore } from "@/stores/gateway-catalog";
import { gatewayApi } from "@/utils/gateway-api";
import { gatewayErrorMessage } from "@/utils/gateway-error";

interface ProviderWithModels extends PublicModelProviderDefinition {
  models: ProviderModelDefinition[];
}

interface ProviderForm {
  id: string;
  name: string;
  baseUrl: string;
  wireApi: UpstreamWireApi;
  apiKey: string;
  enabled: boolean;
  requestTimeoutMs: number;
}

interface ModelForm {
  providerId: string;
  modelId: string;
  displayName: string;
  enabled: boolean;
  capabilities: ModelCapabilities;
}

const { t } = useI18n();
const gatewayCatalog = useGatewayCatalogStore();
const loading = ref(true);
const saving = ref(false);
const deleting = ref(false);
const forbidden = ref(false);
const error = ref("");
const providers = ref<ProviderWithModels[]>([]);
const assignedModels = ref<UserProviderModel[]>([]);
const expandedProviderIds = ref(new Set<string>());
const providerEditorOpen = ref(false);
const modelEditorOpen = ref(false);
const deletingProvider = ref<ProviderWithModels | null>(null);
const editingProviderId = ref<string | null>(null);
const togglingModelKey = ref<string | null>(null);
const providerForm = reactive<ProviderForm>(emptyProviderForm());
const modelForm = reactive<ModelForm>(emptyModelForm());
const providerDialogTitle = computed(() =>
  editingProviderId.value === null ? t("app.addProvider") : t("app.editProvider"),
);

onMounted(() => void load());

async function load() {
  loading.value = true;
  error.value = "";
  try {
    providers.value = await gatewayApi<ProviderWithModels[]>("/api/admin/providers");
    forbidden.value = false;
  } catch (caught: unknown) {
    if (caught instanceof FetchError && caught.statusCode === 403) {
      forbidden.value = true;
      const response = await gatewayApi<{ data: UserProviderModel[] }>("/api/provider-models");
      assignedModels.value = response.data;
    } else {
      error.value = gatewayErrorMessage(caught, t("app.providersLoadFailed"));
    }
  } finally {
    loading.value = false;
  }
}

function toggleProvider(providerId: string) {
  const next = new Set(expandedProviderIds.value);
  if (next.has(providerId)) next.delete(providerId);
  else next.add(providerId);
  expandedProviderIds.value = next;
}

function openProviderCreate() {
  editingProviderId.value = null;
  Object.assign(providerForm, emptyProviderForm());
  providerEditorOpen.value = true;
}

function openProviderEdit(provider: ProviderWithModels) {
  editingProviderId.value = provider.id;
  Object.assign(providerForm, {
    id: provider.id,
    name: provider.name,
    baseUrl: provider.baseUrl,
    wireApi: provider.wireApi,
    apiKey: "",
    enabled: provider.enabled,
    requestTimeoutMs: provider.requestTimeoutMs,
  });
  providerEditorOpen.value = true;
}

async function saveProvider() {
  if (!providerForm.name.trim() || !providerForm.baseUrl.trim()) return;
  if (editingProviderId.value === null && !providerForm.apiKey.trim()) return;
  saving.value = true;
  error.value = "";
  try {
    if (editingProviderId.value === null) {
      await gatewayApi("/api/admin/providers", {
        method: "POST",
        body: { ...providerForm, id: providerForm.id.trim() || undefined },
      });
    } else {
      await gatewayApi(`/api/admin/providers/${encodeURIComponent(editingProviderId.value)}`, {
        method: "PATCH",
        body: {
          name: providerForm.name,
          baseUrl: providerForm.baseUrl,
          wireApi: providerForm.wireApi,
          enabled: providerForm.enabled,
          requestTimeoutMs: providerForm.requestTimeoutMs,
          ...(providerForm.apiKey.trim() ? { apiKey: providerForm.apiKey } : {}),
        },
      });
    }
    providerEditorOpen.value = false;
    await load();
  } catch (caught: unknown) {
    error.value = gatewayErrorMessage(caught, t("app.providerSaveFailed"));
  } finally {
    saving.value = false;
  }
}

function openModelEditor(provider: ProviderWithModels, model?: ProviderModelDefinition) {
  Object.assign(
    modelForm,
    model === undefined
      ? emptyModelForm(provider.id)
      : {
          providerId: provider.id,
          modelId: model.modelId,
          displayName: model.displayName,
          enabled: model.enabled,
          capabilities: { ...model.capabilities },
        },
  );
  modelEditorOpen.value = true;
}

async function saveModel() {
  if (!modelForm.modelId.trim() || !modelForm.displayName.trim()) return;
  saving.value = true;
  error.value = "";
  try {
    await gatewayApi(`/api/admin/providers/${encodeURIComponent(modelForm.providerId)}/models`, {
      method: "POST",
      body: {
        modelId: modelForm.modelId,
        displayName: modelForm.displayName,
        enabled: modelForm.enabled,
        capabilities: modelForm.capabilities,
      },
    });
    modelEditorOpen.value = false;
    await load();
  } catch (caught: unknown) {
    error.value = gatewayErrorMessage(caught, t("app.modelSaveFailed"));
  } finally {
    saving.value = false;
  }
}

async function setModelEnabled(
  provider: ProviderWithModels,
  model: ProviderModelDefinition,
  enabled: boolean,
) {
  const key = `${provider.id}:${model.modelId}`;
  if (togglingModelKey.value !== null) return;
  togglingModelKey.value = key;
  error.value = "";
  replaceProviderModel({ ...model, enabled });
  let saved = false;
  try {
    const updated = await gatewayApi<ProviderModelDefinition>(
      `/api/admin/providers/${encodeURIComponent(provider.id)}/models`,
      {
        method: "POST",
        body: {
          modelId: model.modelId,
          displayName: model.displayName,
          enabled,
          capabilities: model.capabilities,
        },
      },
    );
    replaceProviderModel(updated);
    saved = true;
  } catch (caught: unknown) {
    replaceProviderModel(model);
    error.value = gatewayErrorMessage(caught, t("app.modelToggleFailed"));
  } finally {
    togglingModelKey.value = null;
  }
  if (saved) await gatewayCatalog.listModels();
}

function replaceProviderModel(updated: ProviderModelDefinition) {
  providers.value = providers.value.map((provider) =>
    provider.id === updated.providerId
      ? {
          ...provider,
          models: provider.models.map((model) =>
            model.modelId === updated.modelId ? updated : model,
          ),
        }
      : provider,
  );
}

async function confirmDeleteProvider() {
  const provider = deletingProvider.value;
  if (provider === null) return;
  deleting.value = true;
  error.value = "";
  try {
    await gatewayApi(`/api/admin/providers/${encodeURIComponent(provider.id)}`, {
      method: "DELETE",
    });
    deletingProvider.value = null;
    await load();
  } catch (caught: unknown) {
    error.value = gatewayErrorMessage(caught, t("app.providerDeleteFailed"));
  } finally {
    deleting.value = false;
  }
}

function emptyProviderForm(): ProviderForm {
  return {
    id: "",
    name: "",
    baseUrl: "",
    wireApi: "responses",
    apiKey: "",
    enabled: true,
    requestTimeoutMs: 30_000,
  };
}

function emptyModelForm(providerId = ""): ModelForm {
  return {
    providerId,
    modelId: "",
    displayName: "",
    enabled: true,
    capabilities: {
      tools: true,
      streamingTools: true,
      vision: false,
      reasoning: true,
      maxContextTokens: null,
    },
  };
}
</script>

<template>
  <div class="mx-auto w-full max-w-3xl">
    <div class="flex items-start justify-between gap-4 border-b border-hairline pb-4">
      <div class="min-w-0">
        <h2 class="font-medium text-ink">{{ t("app.modelProviders") }}</h2>
        <p class="mt-1 text-sm leading-5 text-ink-muted">
          {{ t(forbidden ? "app.assignedModelsDescription" : "app.modelProvidersDescription") }}
        </p>
      </div>
      <Button
        v-if="!forbidden"
        type="button"
        size="sm"
        class="shrink-0 gap-1.5"
        data-testid="add-provider"
        @click="openProviderCreate"
      >
        <PlusIcon class="size-4" />
        {{ t("app.addProvider") }}
      </Button>
    </div>

    <div
      v-if="error"
      role="alert"
      class="mt-3 whitespace-pre-line border-l-2 border-destructive py-1 pl-3 text-sm text-destructive"
    >
      {{ error }}
    </div>

    <div v-if="loading" class="flex items-center gap-2 py-8 text-sm text-ink-muted">
      <Loader2Icon class="size-4 animate-spin" />
      {{ t("app.loadingProviders") }}
    </div>

    <div v-else-if="forbidden" class="divide-y divide-hairline">
      <div
        v-for="model in assignedModels"
        :key="`${model.providerId}:${model.modelId}`"
        class="flex min-w-0 items-center gap-3 py-3"
      >
        <CheckCircle2Icon class="size-4 shrink-0 text-accent-green" />
        <div class="min-w-0 flex-1">
          <div class="truncate text-sm font-medium text-ink">{{ model.displayName }}</div>
          <div class="truncate text-xs text-ink-faint">
            {{ model.provider.name }} · {{ model.modelId }}
          </div>
        </div>
      </div>
      <p v-if="!assignedModels.length" class="py-8 text-sm text-ink-muted">
        {{ t("app.noAssignedModels") }}
      </p>
    </div>

    <div v-else class="divide-y divide-hairline">
      <section v-for="provider in providers" :key="provider.id" class="py-2">
        <div class="flex min-w-0 items-center gap-2">
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            class="shrink-0 text-ink-muted"
            :aria-label="t('app.toggleProviderModels', { name: provider.name })"
            @click="toggleProvider(provider.id)"
          >
            <ChevronDownIcon v-if="expandedProviderIds.has(provider.id)" class="size-4" />
            <ChevronRightIcon v-else class="size-4" />
          </Button>
          <div class="min-w-0 flex-1 py-1">
            <div class="flex min-w-0 items-center gap-2">
              <span class="truncate text-sm font-medium text-ink">{{ provider.name }}</span>
              <span class="shrink-0 text-xs text-ink-faint">{{ provider.wireApi }}</span>
              <span v-if="!provider.enabled" class="shrink-0 text-xs text-accent-orange-deep">
                {{ t("app.disabled") }}
              </span>
            </div>
            <div class="mt-0.5 flex min-w-0 items-center gap-1.5 text-xs text-ink-faint">
              <KeyRoundIcon class="size-3 shrink-0" />
              <span>{{
                provider.hasApiKey ? t("app.apiKeyConfigured") : t("app.apiKeyMissing")
              }}</span>
              <span>·</span>
              <span class="truncate">{{ provider.baseUrl }}</span>
            </div>
          </div>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            :aria-label="t('app.editProviderNamed', { name: provider.name })"
            @click="openProviderEdit(provider)"
          >
            <PencilIcon class="size-3.5" />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            class="text-ink-muted hover:text-destructive"
            :aria-label="t('app.deleteProviderNamed', { name: provider.name })"
            @click="deletingProvider = provider"
          >
            <Trash2Icon class="size-3.5" />
          </Button>
        </div>

        <div v-if="expandedProviderIds.has(provider.id)" class="ml-9 border-l border-hairline pl-3">
          <div
            v-for="model in provider.models"
            :key="model.modelId"
            class="flex min-w-0 items-center gap-2 py-2 text-sm"
          >
            <span
              class="size-1.5 shrink-0 rounded-full"
              :class="model.enabled ? 'bg-accent-green' : 'bg-ink-faint'"
            />
            <span class="min-w-0 flex-1 truncate text-ink-secondary">
              {{ model.displayName }}
              <span class="text-ink-faint"> · {{ model.modelId }}</span>
            </span>
            <span class="shrink-0 text-xs text-ink-faint">
              {{ t(model.enabled ? "app.modelAvailable" : "app.modelUnavailable") }}
            </span>
            <Switch
              :model-value="model.enabled"
              :disabled="togglingModelKey !== null"
              :aria-label="t('app.toggleModelAvailabilityNamed', { name: model.displayName })"
              :data-testid="`model-enabled-toggle-${provider.id}-${model.modelId}`"
              @update:model-value="setModelEnabled(provider, model, $event)"
            />
            <Button
              type="button"
              variant="ghost"
              size="sm"
              class="h-7 px-2 text-xs"
              @click="openModelEditor(provider, model)"
            >
              {{ t("app.edit") }}
            </Button>
          </div>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            class="mb-1 h-7 gap-1 px-2 text-xs text-ink-muted"
            @click="openModelEditor(provider)"
          >
            <PlusIcon class="size-3.5" />
            {{ t("app.addModel") }}
          </Button>
        </div>
      </section>
      <p v-if="!providers.length" class="py-8 text-sm text-ink-muted">
        {{ t("app.noProviders") }}
      </p>
    </div>

    <Dialog v-model:open="providerEditorOpen">
      <DialogContent class="max-w-xl">
        <DialogHeader>
          <DialogTitle>{{ providerDialogTitle }}</DialogTitle>
          <DialogDescription>{{ t("app.providerEditorDescription") }}</DialogDescription>
        </DialogHeader>
        <form class="space-y-4" @submit.prevent="saveProvider">
          <div class="grid gap-3 sm:grid-cols-2">
            <div v-if="editingProviderId === null" class="space-y-1.5">
              <Label for="provider-id">{{ t("app.providerId") }}</Label>
              <Input id="provider-id" v-model="providerForm.id" placeholder="deepseek" />
            </div>
            <div class="space-y-1.5" :class="editingProviderId !== null ? 'sm:col-span-2' : ''">
              <Label for="provider-name">{{ t("app.providerName") }}</Label>
              <Input id="provider-name" v-model="providerForm.name" />
            </div>
          </div>
          <div class="space-y-1.5">
            <Label for="provider-url">{{ t("app.providerBaseUrl") }}</Label>
            <Input
              id="provider-url"
              v-model="providerForm.baseUrl"
              placeholder="https://api.example.com/v1"
            />
          </div>
          <div class="grid gap-3 sm:grid-cols-2">
            <div class="space-y-1.5">
              <Label>{{ t("app.providerProtocol") }}</Label>
              <Select v-model="providerForm.wireApi">
                <SelectTrigger class="w-full"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="responses">Responses</SelectItem>
                  <SelectItem value="chat_completions">Chat Completions</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div class="space-y-1.5">
              <Label for="provider-timeout">{{ t("app.providerTimeoutMs") }}</Label>
              <Input
                id="provider-timeout"
                v-model.number="providerForm.requestTimeoutMs"
                type="number"
                min="1000"
                max="300000"
              />
            </div>
          </div>
          <div class="space-y-1.5">
            <Label for="provider-key">{{ t("app.apiKey") }}</Label>
            <Input
              id="provider-key"
              v-model="providerForm.apiKey"
              type="password"
              autocomplete="off"
              :placeholder="
                editingProviderId === null ? t('app.apiKey') : t('app.apiKeyKeepExisting')
              "
            />
          </div>
          <label
            class="flex items-center justify-between gap-3 border-t border-hairline pt-3 text-sm"
          >
            <span>{{ t("app.providerEnabled") }}</span>
            <Switch v-model="providerForm.enabled" />
          </label>
          <DialogFooter>
            <Button type="button" variant="ghost" @click="providerEditorOpen = false">
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

    <Dialog v-model:open="modelEditorOpen">
      <DialogContent class="max-w-lg">
        <DialogHeader>
          <DialogTitle>{{ t("app.modelConfiguration") }}</DialogTitle>
          <DialogDescription>{{ t("app.modelConfigurationDescription") }}</DialogDescription>
        </DialogHeader>
        <form class="space-y-4" @submit.prevent="saveModel">
          <div class="grid gap-3 sm:grid-cols-2">
            <div class="space-y-1.5">
              <Label for="model-id">{{ t("app.modelId") }}</Label>
              <Input id="model-id" v-model="modelForm.modelId" />
            </div>
            <div class="space-y-1.5">
              <Label for="model-name">{{ t("app.modelDisplayName") }}</Label>
              <Input id="model-name" v-model="modelForm.displayName" />
            </div>
          </div>
          <div class="grid gap-3 text-sm sm:grid-cols-2">
            <label class="flex items-center gap-2">
              <Checkbox v-model="modelForm.capabilities.tools" />{{ t("app.capabilityTools") }}
            </label>
            <label class="flex items-center gap-2">
              <Checkbox v-model="modelForm.capabilities.streamingTools" />{{
                t("app.capabilityStreamingTools")
              }}
            </label>
            <label class="flex items-center gap-2">
              <Checkbox v-model="modelForm.capabilities.vision" />{{ t("app.capabilityVision") }}
            </label>
            <label class="flex items-center gap-2">
              <Checkbox v-model="modelForm.capabilities.reasoning" />{{
                t("app.capabilityReasoning")
              }}
            </label>
          </div>
          <div class="space-y-1.5">
            <Label for="model-context">{{ t("app.maxContextTokens") }}</Label>
            <Input
              id="model-context"
              :model-value="modelForm.capabilities.maxContextTokens ?? ''"
              type="number"
              min="1"
              @update:model-value="
                modelForm.capabilities.maxContextTokens = $event === '' ? null : Number($event)
              "
            />
          </div>
          <label
            class="flex items-center justify-between gap-3 border-t border-hairline pt-3 text-sm"
          >
            <span>{{ t("app.modelEnabled") }}</span>
            <Switch v-model="modelForm.enabled" />
          </label>
          <DialogFooter>
            <Button type="button" variant="ghost" @click="modelEditorOpen = false">
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

    <Dialog :open="deletingProvider !== null" @update:open="$event || (deletingProvider = null)">
      <DialogContent class="max-w-md">
        <DialogHeader>
          <DialogTitle>{{ t("app.deleteProvider") }}</DialogTitle>
          <DialogDescription>
            {{ t("app.deleteProviderDescription", { name: deletingProvider?.name ?? "" }) }}
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button type="button" variant="ghost" @click="deletingProvider = null">
            {{ t("app.cancel") }}
          </Button>
          <Button
            type="button"
            variant="destructive"
            :disabled="deleting"
            @click="confirmDeleteProvider"
          >
            <Loader2Icon v-if="deleting" class="size-4 animate-spin" />
            <Trash2Icon v-else class="size-4" />
            {{ t("app.deleteProvider") }}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  </div>
</template>
