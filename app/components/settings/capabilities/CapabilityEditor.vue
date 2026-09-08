<script setup lang="ts">
import { Loader2Icon } from "@lucide/vue";
import { reactive, watch } from "vue";
import type { CapabilityCreateInput, CapabilityDefinition, CapabilityKind } from "~~/shared/types";
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
import { Switch } from "@codex-gateway/ui/switch";
import { Textarea } from "@codex-gateway/ui/textarea";

const props = defineProps<{
  open: boolean;
  capability: CapabilityDefinition | null;
  saving: boolean;
}>();
const emit = defineEmits<{
  "update:open": [open: boolean];
  save: [payload: { input: CapabilityCreateInput; skillContent: string }];
}>();
const { t } = useI18n();
const form = reactive(emptyForm());

watch(
  () => [props.open, props.capability] as const,
  ([open, capability]) => {
    if (!open) return;
    Object.assign(form, capability === null ? emptyForm() : formFromCapability(capability));
  },
  { immediate: true },
);

function submit() {
  emit("save", { input: buildInput(), skillContent: form.skillContent });
}

function buildInput(): CapabilityCreateInput {
  const common = {
    id: form.id,
    kind: form.kind,
    displayName: form.displayName,
    description: form.description,
    version: form.version,
    source: { type: form.sourceType, locator: form.sourceLocator },
    sensitiveFields: form.sensitiveFields
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean),
    enabled: form.enabled,
  };
  switch (form.kind) {
    case "skill":
      return {
        ...common,
        kind: "skill",
        source: { type: "upload", locator: `artifact:${form.id}:${form.version}` },
        config: { entryPath: "SKILL.md" },
      };
    case "plugin":
      return {
        ...common,
        kind: "plugin",
        config: {
          marketplaceName: form.marketplaceName,
          marketplaceUrl: form.marketplaceUrl,
          pluginName: form.pluginName,
        },
      };
    case "app":
      return { ...common, kind: "app", config: { appId: form.appId } };
    case "mcp":
      return {
        ...common,
        kind: "mcp",
        config:
          form.transport === "stdio"
            ? {
                transport: "stdio",
                command: form.command,
                args: form.args.split("\n").filter(Boolean),
              }
            : { transport: "streamable_http", url: form.url },
      };
    case "search":
      return {
        ...common,
        kind: "search",
        config: { transport: "streamable_http", url: form.url },
      };
  }
}

function emptyForm() {
  return {
    id: "org__",
    kind: "mcp" as CapabilityKind,
    displayName: "",
    description: "",
    version: "1.0.0",
    sourceType: "internal" as "builtin" | "git" | "internal" | "upload",
    sourceLocator: "",
    sensitiveFields: "",
    enabled: true,
    marketplaceName: "",
    marketplaceUrl: "",
    pluginName: "",
    appId: "",
    transport: "streamable_http" as "streamable_http" | "stdio",
    url: "",
    command: "node",
    args: "",
    skillContent: "",
  };
}

function formFromCapability(capability: CapabilityDefinition) {
  const next = emptyForm();
  Object.assign(next, {
    id: capability.id,
    kind: capability.kind,
    displayName: capability.displayName,
    description: capability.description,
    version: capability.version,
    sourceType: capability.source.type,
    sourceLocator: capability.source.locator,
    sensitiveFields: capability.sensitiveFields.join(", "),
    enabled: capability.enabled,
  });
  const config = capability.config;
  if ("marketplaceName" in config) Object.assign(next, config);
  if ("appId" in config) next.appId = config.appId;
  if ("transport" in config) {
    next.transport = config.transport;
    if (config.transport === "stdio") {
      next.command = config.command;
      next.args = config.args.join("\n");
    } else {
      next.url = config.url;
    }
  }
  return next;
}
</script>

<template>
  <Dialog :open="open" @update:open="emit('update:open', $event)">
    <DialogContent class="max-h-[min(44rem,calc(100dvh-2rem))] max-w-2xl overflow-y-auto">
      <DialogHeader>
        <DialogTitle>{{
          t(capability === null ? "app.addCapability" : "app.editCapability")
        }}</DialogTitle>
        <DialogDescription>{{ t("app.capabilityEditorDescription") }}</DialogDescription>
      </DialogHeader>
      <form class="space-y-4" @submit.prevent="submit">
        <div v-if="form.kind !== 'skill'" class="grid gap-3 sm:grid-cols-2">
          <div class="space-y-1.5">
            <Label for="capability-id">{{ t("app.capabilityId") }}</Label>
            <Input id="capability-id" v-model="form.id" :disabled="capability !== null" />
          </div>
          <div class="space-y-1.5">
            <Label for="capability-kind">{{ t("app.capabilityKind") }}</Label>
            <Select v-model="form.kind" :disabled="capability !== null">
              <SelectTrigger id="capability-kind" class="w-full"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem
                  v-for="kind in ['skill', 'plugin', 'app', 'mcp', 'search']"
                  :key="kind"
                  :value="kind"
                >
                  {{ t(`app.capabilityKinds.${kind}`) }}
                </SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
        <div class="grid gap-3 sm:grid-cols-2">
          <div class="space-y-1.5">
            <Label for="capability-name">{{ t("app.name") }}</Label>
            <Input id="capability-name" v-model="form.displayName" />
          </div>
          <div class="space-y-1.5">
            <Label for="capability-version">{{ t("app.version") }}</Label>
            <Input id="capability-version" v-model="form.version" />
          </div>
        </div>
        <div class="space-y-1.5">
          <Label for="capability-description">{{ t("app.description") }}</Label>
          <Textarea id="capability-description" v-model="form.description" />
        </div>
        <div class="grid gap-3 sm:grid-cols-2">
          <div class="space-y-1.5">
            <Label for="capability-source-type">{{ t("app.capabilitySourceType") }}</Label>
            <Select v-model="form.sourceType">
              <SelectTrigger id="capability-source-type" class="w-full"
                ><SelectValue
              /></SelectTrigger>
              <SelectContent>
                <SelectItem
                  v-for="type in ['internal', 'builtin', 'git', 'upload']"
                  :key="type"
                  :value="type"
                  >{{ type }}</SelectItem
                >
              </SelectContent>
            </Select>
          </div>
          <div class="space-y-1.5">
            <Label for="capability-source">{{ t("app.capabilitySource") }}</Label>
            <Input id="capability-source" v-model="form.sourceLocator" />
          </div>
        </div>

        <div v-if="form.kind === 'plugin'" class="grid gap-3 sm:grid-cols-2">
          <div class="space-y-1.5">
            <Label for="marketplace-name">Marketplace</Label
            ><Input id="marketplace-name" v-model="form.marketplaceName" />
          </div>
          <div class="space-y-1.5">
            <Label for="plugin-name">Plugin</Label
            ><Input id="plugin-name" v-model="form.pluginName" />
          </div>
          <div class="space-y-1.5 sm:col-span-2">
            <Label for="marketplace-url">Marketplace URL</Label
            ><Input id="marketplace-url" v-model="form.marketplaceUrl" />
          </div>
        </div>
        <div v-else-if="form.kind === 'skill'" class="space-y-1.5">
          <Label for="skill-content">SKILL.md</Label>
          <Textarea
            id="skill-content"
            v-model="form.skillContent"
            class="min-h-48 font-mono text-xs"
            :placeholder="t('app.skillArtifactPlaceholder')"
          />
        </div>
        <div v-else-if="form.kind === 'app'" class="space-y-1.5">
          <Label for="app-id">App ID</Label><Input id="app-id" v-model="form.appId" />
        </div>
        <div v-else-if="form.kind === 'mcp'" class="space-y-3">
          <div class="space-y-1.5">
            <Label for="mcp-transport">{{ t("app.capabilityTransport") }}</Label>
            <Select v-model="form.transport">
              <SelectTrigger id="mcp-transport" class="w-full"><SelectValue /></SelectTrigger>
              <SelectContent
                ><SelectItem value="streamable_http">Streamable HTTP</SelectItem
                ><SelectItem value="stdio">STDIO</SelectItem></SelectContent
              >
            </Select>
          </div>
          <div v-if="form.transport === 'streamable_http'" class="space-y-1.5">
            <Label for="mcp-url">URL</Label><Input id="mcp-url" v-model="form.url" />
          </div>
          <div v-else class="grid gap-3 sm:grid-cols-2">
            <div class="space-y-1.5">
              <Label for="mcp-command">{{ t("app.command") }}</Label
              ><Input id="mcp-command" v-model="form.command" />
            </div>
            <div class="space-y-1.5">
              <Label for="mcp-args">{{ t("app.argumentsPerLine") }}</Label
              ><Textarea id="mcp-args" v-model="form.args" />
            </div>
          </div>
        </div>
        <div v-else-if="form.kind === 'search'" class="space-y-1.5">
          <Label for="search-url">URL</Label><Input id="search-url" v-model="form.url" />
        </div>

        <div class="space-y-1.5">
          <Label for="capability-sensitive">{{ t("app.capabilitySensitiveFields") }}</Label>
          <Input
            id="capability-sensitive"
            v-model="form.sensitiveFields"
            placeholder="API_TOKEN, CLIENT_SECRET"
          />
        </div>
        <label
          class="flex items-center justify-between gap-3 border-t border-hairline pt-3 text-sm"
        >
          <span>{{ t("app.enabled") }}</span
          ><Switch v-model="form.enabled" />
        </label>
        <DialogFooter>
          <Button type="button" variant="ghost" @click="emit('update:open', false)">{{
            t("app.cancel")
          }}</Button>
          <Button
            type="submit"
            :disabled="
              saving || (capability === null && form.kind === 'skill' && !form.skillContent.trim())
            "
            ><Loader2Icon v-if="saving" class="size-4 animate-spin" />{{ t("app.save") }}</Button
          >
        </DialogFooter>
      </form>
    </DialogContent>
  </Dialog>
</template>
