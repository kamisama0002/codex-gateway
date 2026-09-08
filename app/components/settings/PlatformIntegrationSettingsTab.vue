<script setup lang="ts">
import { CopyIcon, Loader2Icon, RefreshCwIcon, Trash2Icon } from "@lucide/vue";
import { computed, onBeforeUnmount, onMounted, ref } from "vue";
import { Alert, AlertDescription } from "@codex-gateway/ui/alert";
import { Badge } from "@codex-gateway/ui/badge";
import { Button } from "@codex-gateway/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@codex-gateway/ui/dialog";
import { gatewayApi } from "@/utils/gateway-api";
import {
  platformIntegrationAccess,
  platformIntegrationView,
  remainingPairingCodeSeconds,
  type PlatformIntegrationApiResponse,
} from "@/utils/platform-integration-state";
import type { AuthenticatedUser } from "~~/server/utils/gateway/auth/users";

const { t } = useI18n();
const response = ref<PlatformIntegrationApiResponse | null>(null);
const backendError = ref<string | null>(null);
const pairingCode = ref<string | null>(null);
const expiresAt = ref<string | null>(null);
const dialogOpen = ref(false);
const loading = ref(false);
const seconds = ref(0);
const user = ref<AuthenticatedUser | null>(null);
let timer: ReturnType<typeof setInterval> | null = null;
const view = computed(() =>
  platformIntegrationView(response.value, backendError.value, Date.now()),
);
const activeStatus = computed(() => (pairingCode.value === null ? view.value.status : "pending"));
const access = computed(() => platformIntegrationAccess(user.value));
const canManage = computed(() => access.value === "manage");

function clearCode() {
  pairingCode.value = null;
  expiresAt.value = null;
  seconds.value = 0;
  dialogOpen.value = false;
}
function tick() {
  seconds.value = remainingPairingCodeSeconds(expiresAt.value, Date.now());
  if (seconds.value === 0) clearCode();
}
async function refresh() {
  try {
    response.value = await gatewayApi<PlatformIntegrationApiResponse>(
      "/api/admin/integrations/dataops",
    );
    backendError.value = null;
  } catch (caught: unknown) {
    backendError.value = caught instanceof Error ? caught.message : "dataops_unavailable";
  }
}
async function generate() {
  loading.value = true;
  try {
    const result = await gatewayApi<{ pairingCode: string; expiresAt: string }>(
      "/api/admin/integrations/dataops/pairing-codes",
      { method: "POST" },
    );
    pairingCode.value = result.pairingCode;
    expiresAt.value = result.expiresAt;
    dialogOpen.value = true;
    tick();
  } finally {
    loading.value = false;
  }
}
async function revoke() {
  await gatewayApi("/api/admin/integrations/dataops/pairing-codes", { method: "DELETE" });
  clearCode();
  await refresh();
}
async function copy() {
  if (pairingCode.value) await navigator.clipboard.writeText(pairingCode.value);
}
onMounted(async () => {
  user.value = (await gatewayApi<{ user: AuthenticatedUser }>("/api/auth/me")).user;
  await refresh();
  timer = setInterval(tick, 1000);
});
onBeforeUnmount(() => {
  if (timer) clearInterval(timer);
  clearCode();
});
</script>
<template>
  <div class="mx-auto w-full max-w-2xl space-y-5" data-testid="platform-integrations-tab">
    <div class="border-b border-hairline pb-4">
      <h2 class="font-medium text-ink">{{ t("app.platformIntegrations") }}</h2>
      <p class="mt-1 text-sm text-ink-muted">{{ t("app.platformIntegrationsDescription") }}</p>
    </div>
    <Alert
      ><AlertDescription class="flex flex-wrap items-center justify-between gap-3"
        ><span>{{ t("app.platformIntegrationStatus") }}</span
        ><Badge>{{ activeStatus }}</Badge></AlertDescription
      ></Alert
    >
    <div v-if="view.active" class="grid gap-2 text-sm sm:grid-cols-2">
      <span>{{ view.active.pairingId }}</span
      ><span>v{{ view.active.revision }}</span>
    </div>
    <p v-if="access === 'read'" class="text-sm text-ink-muted">
      {{ t("app.platformIntegrationReadOnly") }}
    </p>
    <div v-if="canManage" class="flex flex-wrap gap-2">
      <Button :disabled="loading" @click="generate"
        ><Loader2Icon v-if="loading" class="size-4 animate-spin" /><RefreshCwIcon
          v-else
          class="size-4"
        />{{ t("app.generatePairingCode") }}</Button
      ><Button variant="outline" @click="revoke"
        ><Trash2Icon class="size-4" />{{ t("app.revokePairingCode") }}</Button
      >
    </div>
    <Dialog :open="dialogOpen" @update:open="$event || clearCode()"
      ><DialogContent
        ><DialogHeader
          ><DialogTitle>{{ t("app.pairingCode") }}</DialogTitle></DialogHeader
        ><code v-if="pairingCode" class="break-all rounded bg-muted p-3 text-sm">{{
          pairingCode
        }}</code>
        <p class="text-sm text-ink-muted">{{ t("app.pairingCodeExpires", { seconds }) }}</p>
        <DialogFooter
          ><Button variant="outline" @click="copy"
            ><CopyIcon class="size-4" />{{ t("app.copy") }}</Button
          ><Button @click="clearCode">{{ t("app.close") }}</Button></DialogFooter
        ></DialogContent
      ></Dialog
    >
  </div>
</template>
