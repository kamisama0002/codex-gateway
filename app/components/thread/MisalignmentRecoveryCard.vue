<script setup lang="ts">
import { computed, ref } from "vue";
import { AlertTriangleIcon } from "@lucide/vue";
import {
  Confirmation,
  ConfirmationAction,
  ConfirmationActions,
  ConfirmationTitle,
} from "@codex-gateway/ai-elements/confirmation";
import { useGatewayNavigationStore } from "@/stores/gateway-navigation";
import { useGatewayThreadTurnsStore } from "@/stores/gateway-thread-turns";
import { useGatewayTurnRecoveryStore } from "@/stores/gateway-turn-recovery";
import { pinnedKey } from "@/stores/gateway/thread-utils/identity";

const navigation = useGatewayNavigationStore();
const recovery = useGatewayTurnRecoveryStore();
const turns = useGatewayThreadTurnsStore();
const submitting = ref(false);
const request = computed(() => {
  if (navigation.selectedHostId === null || navigation.selectedThreadId === null) return null;
  return (
    recovery.requestsByKey[pinnedKey(navigation.selectedHostId, navigation.selectedThreadId)] ??
    null
  );
});

async function confirmRecovery() {
  const current = request.value;
  if (current?.steer === null || current?.steer === undefined || submitting.value) return;
  submitting.value = true;
  try {
    await turns.sendTurn(current.steer.message);
  } finally {
    submitting.value = false;
  }
}
</script>

<template>
  <Confirmation
    v-if="request"
    :approval="{ id: `misalignment-${request.turnId ?? 'turn'}` }"
    state="approval-requested"
    class="thread-column mb-2 border-destructive/30 bg-destructive/5 text-sm"
  >
    <ConfirmationTitle class="flex items-center gap-2 font-medium text-destructive">
      <AlertTriangleIcon class="size-4" />
      {{ $t("app.misalignmentRecoveryTitle") }}
    </ConfirmationTitle>
    <p v-if="request.detailedExplanation" class="whitespace-pre-wrap text-ink-secondary">
      {{ request.detailedExplanation }}
    </p>
    <p
      v-if="request.steer"
      class="whitespace-pre-wrap rounded-md bg-canvas-soft px-3 py-2 text-ink"
    >
      {{ request.steer.message }}
    </p>
    <ConfirmationActions class="flex-wrap justify-start">
      <ConfirmationAction :disabled="submitting || !request.steer" @click="confirmRecovery">
        {{ $t("app.misalignmentRecoveryConfirm") }}
      </ConfirmationAction>
      <ConfirmationAction
        variant="outline"
        :disabled="submitting"
        @click="recovery.clearRequest(request.hostId, request.threadId)"
      >
        {{ $t("app.dismiss") }}
      </ConfirmationAction>
    </ConfirmationActions>
  </Confirmation>
</template>
