<script setup lang="ts">
import { CircleAlertIcon, Loader2Icon } from "@lucide/vue";

const props = defineProps<{
  phase: "connecting" | "error";
  message?: string;
}>();

const { t } = useI18n();
</script>

<template>
  <main
    data-testid="dataops-auth-state"
    :data-phase="props.phase === 'error' ? 'error' : 'loading'"
    class="flex min-h-dvh items-center justify-center bg-canvas px-6 py-10 text-ink"
  >
    <div class="animate-in fade-in flex max-w-md flex-col items-center text-center duration-200">
      <div
        class="mb-5 flex size-11 items-center justify-center rounded-full bg-canvas-soft text-ink-muted"
      >
        <CircleAlertIcon v-if="props.phase === 'error'" class="size-5 text-destructive" />
        <Loader2Icon v-else class="size-5 animate-spin text-primary" />
      </div>
      <h1 class="text-base font-semibold">
        {{
          props.phase === "error"
            ? t("app.dataOpsAuthFailedTitle")
            : t("app.dataOpsConnectingTitle")
        }}
      </h1>
      <p
        class="mt-2 text-sm leading-6 text-ink-muted"
        :role="props.phase === 'error' ? 'alert' : 'status'"
      >
        {{
          props.message ||
          (props.phase === "error"
            ? t("app.dataOpsAuthFailedDescription")
            : t("app.dataOpsConnectingDescription"))
        }}
      </p>
    </div>
  </main>
</template>
