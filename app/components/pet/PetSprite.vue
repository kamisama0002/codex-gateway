<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";
import type { GatewayPetId, GatewayPetStatus } from "~~/shared/types";
import { PET_ANIMATIONS, petSpritesheetUrl, petSpriteStyle } from "@/utils/pets";

const props = withDefaults(
  defineProps<{
    petId: GatewayPetId;
    status?: GatewayPetStatus;
    animated?: boolean;
    label: string;
  }>(),
  { status: "idle", animated: true },
);

const frameOffset = ref(0);
const assetReady = ref(false);
let frameTimer: ReturnType<typeof setTimeout> | null = null;
let assetRequest = 0;

const animation = computed(() => PET_ANIMATIONS[props.status]);
const spriteFrame = computed(
  () => animation.value.frames[frameOffset.value % animation.value.frames.length] ?? 0,
);
const spriteStyle = computed(() => petSpriteStyle(props.petId, spriteFrame.value));

watch(
  () => props.petId,
  () => {
    frameOffset.value = 0;
    loadAsset();
  },
);

watch(
  () => [props.status, props.animated] as const,
  () => {
    frameOffset.value = 0;
    scheduleFrame();
  },
);

onMounted(() => {
  loadAsset();
  scheduleFrame();
});
onBeforeUnmount(clearFrameTimer);

function loadAsset() {
  const request = ++assetRequest;
  assetReady.value = false;
  const image = new Image();
  image.onload = () => {
    if (request === assetRequest) assetReady.value = true;
  };
  image.onerror = () => {
    if (request === assetRequest) assetReady.value = false;
  };
  image.src = petSpritesheetUrl(props.petId);
}

function scheduleFrame() {
  clearFrameTimer();
  if (!props.animated || animation.value.frames.length < 2) return;
  const lastFrame = frameOffset.value === animation.value.frames.length - 1;
  frameTimer = setTimeout(
    () => {
      frameOffset.value = (frameOffset.value + 1) % animation.value.frames.length;
      scheduleFrame();
    },
    lastFrame ? animation.value.finalFrameDurationMs : animation.value.frameDurationMs,
  );
}

function clearFrameTimer() {
  if (frameTimer === null) return;
  clearTimeout(frameTimer);
  frameTimer = null;
}
</script>

<template>
  <span class="block aspect-[12/13] w-16 shrink-0" role="img" :aria-label="label">
    <span v-if="assetReady" class="block size-full bg-no-repeat" :style="spriteStyle" />
    <img
      v-else
      src="/android-chrome-192x192.png"
      alt=""
      class="size-full object-contain opacity-80"
    />
  </span>
</template>
