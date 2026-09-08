<script setup lang="ts">
import {
  KeyRoundIcon,
  LinkIcon,
  PencilIcon,
  ShieldCheckIcon,
  Trash2Icon,
  UserPlusIcon,
  XIcon,
} from "@lucide/vue";
import type {
  AdminCapabilityCatalogItem,
  CapabilityAdminUser,
  CapabilityAssignment,
  CapabilityDeploymentStatus,
  UserCapabilityCatalogItem,
} from "~~/shared/types";
import { Badge } from "@codex-gateway/ui/badge";
import { Button } from "@codex-gateway/ui/button";
import { Switch } from "@codex-gateway/ui/switch";

type CatalogItem = AdminCapabilityCatalogItem | UserCapabilityCatalogItem;

const props = defineProps<{
  items: CatalogItem[];
  users: CapabilityAdminUser[];
  admin: boolean;
  currentUserId: number | null;
  busyId: string | null;
}>();

const emit = defineEmits<{
  edit: [item: CatalogItem];
  delete: [item: CatalogItem];
  assign: [item: CatalogItem];
  unassign: [item: CatalogItem, assignment: CapabilityAssignment];
  credential: [item: CatalogItem];
  revokeCredential: [credentialId: string];
  toggle: [item: CatalogItem, enabled: boolean];
}>();
const { t } = useI18n();

function adminItem(item: CatalogItem): AdminCapabilityCatalogItem | null {
  return "assignments" in item ? item : null;
}

function userName(users: CapabilityAdminUser[], userId: number) {
  const user = users.find((item) => item.id === userId);
  return user === undefined ? `#${userId}` : `${user.username} · #${userId}`;
}

function deploymentStatus(item: CatalogItem): CapabilityDeploymentStatus {
  if ("deploymentStatus" in item) return item.deploymentStatus;
  if (item.deployments.some((deployment) => deployment.status === "failed")) return "failed";
  if (item.deployments.some((deployment) => deployment.status === "syncing")) return "syncing";
  if (item.deployments.length > 0 && item.deployments.every((item) => item.status === "ready")) {
    return "ready";
  }
  return "unknown";
}

function isSystemCapability(item: CatalogItem) {
  return item.id === "org__dinky_mcp" || item.id === "org__infinity";
}

function isPersonalMcp(item: CatalogItem) {
  return (
    item.kind === "mcp" &&
    item.createdByUserId !== null &&
    item.createdByUserId === props.currentUserId
  );
}

function canManage(item: CatalogItem) {
  return (props.admin && !isSystemCapability(item)) || isPersonalMcp(item);
}
</script>

<template>
  <div class="divide-y divide-hairline">
    <section
      v-for="item in items"
      :key="item.id"
      :data-testid="`capability-row-${item.id}`"
      class="space-y-3 py-4"
    >
      <div class="flex min-w-0 items-start gap-3">
        <div class="min-w-0 flex-1">
          <div class="flex flex-wrap items-center gap-2">
            <h3 class="truncate text-sm font-medium text-ink">{{ item.displayName }}</h3>
            <Badge variant="outline">{{ t(`app.capabilityKinds.${item.kind}`) }}</Badge>
            <Badge :variant="deploymentStatus(item) === 'failed' ? 'destructive' : 'secondary'">
              {{ t(`app.capabilityDeployment.${deploymentStatus(item)}`) }}
            </Badge>
            <span v-if="!item.enabled" class="text-xs text-accent-orange-deep">
              {{ t("app.disabled") }}
            </span>
          </div>
          <p class="mt-1 text-sm leading-5 text-ink-muted">{{ item.description }}</p>
          <div class="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-xs text-ink-faint">
            <span>{{ item.id }}</span>
            <span>v{{ item.version }}</span>
            <span v-if="'credentialStatus' in item">
              {{ t(`app.capabilityCredential.${item.credentialStatus}`) }}
            </span>
          </div>
        </div>
        <div v-if="canManage(item)" class="flex shrink-0 items-center gap-1">
          <Switch
            :model-value="item.enabled"
            :disabled="busyId !== null"
            :aria-label="t('app.toggleCapabilityNamed', { name: item.displayName })"
            :data-testid="`capability-enabled-${item.id}`"
            @update:model-value="emit('toggle', item, $event)"
          />
          <Button
            v-if="admin"
            type="button"
            variant="ghost"
            size="icon-sm"
            :aria-label="t('app.assignCapabilityNamed', { name: item.displayName })"
            @click="emit('assign', item)"
          >
            <UserPlusIcon class="size-4" />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            :aria-label="t('app.addCredentialNamed', { name: item.displayName })"
            @click="emit('credential', item)"
          >
            <KeyRoundIcon class="size-4" />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            :aria-label="t('app.editCapabilityNamed', { name: item.displayName })"
            @click="emit('edit', item)"
          >
            <PencilIcon class="size-4" />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            class="text-ink-muted hover:text-destructive"
            :aria-label="t('app.deleteCapabilityNamed', { name: item.displayName })"
            @click="emit('delete', item)"
          >
            <Trash2Icon class="size-4" />
          </Button>
        </div>
      </div>

      <div v-if="adminItem(item)?.assignments.length" class="flex flex-wrap gap-2">
        <span
          v-for="assignment in adminItem(item)?.assignments"
          :key="assignment.id"
          class="inline-flex items-center gap-1.5 rounded-md bg-muted px-2 py-1 text-xs text-ink-secondary"
        >
          <LinkIcon class="size-3" />
          {{ userName(users, assignment.userId) }}
          <span v-if="assignment.projectId !== null">· P{{ assignment.projectId }}</span>
          <Button
            v-if="admin && !isSystemCapability(item)"
            type="button"
            variant="ghost"
            size="icon-sm"
            class="size-5"
            :aria-label="t('app.removeCapabilityAssignment')"
            @click="emit('unassign', item, assignment)"
          >
            <XIcon class="size-3" />
          </Button>
        </span>
      </div>

      <div v-if="item.credentials.length" class="flex flex-wrap gap-2">
        <span
          v-for="credential in item.credentials"
          :key="credential.id"
          class="inline-flex items-center gap-1.5 rounded-md border border-hairline px-2 py-1 text-xs text-ink-secondary"
        >
          <ShieldCheckIcon class="size-3" />
          {{ credential.id }} · {{ credential.kind }} · v{{ credential.version }}
          <span v-if="credential.revokedAt !== null" class="text-destructive">
            {{ t("app.revoked") }}
          </span>
          <Button
            v-if="canManage(item) && credential.revokedAt === null"
            type="button"
            variant="ghost"
            size="icon-sm"
            class="size-5"
            :aria-label="t('app.revokeCredentialNamed', { name: credential.id })"
            @click="emit('revokeCredential', credential.id)"
          >
            <XIcon class="size-3" />
          </Button>
        </span>
      </div>
    </section>

    <p v-if="items.length === 0" class="py-10 text-center text-sm text-ink-muted">
      {{ t("app.noCapabilities") }}
    </p>
  </div>
</template>
