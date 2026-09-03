import { computed, ref } from "vue";
import { defineStore } from "pinia";
import { toast } from "@codex-gateway/ui/sonner";
import { useGatewayTranslator } from "@/composables/i18n/useGatewayTranslator";
import type { GatewayErrorState } from "@/stores/gateway/types";
import { errorMessageLabels } from "@/stores/gateway/thread-utils/identity";

export const useGatewayBootstrapStore = defineStore("gateway-bootstrap", () => {
  const t = useGatewayTranslator();
  const initializing = ref(true);
  const errors = ref<GatewayErrorState[]>([]);
  const error = computed(() => errors.value.at(-1) ?? null);
  const errorLabels = computed(() => errorMessageLabels(t));

  function clearError(context?: {
    hostId?: number | null;
    projectId?: number | null;
    threadId?: string | null;
  }) {
    if (context === undefined) {
      errors.value = [];
      return;
    }
    errors.value = errors.value.filter((entry) => !sameErrorScope(entry, context));
  }

  function dismissError(updatedAt: number) {
    errors.value = errors.value.filter((entry) => entry.updatedAt !== updatedAt);
  }

  function errorForScope(context: {
    hostId: number | null;
    projectId: number | null;
    threadId: string | null;
  }) {
    return [...errors.value]
      .reverse()
      .find(
        (entry) =>
          (entry.hostId === null || entry.hostId === context.hostId) &&
          (entry.projectId === null || entry.projectId === context.projectId) &&
          (entry.threadId === null || entry.threadId === context.threadId),
      );
  }

  function setError(
    message: string,
    context: {
      hostId?: number | null;
      projectId?: number | null;
      threadId?: string | null;
      turnId?: string | null;
      transient?: boolean;
      category?: GatewayErrorState["category"];
      code?: string | null;
      details?: string | null;
      retryable?: boolean;
      toast?: boolean;
    } = {},
  ) {
    const next: GatewayErrorState = {
      message,
      hostId: context.hostId ?? null,
      projectId: context.projectId ?? null,
      threadId: context.threadId ?? null,
      turnId: "turnId" in context ? (context.turnId ?? null) : null,
      transient: context.transient === true,
      category: context.category ?? "unknown",
      code: context.code ?? null,
      details: context.details ?? null,
      retryable: context.retryable ?? context.transient === true,
      updatedAt: Date.now(),
    };
    errors.value = [...errors.value.filter((entry) => !sameErrorScope(entry, next)), next].slice(
      -50,
    );
    if (import.meta.client && context.toast !== false) toast.error(message);
  }

  function resetState() {
    initializing.value = true;
    errors.value = [];
  }

  return {
    initializing,
    errors,
    error,
    errorLabels,
    t,
    clearError,
    dismissError,
    errorForScope,
    setError,
    resetState,
  };
});

function sameErrorScope(
  left: Pick<GatewayErrorState, "hostId" | "projectId" | "threadId">,
  right: { hostId?: number | null; projectId?: number | null; threadId?: string | null },
) {
  const rightThreadId = right.threadId ?? null;
  if (left.threadId !== null || rightThreadId !== null) {
    return left.hostId === (right.hostId ?? null) && left.threadId === rightThreadId;
  }
  return (
    left.hostId === (right.hostId ?? null) &&
    left.projectId === (right.projectId ?? null) &&
    left.threadId === rightThreadId
  );
}
