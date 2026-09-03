<script setup lang="ts">
import { LogOutIcon } from "@lucide/vue";
import LanguageSwitcher from "@/components/common/LanguageSwitcher.vue";
import { Button } from "@codex-gateway/ui/button";
import { useAuthStore } from "@/stores/auth";

const emit = defineEmits<{ close: [] }>();
const auth = useAuthStore();
const loggingOut = ref(false);

async function logout() {
  if (loggingOut.value) return;
  loggingOut.value = true;
  try {
    await auth.logout();
    emit("close");
  } finally {
    loggingOut.value = false;
  }
}
</script>

<template>
  <div class="mx-auto w-full max-w-3xl">
    <div class="border-b border-hairline pb-4">
      <div class="font-medium">{{ $t("app.appearanceSettings") }}</div>
      <p class="mt-1 text-sm text-ink-secondary">
        {{ $t("app.appearanceSettingsDescription") }}
      </p>
    </div>

    <div class="divide-y divide-hairline">
      <section class="flex items-center justify-between gap-4 py-4">
        <div class="min-w-0">
          <div class="text-sm font-medium">{{ $t("app.interfaceLanguage") }}</div>
          <p class="mt-0.5 text-sm leading-5 text-ink-secondary">
            {{ $t("app.interfaceLanguageDescription") }}
          </p>
        </div>
        <LanguageSwitcher class="shrink-0" />
      </section>

      <section class="flex items-center justify-between gap-4 py-4">
        <div class="min-w-0">
          <div class="text-sm font-medium">{{ $t("app.accountSession") }}</div>
          <p class="mt-0.5 text-sm leading-5 text-ink-secondary">
            {{ $t("app.logoutDescription") }}
          </p>
        </div>
        <Button class="shrink-0" variant="destructive" :disabled="loggingOut" @click="logout">
          <LogOutIcon class="size-4" />
          {{ loggingOut ? $t("app.loggingOut") : $t("app.logout") }}
        </Button>
      </section>
    </div>
  </div>
</template>
