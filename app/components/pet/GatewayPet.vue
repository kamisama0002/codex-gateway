<script setup lang="ts">
import { XIcon } from "@lucide/vue";
import { computed, ref } from "vue";
import { Button } from "@codex-gateway/ui/button";
import { toast } from "@codex-gateway/ui/sonner";
import { useGatewayConfigStore } from "@/stores/gateway-config";
import { useGatewayPet } from "@/stores/gateway-pet";
import PetSprite from "./PetSprite.vue";

const { t } = useI18n();
const config = useGatewayConfigStore();
const pet = useGatewayPet();
const dismissing = ref(false);
const statusLabel = computed(() => t(`app.petStatus.${pet.status.value}`));

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
</script>

<template>
  <div
    v-if="pet.settings.value.enabled"
    class="pointer-events-none absolute inset-0 z-30 overflow-hidden"
  >
    <div
      class="group pointer-events-auto absolute right-5 bottom-28 hidden flex-col items-end sm:flex"
      data-testid="gateway-pet"
      :data-pet-status="pet.status.value"
    >
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        class="mb-1 opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100"
        :disabled="dismissing"
        :aria-label="t('app.hidePet')"
        :title="t('app.hidePet')"
        @click="dismiss"
      >
        <XIcon class="size-3.5" />
      </Button>
      <PetSprite
        :pet-id="pet.settings.value.petId"
        :status="pet.status.value"
        :animated="pet.settings.value.animations"
        :label="statusLabel"
      />
      <span
        class="mt-1 rounded-full border border-hairline bg-surface/90 px-2 py-1 text-xs font-medium text-ink-secondary shadow-sm backdrop-blur"
      >
        {{ statusLabel }}
      </span>
    </div>
  </div>
</template>
