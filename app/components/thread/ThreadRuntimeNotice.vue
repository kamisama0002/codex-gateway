<script setup lang="ts">
import {
  CircleAlertIcon,
  Clock3Icon,
  Loader2Icon,
  MessageCircleIcon,
  MonitorIcon,
  RefreshCwIcon,
  RotateCcwIcon,
  SquareIcon,
  XIcon,
} from "@lucide/vue";
import { computed, onBeforeUnmount, ref, toRef, watch } from "vue";
import { Button } from "@codex-gateway/ui/button";
import type { ThreadRuntimePhase } from "~~/shared/types";
import type { GatewayErrorState } from "@/stores/gateway/types";
import { useGatewayBootstrapStore } from "@/stores/gateway-bootstrap";
import { useGatewayThreadTurnsStore } from "@/stores/gateway-thread-turns";
import { MAX_SERVER_OVERLOADED_RETRIES } from "@/stores/gateway-thread-turns/types";
import { useThreadRuntimeElapsed } from "./useThreadRuntimeElapsed";

const props = defineProps<{
  hostId: number | null;
  projectId: number | null;
  threadId: string | null;
  phase: ThreadRuntimePhase;
  error: GatewayErrorState | null;
}>();

const { t } = useI18n();
const bootstrap = useGatewayBootstrapStore();
const turns = useGatewayThreadTurnsStore();
const elapsedSeconds = useThreadRuntimeElapsed(toRef(props, "threadId"), toRef(props, "phase"));
const now = ref(Date.now());
let countdownTimer: number | null = null;

const request = computed(() => {
  if (props.hostId === null || props.threadId === null) return undefined;
  return turns.requestForThread(props.hostId, props.threadId);
});
const lastRequest = computed(() => {
  if (props.hostId === null || props.threadId === null) return undefined;
  return turns.lastRequestForThread(props.hostId, props.threadId);
});
const retrySeconds = computed(() => {
  const retryAt = request.value?.retryAt;
  return retryAt === null || retryAt === undefined
    ? null
    : Math.max(1, Math.ceil((retryAt - now.value) / 1_000));
});
const visible = computed(
  () =>
    props.error !== null ||
    props.phase === "submitting" ||
    props.phase === "running" ||
    props.phase === "waitingForApproval" ||
    props.phase === "waitingForInput" ||
    props.phase === "waitingForClient" ||
    props.phase === "retrying" ||
    props.phase === "failed",
);
const active = computed(() =>
  [
    "submitting",
    "running",
    "waitingForApproval",
    "waitingForInput",
    "waitingForClient",
    "retrying",
  ].includes(props.phase),
);
const tone = computed(() => {
  if (props.error !== null && !props.error.transient) return "error";
  if (
    props.phase === "waitingForApproval" ||
    props.phase === "waitingForInput" ||
    props.phase === "waitingForClient" ||
    props.phase === "retrying"
  ) {
    return "warning";
  }
  return "active";
});
const icon = computed(() => {
  if (tone.value === "error") return CircleAlertIcon;
  if (props.phase === "retrying") return RefreshCwIcon;
  if (props.phase === "waitingForApproval") return Clock3Icon;
  if (props.phase === "waitingForInput") return MessageCircleIcon;
  if (props.phase === "waitingForClient") return MonitorIcon;
  return Loader2Icon;
});
const title = computed(() => {
  const categoryTitle: Record<GatewayErrorState["category"], string> = {
    unauthorized: "app.providerUnauthorizedTitle",
    forbidden: "app.providerForbiddenTitle",
    quotaExhausted: "app.providerQuotaExhaustedTitle",
    rateLimited: "app.providerRateLimitedTitle",
    timeout: "app.providerTimeoutTitle",
    unavailable: "app.providerUnavailableTitle",
    requestRejected: "app.providerRequestRejectedTitle",
    protocolError: "app.providerProtocolErrorTitle",
    unknown: "app.threadFailedTitle",
  };
  if (props.phase === "retrying") return t("app.threadRetryingTitle");
  if (props.error !== null && props.error.category !== "unknown") {
    return t(categoryTitle[props.error.category]);
  }
  const phaseTitle: Partial<Record<ThreadRuntimePhase, string>> = {
    submitting: "app.threadSubmittingTitle",
    running: "app.threadRunningTitle",
    waitingForApproval: "app.threadWaitingApprovalTitle",
    waitingForInput: "app.threadWaitingInputTitle",
    waitingForClient: "app.threadWaitingClientTitle",
    retrying: "app.threadRetryingTitle",
    failed: "app.threadFailedTitle",
  };
  return t(phaseTitle[props.phase] ?? "app.threadFailedTitle");
});
const description = computed(() => {
  const categoryDescription: Record<GatewayErrorState["category"], string | null> = {
    unauthorized: "app.providerUnauthorizedDescription",
    forbidden: "app.providerForbiddenDescription",
    quotaExhausted: "app.providerQuotaExhaustedDescription",
    rateLimited: "app.providerRateLimitedDescription",
    timeout: "app.providerTimeoutDescription",
    unavailable: "app.providerUnavailableDescription",
    requestRejected: "app.providerRequestRejectedDescription",
    protocolError: "app.providerProtocolErrorDescription",
    unknown: null,
  };
  const categoryKey = props.error === null ? null : categoryDescription[props.error.category];
  if (props.phase === "retrying") {
    return [t("app.threadRetryingDescription"), categoryKey === null ? null : t(categoryKey)]
      .filter((value): value is string => value !== null)
      .join(" ");
  }
  if (categoryKey !== null) return t(categoryKey);
  const phaseDescription: Partial<Record<ThreadRuntimePhase, string>> = {
    submitting: "app.threadSubmittingDescription",
    running: "app.threadRunningDescription",
    waitingForApproval: "app.threadWaitingApprovalDescription",
    waitingForInput: "app.threadWaitingInputDescription",
    waitingForClient: "app.threadWaitingClientDescription",
    retrying: "app.threadRetryingDescription",
  };
  const phaseKey = phaseDescription[props.phase];
  return phaseKey === undefined ? firstErrorLine(props.error?.message) : t(phaseKey);
});
const retryMeta = computed(() => {
  const retryCount = request.value?.retryCount ?? 0;
  if (retryCount <= 0) return "";
  return t("app.retryAttempt", {
    retryCount,
    attempt: retryCount,
    max: MAX_SERVER_OVERLOADED_RETRIES,
  });
});
const technicalDetails = computed(() => {
  const message = props.error?.message?.trim() ?? "";
  const summary = description.value.trim();
  return [message !== "" && message !== summary ? message : null, props.error?.details, props.error?.code]
    .filter((value, index, values): value is string =>
      Boolean(value && values.indexOf(value) === index),
    )
    .join("\n");
});

watch(
  () => request.value?.retryAt,
  (retryAt) => {
    if (countdownTimer !== null) window.clearInterval(countdownTimer);
    countdownTimer = null;
    now.value = Date.now();
    if (retryAt === null || retryAt === undefined) return;
    countdownTimer = window.setInterval(() => {
      now.value = Date.now();
      if (now.value >= retryAt && countdownTimer !== null) {
        window.clearInterval(countdownTimer);
        countdownTimer = null;
      }
    }, 250);
  },
  { immediate: true },
);

onBeforeUnmount(() => {
  if (countdownTimer !== null) window.clearInterval(countdownTimer);
});

function dismiss() {
  if (props.error !== null) bootstrap.dismissError(props.error.updatedAt);
}

async function retry() {
  dismiss();
  await turns.retryLastTurn();
}

async function stop() {
  if (props.hostId === null || props.threadId === null) return;
  await turns.interruptThreadTurn({
    hostId: props.hostId,
    projectId: props.projectId,
    threadId: props.threadId,
  });
}

function firstErrorLine(message?: string | null) {
  return (
    message
      ?.split("\n")
      .find((line) => line.trim() !== "")
      ?.trim() ?? ""
  );
}
</script>

<template>
  <section
    v-if="visible"
    class="shrink-0 px-2 md:px-[clamp(1rem,3vw,2rem)]"
    data-testid="thread-runtime-notice"
    :data-phase="phase"
    :data-tone="tone"
  >
    <div class="thread-column">
      <div
        class="flex min-w-0 items-start gap-2.5 border-t border-hairline px-1 py-2.5 text-sm"
        :class="{
          'text-destructive': tone === 'error',
          'text-accent-orange-deep': tone === 'warning',
          'text-primary': tone === 'active',
        }"
        :role="tone === 'error' ? 'alert' : 'status'"
      >
        <component
          :is="icon"
          class="mt-0.5 size-4 shrink-0"
          :class="{
            'animate-spin': phase === 'submitting' || phase === 'retrying',
          }"
        />
        <div class="min-w-0 flex-1">
          <div class="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
            <span class="font-medium text-ink" :class="{ 'retry-shimmer': phase === 'retrying' }">
              {{ title }}
            </span>
            <span v-if="retryMeta" class="text-xs tabular-nums text-ink-faint">{{
              retryMeta
            }}</span>
            <span v-if="retrySeconds !== null" class="text-xs tabular-nums text-ink-faint">
              {{ t("app.retryCountdown", { seconds: retrySeconds }) }}
            </span>
            <span
              v-if="active"
              data-testid="thread-runtime-elapsed"
              class="text-xs tabular-nums text-ink-faint"
            >
              {{ t("app.threadRuntimeElapsed", { seconds: elapsedSeconds }) }}
            </span>
          </div>
          <p v-if="description" class="mt-0.5 leading-5 text-ink-muted">{{ description }}</p>
          <details v-if="technicalDetails" class="mt-1 text-xs text-ink-faint">
            <summary class="w-fit cursor-pointer select-none hover:text-ink-secondary">
              {{ t("app.technicalDetails") }}
            </summary>
            <pre
              class="mt-1 max-h-28 overflow-auto whitespace-pre-wrap break-words font-mono leading-5"
              >{{ technicalDetails }}</pre>
          </details>
        </div>
        <div class="flex shrink-0 items-center gap-1">
          <Button
            v-if="error && !error.transient && lastRequest"
            type="button"
            variant="ghost"
            size="sm"
            class="h-7 gap-1.5 px-2 text-xs text-ink-secondary"
            data-testid="retry-last-turn"
            @click="retry"
          >
            <RotateCcwIcon class="size-3.5" />
            {{ t("app.retryRequest") }}
          </Button>
          <Button
            v-if="active && threadId"
            type="button"
            variant="ghost"
            size="icon-sm"
            class="text-ink-muted hover:text-ink"
            :aria-label="t('app.stopCurrentTurn')"
            :title="t('app.stopCurrentTurn')"
            data-testid="stop-runtime-notice"
            @click="stop"
          >
            <SquareIcon class="size-3.5 fill-current" />
          </Button>
          <Button
            v-if="error && !error.transient"
            type="button"
            variant="ghost"
            size="icon-sm"
            class="text-ink-muted hover:text-ink"
            :aria-label="t('app.dismissError')"
            :title="t('app.dismissError')"
            data-testid="dismiss-runtime-error"
            @click="dismiss"
          >
            <XIcon class="size-3.5" />
          </Button>
        </div>
      </div>
    </div>
  </section>
</template>

<style scoped>
.retry-shimmer {
  background: linear-gradient(
    90deg,
    var(--ink-muted) 0%,
    var(--ink-muted) 40%,
    var(--ink) 50%,
    var(--ink-muted) 60%,
    var(--ink-muted) 100%
  );
  background-clip: text;
  background-position: 100% 50%;
  background-size: 200% 100%;
  color: transparent;
  animation: retry-shimmer 1.6s ease-in-out infinite;
}

@keyframes retry-shimmer {
  to {
    background-position: 0 50%;
  }
}

@media (prefers-reduced-motion: reduce) {
  .retry-shimmer {
    animation: none;
    color: var(--ink);
  }
}
</style>
