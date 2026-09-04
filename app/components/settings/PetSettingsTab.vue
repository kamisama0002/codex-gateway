<script setup lang="ts">
import { CheckIcon, Loader2Icon, SparklesIcon } from "@lucide/vue";
import { computed, ref, watch } from "vue";
import type { GatewayPetSettings } from "~~/shared/types";
import { Button } from "@codex-gateway/ui/button";
import { Label } from "@codex-gateway/ui/label";
import { Switch } from "@codex-gateway/ui/switch";
import PetSprite from "@/components/pet/PetSprite.vue";
import { useGatewayConfigStore } from "@/stores/gateway-config";
import { normalizePetSettings } from "@/stores/gateway/config";
import { errorMessageLabels, messageFromError } from "@/stores/gateway/thread-utils/identity";
import { GATEWAY_PET_OPTIONS } from "@/utils/pets";

const store = useGatewayConfigStore();
const { t } = useI18n();
const errorLabels = computed(() => errorMessageLabels(t));
const saving = ref(false);
const error = ref("");
const form = ref<GatewayPetSettings>(normalizePetSettings());

watch(
  () => store.gatewayConfig.pet,
  (settings) => {
    form.value = normalizePetSettings(settings);
  },
  { immediate: true, deep: true },
);

async function saveSettings() {
  saving.value = true;
  error.value = "";
  try {
    await store.savePetSettings(form.value);
  } catch (caught: unknown) {
    error.value = messageFromError(caught, t("app.petSettingsSaveFailed"), errorLabels.value);
  } finally {
    saving.value = false;
  }
}
</script>

<template>
  <div class="max-w-3xl space-y-6">
    <div class="space-y-1">
      <div class="flex items-center gap-2 font-medium">
        <SparklesIcon class="size-4 text-accent-orange" />
        {{ t("app.petSettings") }}
      </div>
      <p class="text-sm text-ink-secondary">{{ t("app.petSettingsDescription") }}</p>
    </div>

    <div class="flex items-center justify-between gap-4 border-b border-hairline pb-4">
      <div>
        <Label for="pet-enabled">{{ t("app.enablePet") }}</Label>
        <p class="text-sm text-ink-secondary">{{ t("app.enablePetDescription") }}</p>
      </div>
      <Switch id="pet-enabled" v-model="form.enabled" data-testid="pet-enabled" />
    </div>

    <fieldset class="space-y-3" :disabled="!form.enabled">
      <legend class="text-sm font-medium text-ink">{{ t("app.choosePet") }}</legend>
      <div class="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <button
          v-for="option in GATEWAY_PET_OPTIONS"
          :key="option.id"
          type="button"
          class="relative flex min-h-28 flex-col items-center justify-center gap-1 rounded-lg border bg-canvas-soft/45 p-2 text-sm transition-colors hover:bg-canvas-soft disabled:opacity-50"
          :class="form.petId === option.id ? 'border-primary bg-primary/5' : 'border-hairline'"
          :aria-pressed="form.petId === option.id"
          :data-testid="`pet-option-${option.id}`"
          @click="form.petId = option.id"
        >
          <CheckIcon
            v-if="form.petId === option.id"
            class="absolute top-2 right-2 size-4 text-primary"
          />
          <PetSprite :pet-id="option.id" status="idle" :animated="false" :label="option.name" />
          <span class="truncate font-medium text-ink">{{ option.name }}</span>
        </button>
      </div>
    </fieldset>

    <div class="flex items-center justify-between gap-4 border-t border-hairline pt-4">
      <div>
        <Label for="pet-animations">{{ t("app.petAnimations") }}</Label>
        <p class="text-sm text-ink-secondary">{{ t("app.petAnimationsDescription") }}</p>
      </div>
      <Switch
        id="pet-animations"
        v-model="form.animations"
        :disabled="!form.enabled"
        data-testid="pet-animations"
      />
    </div>

    <div
      v-if="error"
      class="whitespace-pre-line rounded-md bg-destructive/10 p-3 text-sm text-destructive"
    >
      {{ error }}
    </div>

    <div class="flex justify-end">
      <Button :disabled="saving" data-testid="save-pet-settings" @click="saveSettings">
        <Loader2Icon v-if="saving" class="size-4 animate-spin" />
        {{ t("app.savePetSettings") }}
      </Button>
    </div>
  </div>
</template>
