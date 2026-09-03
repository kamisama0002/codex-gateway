<script setup lang="ts">
import { CheckIcon, ChevronDownIcon } from "@lucide/vue";
import { ref } from "vue";
import type { ModelRecord, ReasoningEffort } from "~~/shared/types";
import {
  ModelSelector,
  ModelSelectorContent,
  ModelSelectorEmpty,
  ModelSelectorGroup,
  ModelSelectorInput,
  ModelSelectorItem,
  ModelSelectorList,
  ModelSelectorSeparator,
  ModelSelectorTrigger,
} from "@codex-gateway/ai-elements/model-selector";
import { Button } from "@codex-gateway/ui/button";

defineProps<{
  models: ModelRecord[];
  loadingModels: boolean;
  activeModel: string;
  activeModelLabel: string;
  activeEffortValue: string;
  activeEffortCompactLabel: string;
  effortOptions: Array<{ value: ReasoningEffort; label?: string }>;
  labelEffortOption: (option: { value: ReasoningEffort; label?: string }) => string;
  modelOptionValue: (modelOption: { model?: string; id: string }) => string;
}>();

const emit = defineEmits<{
  selectModel: [model: string];
  selectEffort: [effort: ReasoningEffort];
}>();

const { t } = useI18n();
const selectorOpen = ref(false);

function selectModel(model: string) {
  emit("selectModel", model);
}

function selectEffort(effort: ReasoningEffort) {
  emit("selectEffort", effort);
}

function preventInitialFocus(event: Event) {
  // Reka Dialog otherwise focuses the first tabbable element while CommandInput also requests
  // autofocus. Preventing both paths keeps mobile keyboards closed until the user taps search.
  event.preventDefault();
}
</script>

<template>
  <ModelSelector v-model:open="selectorOpen">
    <ModelSelectorTrigger as-child>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        class="min-w-0 max-w-full gap-1 px-2 text-sm font-medium text-ink-secondary hover:bg-muted sm:px-2"
        data-testid="model-select"
        :disabled="loadingModels || !models.length"
      >
        <span class="flex min-w-0 items-center gap-1.5 sm:hidden">
          <span class="truncate text-ink">{{
            loadingModels ? t("app.loadingModels") : activeModelLabel
          }}</span>
          <span v-if="activeEffortCompactLabel" class="shrink-0 text-ink-muted">
            {{ activeEffortCompactLabel }}
          </span>
        </span>
        <span class="hidden truncate text-ink sm:inline">{{
          loadingModels ? t("app.loadingModels") : activeModelLabel
        }}</span>
        <span v-if="activeEffortCompactLabel" class="hidden shrink-0 text-ink-muted sm:inline">
          {{ activeEffortCompactLabel }}
        </span>
        <ChevronDownIcon class="size-3.5 text-ink-muted" />
      </Button>
    </ModelSelectorTrigger>
    <ModelSelectorContent
      :title="t('app.model')"
      class="w-[min(92vw,32rem)] overflow-hidden rounded-xl border-hairline shadow-sm"
      close-button-test-id="model-selector-close"
      data-testid="model-selector-dialog"
      @open-auto-focus="preventInitialFocus"
    >
      <ModelSelectorInput :auto-focus="false" :placeholder="t('app.searchModels')" />
      <ModelSelectorList class="max-h-[min(60dvh,28rem)] p-1">
        <ModelSelectorEmpty>{{ t("app.noMatchingModels") }}</ModelSelectorEmpty>
        <ModelSelectorGroup :heading="t('app.reasoningEffort')">
          <ModelSelectorItem
            v-for="option in effortOptions"
            :key="option.value"
            :value="`effort:${option.value}`"
            class="min-h-8 rounded-md px-2.5 text-sm text-ink"
            @select="selectEffort(option.value)"
          >
            <span>{{ labelEffortOption(option) }}</span>
            <CheckIcon
              v-if="option.value === activeEffortValue"
              class="ml-auto size-4 text-primary"
            />
          </ModelSelectorItem>
        </ModelSelectorGroup>
        <ModelSelectorSeparator class="my-1" />
        <ModelSelectorGroup :heading="t('app.model')">
          <ModelSelectorItem
            v-for="modelOption in models"
            :key="modelOption.id"
            :value="`model:${modelOptionValue(modelOption)}`"
            :data-testid="`model-option-${modelOptionValue(modelOption)}`"
            class="min-h-8 rounded-md px-2.5 text-sm text-ink"
            @select="selectModel(modelOptionValue(modelOption))"
          >
            <span class="truncate">{{
              modelOption.displayName || modelOption.model || modelOption.id
            }}</span>
            <CheckIcon
              v-if="modelOptionValue(modelOption) === activeModel"
              class="ml-auto size-4 text-primary"
            />
          </ModelSelectorItem>
        </ModelSelectorGroup>
      </ModelSelectorList>
    </ModelSelectorContent>
  </ModelSelector>
</template>
