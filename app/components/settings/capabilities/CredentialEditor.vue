<script setup lang="ts">
import { Loader2Icon } from "@lucide/vue";
import { reactive, watch } from "vue";
import type {
  AdminCapabilityCatalogItem,
  CapabilityAdminUser,
  CredentialCreateInput,
  CredentialKind,
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
import { Textarea } from "@codex-gateway/ui/textarea";

type CatalogItem = AdminCapabilityCatalogItem | UserCapabilityCatalogItem;

const props = withDefaults(
  defineProps<{
    open: boolean;
    capability: CatalogItem | null;
    users?: CapabilityAdminUser[];
    saving: boolean;
    personalUserId?: number | null;
  }>(),
  { users: () => [], personalUserId: null },
);
const emit = defineEmits<{
  "update:open": [open: boolean];
  save: [input: CredentialCreateInput];
}>();
const { t } = useI18n();
const form = reactive(emptyForm());

watch(
  () => [props.open, props.capability, props.users, props.personalUserId] as const,
  ([open, capability, users, personalUserId]) => {
    if (!open || capability === null) return;
    Object.assign(form, emptyForm());
    form.capabilityId = capability.id;
    form.id = `cred__${capability.id.replace(/^org__/u, "")}`;
    const assignedUserId =
      "assignments" in capability ? capability.assignments[0]?.userId : undefined;
    form.userId = String(personalUserId ?? assignedUserId ?? users[0]?.id ?? "");
    form.target = capability.sensitiveFields[0] ?? "CAPABILITY_TOKEN";
  },
  { immediate: true },
);

watch(
  () => form.kind,
  (kind) => {
    if (kind === "ssh_private_key") {
      form.targetType = "file";
      form.target = "/run/codex-secrets/id_rsa";
    } else if (kind !== "username_password" && !form.target.startsWith("/run/codex-secrets/")) {
      form.targetType = "env";
    }
  },
);

function submit() {
  emit("save", buildInput());
}

function buildInput(): CredentialCreateInput {
  const projectId = form.projectId.trim() === "" ? null : Number(form.projectId);
  const base = {
    id: form.id,
    capabilityId: form.capabilityId,
    userId: Number(form.userId),
    projectId,
    kind: form.kind,
    notBefore: null,
    expiresAt: null,
  };
  switch (form.kind) {
    case "token":
      return {
        ...base,
        kind: "token",
        secret: { token: form.token },
        mappings: [{ field: "token", target: target(form.targetType, form.target) }],
      };
    case "oauth":
      return {
        ...base,
        kind: "oauth",
        secret: { accessToken: form.token },
        mappings: [{ field: "accessToken", target: target(form.targetType, form.target) }],
      };
    case "username_password":
      return {
        ...base,
        kind: "username_password",
        secret: { username: form.username, password: form.password },
        mappings: [
          { field: "username", target: { type: "env", name: form.usernameTarget } },
          { field: "password", target: { type: "env", name: form.passwordTarget } },
        ],
      };
    case "ssh_private_key":
      return {
        ...base,
        kind: "ssh_private_key",
        secret: { privateKey: form.privateKey },
        mappings: [{ field: "privateKey", target: { type: "file", path: form.target } }],
      };
    case "external_issuer":
      return {
        ...base,
        kind: "external_issuer",
        secret: { issuerUrl: form.issuerUrl, audience: form.audience },
        mappings: [{ field: "token", target: target(form.targetType, form.target) }],
      };
  }
}

function target(type: "env" | "file", value: string) {
  return type === "env" ? ({ type, name: value } as const) : ({ type, path: value } as const);
}

function emptyForm() {
  return {
    id: "cred__",
    capabilityId: "",
    userId: "",
    projectId: "",
    kind: "token" as CredentialKind,
    token: "",
    username: "",
    password: "",
    privateKey: "",
    issuerUrl: "",
    audience: "",
    targetType: "env" as "env" | "file",
    target: "CAPABILITY_TOKEN",
    usernameTarget: "CAPABILITY_USERNAME",
    passwordTarget: "CAPABILITY_PASSWORD",
  };
}
</script>

<template>
  <Dialog :open="open" @update:open="emit('update:open', $event)">
    <DialogContent class="max-h-[min(44rem,calc(100dvh-2rem))] max-w-xl overflow-y-auto">
      <DialogHeader
        ><DialogTitle>{{ t("app.addCredential") }}</DialogTitle
        ><DialogDescription>{{
          t("app.credentialEditorDescription")
        }}</DialogDescription></DialogHeader
      >
      <form class="space-y-4" @submit.prevent="submit">
        <div v-if="personalUserId !== null" class="space-y-1.5">
          <Label for="credential-id">{{ t("app.credentialId") }}</Label>
          <Input id="credential-id" v-model="form.id" />
        </div>
        <div v-if="personalUserId === null" class="grid gap-3 sm:grid-cols-2">
          <div class="space-y-1.5">
            <Label for="credential-id">{{ t("app.credentialId") }}</Label
            ><Input id="credential-id" v-model="form.id" />
          </div>
          <div class="space-y-1.5">
            <Label for="credential-user">{{ t("app.user") }}</Label
            ><Select v-model="form.userId"
              ><SelectTrigger id="credential-user" class="w-full"><SelectValue /></SelectTrigger
              ><SelectContent
                ><SelectItem v-for="user in users" :key="user.id" :value="String(user.id)"
                  >{{ user.username }} · #{{ user.id }}</SelectItem
                ></SelectContent
              ></Select
            >
          </div>
        </div>
        <div class="grid gap-3 sm:grid-cols-2">
          <div v-if="personalUserId === null" class="space-y-1.5">
            <Label for="credential-project">{{ t("app.projectIdOptional") }}</Label
            ><Input id="credential-project" v-model="form.projectId" inputmode="numeric" />
          </div>
          <div class="space-y-1.5">
            <Label for="credential-kind">{{ t("app.credentialKind") }}</Label
            ><Select v-model="form.kind"
              ><SelectTrigger id="credential-kind" class="w-full"><SelectValue /></SelectTrigger
              ><SelectContent
                ><SelectItem
                  v-for="kind in [
                    'token',
                    'username_password',
                    'ssh_private_key',
                    'oauth',
                    'external_issuer',
                  ]"
                  :key="kind"
                  :value="kind"
                  >{{ kind }}</SelectItem
                ></SelectContent
              ></Select
            >
          </div>
        </div>
        <div v-if="form.kind === 'token' || form.kind === 'oauth'" class="space-y-1.5">
          <Label for="credential-token">Token</Label
          ><Input id="credential-token" v-model="form.token" type="password" autocomplete="off" />
        </div>
        <div v-else-if="form.kind === 'username_password'" class="grid gap-3 sm:grid-cols-2">
          <div class="space-y-1.5">
            <Label for="credential-username">{{ t("app.username") }}</Label
            ><Input id="credential-username" v-model="form.username" />
          </div>
          <div class="space-y-1.5">
            <Label for="credential-password">{{ t("app.password") }}</Label
            ><Input id="credential-password" v-model="form.password" type="password" />
          </div>
        </div>
        <div v-else-if="form.kind === 'ssh_private_key'" class="space-y-1.5">
          <Label for="credential-private-key">SSH Private Key</Label
          ><Textarea
            id="credential-private-key"
            v-model="form.privateKey"
            class="min-h-40 font-mono text-xs"
          />
        </div>
        <div v-else class="grid gap-3 sm:grid-cols-2">
          <div class="space-y-1.5">
            <Label for="credential-issuer">Issuer URL</Label
            ><Input id="credential-issuer" v-model="form.issuerUrl" />
          </div>
          <div class="space-y-1.5">
            <Label for="credential-audience">Audience</Label
            ><Input id="credential-audience" v-model="form.audience" />
          </div>
        </div>
        <div v-if="form.kind !== 'username_password'" class="grid gap-3 sm:grid-cols-2">
          <div v-if="form.kind !== 'ssh_private_key'" class="space-y-1.5">
            <Label for="credential-target-type">{{ t("app.credentialTargetType") }}</Label
            ><Select v-model="form.targetType"
              ><SelectTrigger id="credential-target-type" class="w-full"
                ><SelectValue /></SelectTrigger
              ><SelectContent
                ><SelectItem value="env">env</SelectItem
                ><SelectItem value="file">file</SelectItem></SelectContent
              ></Select
            >
          </div>
          <div class="space-y-1.5" :class="form.kind === 'ssh_private_key' ? 'sm:col-span-2' : ''">
            <Label for="credential-target">{{
              form.targetType === "env" && form.kind !== "ssh_private_key"
                ? t("app.environmentVariable")
                : t("app.secretFilePath")
            }}</Label
            ><Input id="credential-target" v-model="form.target" />
          </div>
        </div>
        <DialogFooter
          ><Button type="button" variant="ghost" @click="emit('update:open', false)">{{
            t("app.cancel")
          }}</Button
          ><Button type="submit" :disabled="saving"
            ><Loader2Icon v-if="saving" class="size-4 animate-spin" />{{ t("app.save") }}</Button
          ></DialogFooter
        >
      </form>
    </DialogContent>
  </Dialog>
</template>
