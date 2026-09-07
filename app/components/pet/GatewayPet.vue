<script setup lang="ts">
import { XIcon } from "@lucide/vue";
import { useResizeObserver } from "@vueuse/core";
import { computed, nextTick, ref, watch } from "vue";
import { Button } from "@codex-gateway/ui/button";
import { toast } from "@codex-gateway/ui/sonner";
import { useAccountLocalStorage } from "@/composables/storage/useAccountLocalStorage";
import { useGatewayConfigStore } from "@/stores/gateway-config";
import { useGatewayPet } from "@/stores/gateway-pet";
import PetSprite from "./PetSprite.vue";

interface PetPosition {
  right: number;
  bottom: number;
}

const DEFAULT_POSITION: PetPosition = { right: 20, bottom: 112 };
const EDGE_INSET = 8;

const { t } = useI18n();
const config = useGatewayConfigStore();
const pet = useGatewayPet();
const dismissing = ref(false);
const boundaryRef = ref<HTMLElement | null>(null);
const petRef = ref<HTMLElement | null>(null);
const savedPosition = useAccountLocalStorage<PetPosition>("pet-position", DEFAULT_POSITION);
const position = ref<PetPosition>(positionFromStorage(savedPosition.value));
const dragging = ref(false);
let drag:
  | {
      pointerId: number;
      startX: number;
      startY: number;
      startPosition: PetPosition;
    }
  | undefined;
const statusLabel = computed(() => t(`app.petStatus.${pet.status.value}`));
const positionStyle = computed(() => ({
  right: `${position.value.right}px`,
  bottom: `${position.value.bottom}px`,
}));

watch(savedPosition, async (stored) => {
  if (dragging.value) return;
  position.value = positionFromStorage(stored);
  await nextTick();
  constrainPosition();
});

useResizeObserver([boundaryRef, petRef], constrainPosition);

async function dismiss() {
  dismissing.value = true;
  try {
    await config.savePetSettings({ ...pet.settings.value, enabled: false });
  } catch {
    toast.error(t("app.petSettingsSaveFailed"));
  } finally {
    dismissing.value = false;
  }
}

function beginDrag(event: PointerEvent) {
  if (event.pointerType === "mouse" && event.button !== 0) return;
  const handle = event.currentTarget;
  if (!(handle instanceof HTMLElement)) return;
  event.preventDefault();
  handle.setPointerCapture(event.pointerId);
  dragging.value = true;
  drag = {
    pointerId: event.pointerId,
    startX: event.clientX,
    startY: event.clientY,
    startPosition: { ...position.value },
  };
}

function moveDrag(event: PointerEvent) {
  if (drag === undefined || drag.pointerId !== event.pointerId) return;
  position.value = constrainedPosition({
    right: drag.startPosition.right - (event.clientX - drag.startX),
    bottom: drag.startPosition.bottom - (event.clientY - drag.startY),
  });
}

function finishDrag(event: PointerEvent) {
  if (drag === undefined || drag.pointerId !== event.pointerId) return;
  const handle = event.currentTarget;
  if (handle instanceof HTMLElement && handle.hasPointerCapture(event.pointerId)) {
    handle.releasePointerCapture(event.pointerId);
  }
  drag = undefined;
  dragging.value = false;
  savedPosition.value = { ...position.value };
}

function constrainPosition() {
  position.value = constrainedPosition(position.value);
  if (!samePosition(savedPosition.value, position.value)) {
    savedPosition.value = { ...position.value };
  }
}

function constrainedPosition(candidate: PetPosition): PetPosition {
  const boundary = boundaryRef.value;
  const element = petRef.value;
  if (boundary === null || element === null) return candidate;
  const maxRight = Math.max(EDGE_INSET, boundary.clientWidth - element.offsetWidth - EDGE_INSET);
  const maxBottom = Math.max(EDGE_INSET, boundary.clientHeight - element.offsetHeight - EDGE_INSET);
  return {
    right: clamp(candidate.right, EDGE_INSET, maxRight),
    bottom: clamp(candidate.bottom, EDGE_INSET, maxBottom),
  };
}

function positionFromStorage(value: unknown): PetPosition {
  if (
    typeof value !== "object" ||
    value === null ||
    !("right" in value) ||
    !("bottom" in value) ||
    typeof value.right !== "number" ||
    typeof value.bottom !== "number" ||
    !Number.isFinite(value.right) ||
    !Number.isFinite(value.bottom) ||
    value.right < 0 ||
    value.bottom < 0
  ) {
    return { ...DEFAULT_POSITION };
  }
  return { right: value.right, bottom: value.bottom };
}

function clamp(value: number, minimum: number, maximum: number) {
  return Math.min(maximum, Math.max(minimum, value));
}

function samePosition(left: PetPosition, right: PetPosition) {
  return left.right === right.right && left.bottom === right.bottom;
}
</script>

<template>
  <div
    v-if="pet.settings.value.enabled"
    ref="boundaryRef"
    class="pointer-events-none fixed inset-0 z-30 overflow-hidden"
  >
    <div
      ref="petRef"
      class="group pointer-events-none absolute hidden flex-col items-end sm:flex"
      data-testid="gateway-pet"
      :data-pet-status="pet.status.value"
      :data-dragging="dragging ? 'true' : 'false'"
      :style="positionStyle"
    >
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        class="pointer-events-auto mb-1 opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100"
        :disabled="dismissing"
        :aria-label="t('app.hidePet')"
        :title="t('app.hidePet')"
        @click="dismiss"
      >
        <XIcon class="size-3.5" />
      </Button>
      <div
        class="pointer-events-auto cursor-grab touch-none select-none active:cursor-grabbing"
        data-testid="gateway-pet-drag-handle"
        @pointerdown="beginDrag"
        @pointermove="moveDrag"
        @pointerup="finishDrag"
        @pointercancel="finishDrag"
        @lostpointercapture="finishDrag"
      >
        <PetSprite
          class="pointer-events-none"
          :pet-id="pet.settings.value.petId"
          :status="pet.status.value"
          :animated="pet.settings.value.animations"
          :label="statusLabel"
        />
      </div>
      <span
        class="mt-1 rounded-full border border-hairline bg-surface/90 px-2 py-1 text-xs font-medium text-ink-secondary shadow-sm backdrop-blur"
      >
        {{ statusLabel }}
      </span>
    </div>
  </div>
</template>
