<script setup lang="ts">
import { computed } from "vue";
import type { ThreadRuntimePhase } from "@/stores/gateway/types";
import StateDot from "@/components/common/StateDot.vue";
import { statusLabelKey } from "../sidebar-utils";

type StateDotState = "done" | "warning" | "ongoing" | "error";

const props = defineProps<{
  status: ThreadRuntimePhase;
  completionAttention?: boolean;
}>();

const { t } = useI18n();
const stateByStatus: Partial<Record<ThreadRuntimePhase | "completedUnviewed", StateDotState>> = {
  submitting: "ongoing",
  running: "ongoing",
  waitingForApproval: "warning",
  waitingForInput: "warning",
  waitingForClient: "warning",
  retrying: "ongoing",
  completedUnviewed: "done",
  completed: "done",
  failed: "error",
  interrupted: "warning",
};
const displayStatus = computed(() => {
  if (props.status !== "idle" && props.status !== "completed") return props.status;
  return props.completionAttention ? "completedUnviewed" : props.status;
});
const label = computed(() => t(statusLabelKey(displayStatus.value)));
const state = computed(() => stateByStatus[displayStatus.value] ?? null);
</script>

<template>
  <span
    class="inline-flex size-4 shrink-0 items-center justify-center"
    :aria-label="label"
    :title="label"
  >
    <StateDot v-if="state" :state="state" />
    <span v-else class="size-2 rounded-full bg-ink-faint opacity-50" aria-hidden="true" />
  </span>
</template>
