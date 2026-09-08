<script setup lang="ts">
import {
  CheckIcon,
  ChevronDownIcon,
  HandIcon,
  SettingsIcon,
  ShieldAlertIcon,
  ShieldCheckIcon,
} from "@lucide/vue";
import { computed, type Component } from "vue";
import type { ApprovalPolicy } from "~~/shared/types";
import { Button } from "@codex-gateway/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@codex-gateway/ui/popover";

const props = defineProps<{
  modelValue: ApprovalPolicy | "custom";
  disabled: boolean;
}>();

const emit = defineEmits<{
  "update:modelValue": [value: ApprovalPolicy | "custom"];
}>();

const { t } = useI18n();
const approvalOptions: Array<{
  value: ApprovalPolicy | "custom";
  icon: Component;
  labelKey: string;
  shortLabelKey: string;
  descriptionKey: string;
}> = [
  {
    value: "untrusted",
    icon: HandIcon,
    labelKey: "approvalAsk",
    shortLabelKey: "approvalAskShort",
    descriptionKey: "approvalAskDescription",
  },
  {
    value: "on-request",
    icon: ShieldCheckIcon,
    labelKey: "approvalAuto",
    shortLabelKey: "approvalAutoShort",
    descriptionKey: "approvalAutoDescription",
  },
  {
    value: "never",
    icon: ShieldAlertIcon,
    labelKey: "approvalFullAccess",
    shortLabelKey: "approvalFullAccessShort",
    descriptionKey: "approvalFullAccessDescription",
  },
  {
    value: "custom",
    icon: SettingsIcon,
    labelKey: "approvalCustom",
    shortLabelKey: "approvalCustomShort",
    descriptionKey: "approvalCustomDescription",
  },
];
const activeApprovalOption = computed(
  () =>
    approvalOptions.find((option) => option.value === props.modelValue) ?? approvalOptions.at(-1)!,
);
</script>

<template>
  <Popover>
    <PopoverTrigger as-child>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        class="h-7 shrink-0 gap-1 px-2 text-sm font-medium text-ink-muted hover:bg-muted hover:text-ink-secondary"
        :disabled="disabled"
      >
        <SettingsIcon class="size-3.5" />
        <span class="max-w-20 truncate sm:max-w-none">{{
          t(`app.${activeApprovalOption.shortLabelKey}`)
        }}</span>
        <ChevronDownIcon class="size-3.5" />
      </Button>
    </PopoverTrigger>
    <PopoverContent
      align="start"
      class="w-[min(92vw,theme(maxWidth.xl))] gap-1 rounded-xl border-hairline p-1.5 shadow-sm"
    >
      <button
        v-for="option in approvalOptions"
        :key="option.value"
        type="button"
        class="grid w-full grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3 rounded-lg px-2.5 py-2 text-left hover:bg-canvas-soft"
        :class="option.value === modelValue ? 'bg-canvas-soft' : ''"
        :disabled="disabled"
        @click="!disabled && emit('update:modelValue', option.value)"
      >
        <component :is="option.icon" class="size-4 text-ink-muted" />
        <span class="min-w-0">
          <span class="block text-sm leading-5 text-ink">{{ t(`app.${option.labelKey}`) }}</span>
          <span class="block truncate text-xs leading-5 text-ink-muted">{{
            t(`app.${option.descriptionKey}`)
          }}</span>
        </span>
        <CheckIcon v-if="option.value === modelValue" class="size-4 text-primary" />
      </button>
    </PopoverContent>
  </Popover>
</template>
