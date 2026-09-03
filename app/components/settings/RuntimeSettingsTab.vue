<script setup lang="ts">
import { Loader2Icon, PlayIcon, RefreshCwIcon } from "@lucide/vue";
import { FetchError } from "ofetch";
import { computed, onMounted, ref } from "vue";
import { Badge } from "@codex-gateway/ui/badge";
import { Button } from "@codex-gateway/ui/button";
import { gatewayApi } from "@/utils/gateway-api";
import { errorMessageLabels, messageFromError } from "@/stores/gateway/thread-utils/identity";

interface RuntimeStatusView {
  userId: number;
  username?: string;
  runtimeType: string;
  imageVersion: string;
  runtimeVersion: string;
  status: string;
  lastError: string | null;
  updatedAt: string;
}

const { t } = useI18n();
const errorLabels = computed(() => errorMessageLabels(t));
const loading = ref(true);
const starting = ref(false);
const restartingUserId = ref<number | null>(null);
const error = ref("");
const mine = ref<RuntimeStatusView | null>(null);
const runtimes = ref<RuntimeStatusView[]>([]);
const canAdminister = ref(false);

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
    mine.value = await gatewayApi<RuntimeStatusView | null>("/api/runtime/me");
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
    runtimes.value = runtimes.value.map((runtime) => (runtime.userId === userId ? next : runtime));
    if (mine.value?.userId === userId) mine.value = next;
  } catch (caught: unknown) {
    error.value = messageFromError(caught, t("app.runtimeRestartFailed"), errorLabels.value);
  } finally {
    restartingUserId.value = null;
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

function runtimeTitle(runtime: RuntimeStatusView) {
  return runtime.username === undefined || runtime.username === ""
    ? t("app.runtimeUserFallback", { id: runtime.userId })
    : runtime.username;
}

function formatUpdatedAt(value: string) {
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? value : new Date(parsed).toLocaleString();
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

    <div
      v-if="error"
      class="rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive"
    >
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
          <div v-else-if="mine" class="space-y-1 text-sm">
            <div class="flex flex-wrap items-center gap-2">
              <Badge :variant="statusVariant(mine.status)">{{ statusLabel(mine.status) }}</Badge>
              <span class="text-ink-muted">{{ mine.runtimeVersion }}</span>
            </div>
            <p v-if="mine.lastError" class="text-destructive">{{ mine.lastError }}</p>
            <p class="text-ink-muted">
              {{ t("app.runtimeUpdatedAt", { time: formatUpdatedAt(mine.updatedAt) }) }}
            </p>
          </div>
          <p v-else class="text-sm text-ink-secondary">{{ t("app.runtimeMineAbsent") }}</p>
        </div>
        <Button
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
        :key="runtime.userId"
        class="rounded-md border border-hairline bg-canvas-soft p-3"
        data-testid="runtime-admin-row"
      >
        <div class="flex flex-wrap items-start justify-between gap-3">
          <div class="min-w-0 space-y-1">
            <div class="flex flex-wrap items-center gap-2">
              <span class="text-sm font-medium">{{ runtimeTitle(runtime) }}</span>
              <Badge :variant="statusVariant(runtime.status)">{{
                statusLabel(runtime.status)
              }}</Badge>
            </div>
            <p class="text-sm text-ink-muted">
              {{ runtime.imageVersion }} · {{ runtime.runtimeVersion }}
            </p>
            <p v-if="runtime.lastError" class="text-sm text-destructive">{{ runtime.lastError }}</p>
            <p class="text-sm text-ink-muted">
              {{ t("app.runtimeUpdatedAt", { time: formatUpdatedAt(runtime.updatedAt) }) }}
            </p>
          </div>
          <Button
            variant="outline"
            size="sm"
            class="shrink-0"
            :disabled="restartingUserId === runtime.userId"
            data-testid="runtime-restart-button"
            @click="restartRuntime(runtime.userId)"
          >
            <Loader2Icon
              v-if="restartingUserId === runtime.userId"
              class="size-4 animate-spin"
            />
            <RefreshCwIcon v-else class="size-4" />
            {{ t("app.runtimeRestart") }}
          </Button>
        </div>
      </div>
    </section>
  </div>
</template>
