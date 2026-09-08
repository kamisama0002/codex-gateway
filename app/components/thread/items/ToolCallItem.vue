<script setup lang="ts">
import type { ThreadHistoryItem } from "~~/shared/types";
import { ChevronDownIcon, ChevronRightIcon, ImageIcon, SearchIcon, WrenchIcon } from "@lucide/vue";
import { computed } from "vue";
import { Source, Sources } from "@codex-gateway/ai-elements/sources";
import { Collapsible, CollapsibleTrigger } from "@codex-gateway/ui/collapsible";
import { ScrollArea } from "@codex-gateway/ui/scroll-area";
import DeferredCollapsibleContent from "@/components/common/DeferredCollapsibleContent.vue";
import StateDot from "@/components/common/StateDot.vue";
import MarkdownContent from "@/components/common/MarkdownContent.vue";
import StaticJsonCodeBlock from "@/components/common/StaticJsonCodeBlock.vue";
import { isItemInProgress } from "@/utils/thread-items";
import { presentToolCall } from "./tool-call-presenters";

const props = defineProps<{
  item: ThreadHistoryItem;
}>();
const { t } = useI18n();
const presentation = computed(() => presentToolCall(props.item, t));
const title = computed(() => presentation.value.title);
const iconType = computed(() => presentation.value.icon);
const detailSections = computed(() => presentation.value.details);
const status = computed(() =>
  typeof props.item.status === "string" ? props.item.status : props.item.status?.type,
);
const visualStatus = computed<"running" | "completed" | "failed" | null>(() => {
  if (isItemInProgress(props.item)) return "running";
  if (props.item.success === false || status.value === "failed" || status.value === "interrupted") {
    return "failed";
  }
  if (props.item.success === true || status.value === "completed") return "completed";
  return null;
});
</script>

<template>
  <Collapsible v-slot="{ open }" class="max-w-4xl text-ink-muted">
    <CollapsibleTrigger
      class="timeline-process-row flex w-full items-center gap-2 rounded-md px-1 py-1 text-left text-sm enabled:hover:bg-canvas-soft disabled:cursor-default"
      :data-state="visualStatus === 'running' ? 'running' : undefined"
      :disabled="detailSections.length === 0"
      :title="detailSections.length > 0 ? t('app.toolDetails') : undefined"
      data-testid="tool-call-toggle"
    >
      <SearchIcon v-if="iconType === 'search'" class="size-4" />
      <ImageIcon v-else-if="iconType === 'image'" class="size-4" />
      <WrenchIcon v-else class="size-4" />
      <span class="min-w-0 flex-1 truncate">{{ title }}</span>
      <span v-if="visualStatus === 'running'" role="img" :aria-label="t('app.running')">
        <StateDot state="ongoing" />
      </span>
      <span v-else-if="visualStatus === 'completed'" role="img" :aria-label="t('app.completed')">
        <StateDot state="done" />
      </span>
      <span v-else-if="visualStatus === 'failed'" role="img" :aria-label="t('app.failed')">
        <StateDot state="error" />
      </span>
      <ChevronDownIcon
        v-if="detailSections.length > 0 && open"
        class="size-4 shrink-0 text-ink-faint"
      />
      <ChevronRightIcon
        v-else-if="detailSections.length > 0"
        class="size-4 shrink-0 text-ink-faint"
      />
    </CollapsibleTrigger>
    <DeferredCollapsibleContent :open="open">
      <div class="ml-6 mt-1 space-y-3 border-l border-hairline py-2 pl-3">
        <div v-for="section in detailSections" :key="section.label" class="space-y-1">
          <div class="text-xs font-medium uppercase text-ink-faint">{{ section.label }}</div>
          <MarkdownContent v-if="section.kind === 'markdown'" :content="section.content" compact />
          <Sources v-else-if="section.kind === 'links'" class="mb-0 w-full space-y-2 text-sm">
            <Source
              v-for="link in section.links"
              :key="link.url"
              :href="link.url"
              :title="link.title"
              class="min-w-0 items-start rounded-md px-2 py-1.5 text-ink hover:bg-canvas-soft"
            >
              <SearchIcon class="mt-0.5 size-4 shrink-0 text-ink-faint" />
              <span class="min-w-0 flex-1">
                <span
                  class="block truncate font-medium underline decoration-hairline underline-offset-4"
                >
                  {{ link.title }}
                </span>
                <span v-if="link.snippet" class="mt-1 line-clamp-2 text-xs text-ink-muted">
                  {{ link.snippet }}
                </span>
              </span>
            </Source>
          </Sources>
          <StaticJsonCodeBlock
            v-else-if="section.kind === 'json'"
            :value="section.value"
            max-height="default"
          />
          <ScrollArea v-else class="h-56 rounded-md bg-canvas-soft">
            <pre class="p-3 text-xs leading-5 text-ink-secondary">{{ section.content }}</pre>
          </ScrollArea>
        </div>
      </div>
    </DeferredCollapsibleContent>
  </Collapsible>
</template>
