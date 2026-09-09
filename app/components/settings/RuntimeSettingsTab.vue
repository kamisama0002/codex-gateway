<script setup lang="ts">
import { Loader2Icon, PlayIcon, RefreshCwIcon } from "@lucide/vue";
import { FetchError } from "ofetch";
import { computed, onMounted, ref } from "vue";
import { Badge } from "@codex-gateway/ui/badge";
import { Button } from "@codex-gateway/ui/button";
import type { ManagedRuntimeStatusView } from "@codex-gateway/agent-runtime-contracts";
import { gatewayApi } from "@/utils/gateway-api";
import {
  formatIdleTimeoutMinutes,
  runtimePolicySummary,
  shouldShowRuntimePolicy,
  type RuntimePolicyBadge,
} from "@/utils/runtime-policy-view";
import { isRuntimeActionPending, runtimeActionForStatus } from "@/utils/runtime-action";
import { errorMessageLabels, messageFromError } from "@/stores/gateway/thread-utils/identity";
import RuntimeNodeSettings from "./RuntimeNodeSettings.vue";

type RuntimeStatusView = ManagedRuntimeStatusView;

const { t } = useI18n();
const errorLabels = computed(() => errorMessageLabels(t));
const loading = ref(true);
const starting = ref(false);
const restartingMine = ref(false);
const restartingUserId = ref<number | null>(null);
const error = ref("");
const mine = ref<RuntimeStatusView | null>(null);
const runtimes = ref<RuntimeStatusView[]>([]);
const platformIdleTimeoutMinutes = ref<number | null>(null);
const canAdminister = ref(false);
const minePolicy = computed(() => (mine.value === null ? null : runtimePolicySummary(mine.value)));
const mineHasPolicy = computed(() => mine.value !== null && shouldShowRuntimePolicy(mine.value));
const mineAction = computed(() => runtimeActionForStatus(mine.value?.runtime?.status));

function statusVariant(status: string) {
  if (status === "ready") return "default" as const;
  if (status === "degraded" || status === "incompatible") return "destructive" as const;
  return "secondary" as const;
}

onMounted(() => {
  void refresh();
});

async function refresh() {
  loading.value = true;
  error.value = "";
  try {
    const [nextMine, runtimeConfig] = await Promise.all([
      gatewayApi<RuntimeStatusView | null>("/api/runtime/me"),
      gatewayApi<{ idleTimeoutMinutes: number }>("/api/runtime/config"),
    ]);
    mine.value = nextMine;
    platformIdleTimeoutMinutes.value = runtimeConfig.idleTimeoutMinutes;
    try {
      runtimes.value = await gatewayApi<RuntimeStatusView[]>("/api/admin/runtimes");
      canAdminister.value = true;
    } catch (caught: unknown) {
      if (isForbidden(caught)) {
        canAdminister.value = false;
        runtimes.value = [];
      } else {
        throw caught;
      }
    }
  } catch (caught: unknown) {
    error.value = messageFromError(caught, t("app.runtimeSettingsLoadFailed"), errorLabels.value);
  } finally {
    loading.value = false;
  }
}

async function startMine() {
  starting.value = true;
  error.value = "";
  try {
    mine.value = await gatewayApi<RuntimeStatusView>("/api/runtime/start", { method: "POST" });
    if (canAdminister.value) await refreshAdmin();
  } catch (caught: unknown) {
    error.value = messageFromError(caught, t("app.runtimeStartFailed"), errorLabels.value);
  } finally {
    starting.value = false;
  }
}

async function restartRuntime(userId: number) {
  restartingUserId.value = userId;
  error.value = "";
  try {
    const next = await gatewayApi<RuntimeStatusView>(`/api/admin/runtimes/${userId}/restart`, {
      method: "POST",
    });
    runtimes.value = runtimes.value.map((runtime) =>
      runtime.runtime?.userId === userId ? next : runtime,
    );
    if (mine.value?.runtime?.userId === userId) mine.value = next;
  } catch (caught: unknown) {
    error.value = messageFromError(caught, t("app.runtimeRestartFailed"), errorLabels.value);
  } finally {
    restartingUserId.value = null;
  }
}

async function restartMine() {
  restartingMine.value = true;
  error.value = "";
  try {
    const next = await gatewayApi<RuntimeStatusView>("/api/runtime/restart", { method: "POST" });
    mine.value = next;
    if (canAdminister.value) {
      runtimes.value = runtimes.value.map((runtime) =>
        runtime.runtime?.userId === next.runtime?.userId ? next : runtime,
      );
    }
  } catch (caught: unknown) {
    error.value = messageFromError(caught, t("app.runtimeRestartFailed"), errorLabels.value);
  } finally {
    restartingMine.value = false;
  }
}

async function refreshAdmin() {
  runtimes.value = await gatewayApi<RuntimeStatusView[]>("/api/admin/runtimes");
}

function isForbidden(error: unknown) {
  return error instanceof FetchError && error.statusCode === 403;
}

function statusLabel(status: string) {
  const key = `app.runtimeStatus.${status}`;
  const translated = t(key);
  return translated === key ? status : translated;
}

function runtimeTitle(userId: number | undefined) {
  return userId === undefined
    ? t("app.runtimeMineAbsent")
    : t("app.runtimeUserFallback", { id: userId });
}

function policyBadgeLabel(badge: RuntimePolicyBadge) {
  return t(badge === "restart" ? "app.runtimeRestartRequired" : "app.runtimeUpgradeRequired");
}

function policyBadgeVariant(badge: RuntimePolicyBadge) {
  return badge === "restart" ? ("secondary" as const) : ("destructive" as const);
}

function formatUpdatedAt(value: string) {
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? value : new Date(parsed).toLocaleString();
}

function idleTimeoutLabel(view: RuntimeStatusView | null) {
  return formatIdleTimeoutMinutes(
    view?.assignedPolicy?.idleTimeoutMinutes ?? null,
    platformIdleTimeoutMinutes.value,
  );
}
</script>

<template>
  <div class="max-w-2xl space-y-5">
    <div class="space-y-1">
      <div class="font-medium">{{ t("app.runtimeSettings") }}</div>
      <p class="text-sm text-ink-secondary">
        {{ t("app.runtimeSettingsDescription") }}
      </p>
    </div>

    <div v-if="error" class="rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive">
      {{ error }}
    </div>

    <div class="rounded-xl border border-hairline bg-canvas-soft/70 p-4">
      <div class="flex flex-wrap items-start justify-between gap-4">
        <div class="min-w-0 space-y-2">
          <div class="text-sm font-medium">{{ t("app.runtimeMine") }}</div>
          <p class="text-sm text-ink-secondary">
            {{ t("app.runtimeMineDescription") }}
          </p>
          <div v-if="loading" class="flex items-center gap-2 text-sm text-ink-muted">
            <Loader2Icon class="size-4 animate-spin" />
            {{ t("app.runtimeLoading") }}
          </div>
          <div v-else class="space-y-2 text-sm">
            <template v-if="mine?.runtime">
              <div class="flex flex-wrap items-center gap-2">
                <Badge :variant="statusVariant(mine.runtime.status)">{{
                  statusLabel(mine.runtime.status)
                }}</Badge>
                <span class="text-ink-muted">{{ mine.runtime.runtimeVersion }}</span>
              </div>
              <div class="flex items-center justify-between gap-2 text-ink-muted">
                <span>{{ t("app.runtimeIdleTimeout") }}</span>
                <span>{{ idleTimeoutLabel(mine) }}</span>
              </div>
              <div v-if="minePolicy?.badges.length" class="flex flex-wrap gap-2">
                <Badge
                  v-for="badge in minePolicy.badges"
                  :key="badge"
                  :variant="policyBadgeVariant(badge)"
                >
                  {{ policyBadgeLabel(badge) }}
                </Badge>
              </div>
            </template>
            <div v-if="mineHasPolicy" class="space-y-2">
              <div v-if="minePolicy?.assigned" class="space-y-1 border-t border-hairline pt-2">
                <div class="text-xs font-medium text-ink-secondary">
                  {{ t("app.runtimeAssignedPolicy") }}
                </div>
                <div class="grid gap-x-4 gap-y-1 sm:grid-cols-2">
                  <div class="flex items-center justify-between gap-2">
                    <span class="text-ink-muted">{{ t("app.runtimeMemory") }}</span>
                    <span>{{ minePolicy.assigned.memory }}</span>
                  </div>
                  <div class="flex items-center justify-between gap-2">
                    <span class="text-ink-muted">{{ t("app.runtimeCpu") }}</span>
                    <span>{{ minePolicy.assigned.cpu }}</span>
                  </div>
                  <div class="flex items-center justify-between gap-2">
                    <span class="text-ink-muted">{{ t("app.runtimePids") }}</span>
                    <span>{{ minePolicy.assigned.pids }}</span>
                  </div>
                  <div class="flex items-center justify-between gap-2">
                    <span class="text-ink-muted">{{ t("app.runtimeImageAlias") }}</span>
                    <span>{{ minePolicy.assigned.imageAlias }}</span>
                  </div>
                  <div class="flex items-center justify-between gap-2">
                    <span class="text-ink-muted">{{ t("app.runtimeIdleTimeout") }}</span>
                    <span>{{ idleTimeoutLabel(mine) }}</span>
                  </div>
                </div>
              </div>
              <div v-if="minePolicy?.actual" class="space-y-1 border-t border-hairline pt-2">
                <div class="text-xs font-medium text-ink-secondary">
                  {{ t("app.runtimeActualResources") }}
                </div>
                <div class="grid gap-x-4 gap-y-1 sm:grid-cols-2">
                  <div class="flex items-center justify-between gap-2">
                    <span class="text-ink-muted">{{ t("app.runtimeMemory") }}</span>
                    <span>{{ minePolicy.actual.memory }}</span>
                  </div>
                  <div class="flex items-center justify-between gap-2">
                    <span class="text-ink-muted">{{ t("app.runtimeCpu") }}</span>
                    <span>{{ minePolicy.actual.cpu }}</span>
                  </div>
                  <div class="flex items-center justify-between gap-2">
                    <span class="text-ink-muted">{{ t("app.runtimePids") }}</span>
                    <span>{{ minePolicy.actual.pids }}</span>
                  </div>
                  <div
                    v-if="minePolicy.actual.imageAlias"
                    class="flex items-center justify-between gap-2"
                  >
                    <span class="text-ink-muted">{{ t("app.runtimeImageAlias") }}</span>
                    <span>{{ minePolicy.actual.imageAlias }}</span>
                  </div>
                </div>
              </div>
            </div>
            <template v-if="mine?.runtime">
              <p v-if="mine.runtime.lastError" class="text-destructive">
                {{ mine.runtime.lastError }}
              </p>
              <p class="text-ink-muted">
                {{ t("app.runtimeUpdatedAt", { time: formatUpdatedAt(mine.runtime.updatedAt) }) }}
              </p>
            </template>
            <p v-if="!mine?.runtime && !mineHasPolicy" class="text-sm text-ink-secondary">
              {{ t("app.runtimeMineAbsent") }}
            </p>
          </div>
        </div>
        <Button
          v-if="mineAction === 'restart'"
          data-testid="runtime-self-restart-button"
          class="shrink-0"
          :disabled="loading || restartingMine"
          @click="restartMine"
        >
          <Loader2Icon v-if="restartingMine" class="size-4 animate-spin" />
          <RefreshCwIcon v-else class="size-4" />
          {{ t("app.runtimeRestart") }}
        </Button>
        <Button
          v-else-if="mineAction === 'pending'"
          data-testid="runtime-pending-button"
          class="shrink-0"
          disabled
        >
          <Loader2Icon class="size-4 animate-spin" />
          {{ statusLabel(mine?.runtime?.status ?? "provisioning") }}
        </Button>
        <Button
          v-else
          data-testid="runtime-start-button"
          class="shrink-0"
          :disabled="loading || starting"
          @click="startMine"
        >
          <Loader2Icon v-if="starting" class="size-4 animate-spin" />
          <PlayIcon v-else class="size-4" />
          {{ t("app.runtimeStart") }}
        </Button>
      </div>
    </div>

    <section v-if="canAdminister" class="space-y-2">
      <div class="text-sm font-medium text-ink-secondary">{{ t("app.runtimeAdminList") }}</div>
      <div
        v-if="!runtimes.length"
        class="rounded-md border border-hairline bg-canvas-soft p-3 text-sm text-ink-secondary"
      >
        {{ t("app.runtimeAdminEmpty") }}
      </div>
      <div
        v-for="runtime in runtimes"
        :key="runtime.runtime?.userId ?? runtime.runtime?.updatedAt"
        class="rounded-md border border-hairline bg-canvas-soft p-3"
        data-testid="runtime-admin-row"
      >
        <div v-if="runtime.runtime" class="flex flex-wrap items-start justify-between gap-3">
          <div class="min-w-0 space-y-1">
            <div class="flex flex-wrap items-center gap-2">
              <span class="text-sm font-medium">{{ runtimeTitle(runtime.runtime.userId) }}</span>
              <Badge :variant="statusVariant(runtime.runtime.status)">{{
                statusLabel(runtime.runtime.status)
              }}</Badge>
            </div>
            <p class="text-sm text-ink-muted">
              {{ runtime.runtime.imageVersion }} · {{ runtime.runtime.runtimeVersion }}
            </p>
            <p v-if="runtime.runtime.lastError" class="text-sm text-destructive">
              {{ runtime.runtime.lastError }}
            </p>
            <p class="text-sm text-ink-muted">
              {{ t("app.runtimeUpdatedAt", { time: formatUpdatedAt(runtime.runtime.updatedAt) }) }}
            </p>
            <p class="text-sm text-ink-muted">
              {{ t("app.runtimeIdleTimeout") }}: {{ idleTimeoutLabel(runtime) }}
            </p>
          </div>
          <Button
            variant="outline"
            size="sm"
            class="shrink-0"
            :disabled="
              restartingUserId === runtime.runtime.userId ||
              isRuntimeActionPending(runtime.runtime.status)
            "
            data-testid="runtime-restart-button"
            @click="restartRuntime(runtime.runtime.userId)"
          >
            <Loader2Icon
              v-if="restartingUserId === runtime.runtime.userId"
              class="size-4 animate-spin"
            />
            <RefreshCwIcon v-else class="size-4" />
            {{ t("app.runtimeRestart") }}
          </Button>
        </div>
      </div>

      <RuntimeNodeSettings />
    </section>
  </div>
</template>
