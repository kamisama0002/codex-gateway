<script setup lang="ts">
import {
  BellIcon,
  BotIcon,
  BracesIcon,
  ContainerIcon,
  PaletteIcon,
  ServerIcon,
  SparklesIcon,
} from "@lucide/vue";
import { computed, ref } from "vue";
import AppearanceSettingsTab from "./AppearanceSettingsTab.vue";
import ConfigSettingsTab from "./ConfigSettingsTab.vue";
import HostSettingsTab from "./HostSettingsTab.vue";
import NotificationSettingsTab from "./NotificationSettingsTab.vue";
import PetSettingsTab from "./PetSettingsTab.vue";
import ProviderSettingsTab from "./ProviderSettingsTab.vue";
import RuntimeSettingsTab from "./RuntimeSettingsTab.vue";

type SettingsPanelKind =
  | "appearance"
  | "pet"
  | "providers"
  | "runtime"
  | "hosts"
  | "notifications"
  | "config";

const emit = defineEmits<{ close: [] }>();
const active = ref<SettingsPanelKind>("appearance");
const panels = [
  { id: "appearance", labelKey: "app.appearanceSettings", icon: PaletteIcon },
  { id: "pet", labelKey: "app.petSettings", icon: SparklesIcon },
  { id: "providers", labelKey: "app.modelProviders", icon: BotIcon },
  { id: "runtime", labelKey: "app.runtimeSettings", icon: ContainerIcon },
  { id: "hosts", labelKey: "app.hosts", icon: ServerIcon },
  { id: "notifications", labelKey: "app.notificationSettings", icon: BellIcon },
  { id: "config", labelKey: "app.configJson", icon: BracesIcon },
] as const satisfies ReadonlyArray<{
  id: SettingsPanelKind;
  labelKey: string;
  icon: typeof PaletteIcon;
}>;
const activeComponent = computed(() => {
  const components = {
    appearance: AppearanceSettingsTab,
    pet: PetSettingsTab,
    providers: ProviderSettingsTab,
    runtime: RuntimeSettingsTab,
    hosts: HostSettingsTab,
    notifications: NotificationSettingsTab,
    config: ConfigSettingsTab,
  } satisfies Record<SettingsPanelKind, object>;
  return components[active.value];
});
</script>

<template>
  <div
    data-testid="settings-panel"
    class="flex min-h-0 flex-1 flex-col overflow-hidden sm:flex-row"
  >
    <nav
      role="tablist"
      :aria-label="$t('app.settings')"
      class="flex shrink-0 gap-1 overflow-x-auto border-b border-hairline bg-canvas-soft p-2 sm:w-44 sm:flex-col sm:overflow-x-visible sm:border-b-0 sm:border-r sm:p-3"
    >
      <button
        v-for="panel in panels"
        :key="panel.id"
        type="button"
        role="tab"
        class="inline-flex h-9 shrink-0 items-center gap-2 rounded-lg px-3 text-sm text-ink-muted transition-colors hover:bg-muted hover:text-ink sm:w-full"
        :class="active === panel.id ? 'bg-muted text-ink' : ''"
        :aria-selected="active === panel.id"
        @click="active = panel.id"
      >
        <component :is="panel.icon" class="size-4 shrink-0" />
        <span>{{ $t(panel.labelKey) }}</span>
      </button>
    </nav>
    <section role="tabpanel" class="min-h-0 min-w-0 flex-1 overflow-y-auto p-5">
      <component :is="activeComponent" @close="emit('close')" />
    </section>
  </div>
</template>
