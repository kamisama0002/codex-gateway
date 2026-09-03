<script setup lang="ts">
import {
  BellDotIcon,
  CheckCircle2Icon,
  CircleAlertIcon,
  CirclePauseIcon,
  Clock3Icon,
  Loader2Icon,
  MessageCircleIcon,
  MonitorIcon,
  RefreshCwIcon,
} from "@lucide/vue";
import { computed } from "vue";
import type { ThreadRuntimePhase } from "@/stores/gateway/types";
import { statusClass, statusLabelKey } from "../sidebar-utils";

const props = defineProps<{
  status: ThreadRuntimePhase;
  completionAttention?: boolean;
}>();

const { t } = useI18n();
const statusIconByStatus = {
  submitting: Loader2Icon,
  running: Loader2Icon,
  waitingForApproval: Clock3Icon,
  waitingForInput: MessageCircleIcon,
  waitingForClient: MonitorIcon,
  retrying: RefreshCwIcon,
  completedUnviewed: BellDotIcon,
  completed: CheckCircle2Icon,
  failed: CircleAlertIcon,
  interrupted: CirclePauseIcon,
} as const;
const displayStatus = computed(() =>
  props.completionAttention ? "completedUnviewed" : props.status,
);
const label = computed(() => t(statusLabelKey(displayStatus.value)));
const icon = computed(
  () => statusIconByStatus[displayStatus.value as keyof typeof statusIconByStatus] ?? null,
);
</script>

<template>
  <span
    class="inline-flex size-4 shrink-0 items-center justify-center"
    :class="statusClass(displayStatus)"
    :aria-label="label"
    :title="label"
  >
    <component
      :is="icon"
      v-if="icon"
      class="size-3.5"
      :class="{
        'animate-spin': status === 'submitting' || status === 'running' || status === 'retrying',
      }"
    />
    <span v-else class="size-2 rounded-full bg-current opacity-50" />
  </span>
</template>
