<script setup lang="ts">
import { ArchiveIcon, ArchiveRestoreIcon, EllipsisIcon, StarIcon, Trash2Icon } from "@lucide/vue";
import { computed, ref } from "vue";
import { Button } from "@codex-gateway/ui/button";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@codex-gateway/ui/context-menu";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@codex-gateway/ui/dropdown-menu";
import type { ThreadRuntimePhase } from "@/stores/gateway/types";
import { threadTitleFallbacks, titleForThread } from "@/stores/gateway/thread-utils/identity";
import { selectedRowClass } from "../sidebar-utils";
import SidebarRowLabel from "../SidebarRowLabel.vue";
import ThreadStatusIndicator from "./ThreadStatusIndicator.vue";
import type { SidebarThreadRow } from "../sidebar-types";
import type { ThreadHistoryState } from "~~/shared/types";

const props = defineProps<{
  thread: SidebarThreadRow;
  testId: string;
  selected: boolean;
  status: ThreadRuntimePhase;
  completionAttention?: boolean;
  subtitle?: string;
  pinLabel: string;
  showPinnedIcon?: boolean;
  archived?: boolean;
  compact?: boolean;
  longPressHandlers?: Record<string, unknown>;
  history?: ThreadHistoryState | null;
}>();
const { t } = useI18n();

const emit = defineEmits<{
  open: [];
  togglePin: [];
  rename: [];
  archive: [];
  unarchive: [];
  delete: [];
}>();

const pressHandlers = computed(() => props.longPressHandlers ?? {});
const compactMenuOpen = ref(false);
const showStatus = computed(() => props.status !== "idle" || Boolean(props.completionAttention));
const threadTitle = computed(() =>
  titleForThread(props.thread, threadTitleFallbacks(t), props.history),
);

function onCompactMenuSelect(action: "togglePin" | "rename" | "archive" | "unarchive" | "delete") {
  compactMenuOpen.value = false;
  if (action === "togglePin") emit("togglePin");
  else if (action === "rename") emit("rename");
  else if (action === "archive") emit("archive");
  else if (action === "unarchive") emit("unarchive");
  else emit("delete");
}
</script>

<template>
  <ContextMenu>
    <ContextMenuTrigger as-child>
      <Button
        :data-testid="testId"
        v-bind="pressHandlers"
        :data-selected="selected ? 'true' : 'false'"
        :data-archived="archived ? 'true' : 'false'"
        variant="ghost"
        class="session-row group/session w-full min-w-0 justify-start overflow-hidden font-normal focus-visible:ring-0"
        :class="[
          compact
            ? 'h-8 min-h-8 rounded-lg px-2 py-0 text-sm hover:bg-muted'
            : 'h-auto min-h-8 rounded-lg px-2.5 py-1.5 text-sm hover:bg-muted',
          compact && (selected || compactMenuOpen)
            ? 'bg-muted text-ink hover:bg-muted'
            : selectedRowClass(selected),
          archived ? 'text-ink-muted' : '',
        ]"
        @click="emit('open')"
      >
        <span v-if="compact" class="flex min-w-0 flex-1 items-center overflow-hidden text-left">
          <span class="inline-flex size-4 shrink-0 items-center justify-center">
            <ThreadStatusIndicator
              v-if="showStatus"
              :status="status"
              :completion-attention="completionAttention"
            />
            <StarIcon
              v-else-if="showPinnedIcon"
              class="size-3 shrink-0 fill-current text-accent-orange"
            />
          </span>
          <span class="ml-1 min-w-0 flex-1 truncate text-sm leading-5" :title="threadTitle">
            {{ threadTitle }}
          </span>
          <span
            v-if="subtitle"
            class="ml-1.5 shrink-0 tabular-nums text-xs leading-5 text-ink-faint group-hover/session:hidden"
            :class="compactMenuOpen ? 'hidden' : ''"
          >
            {{ subtitle }}
          </span>
          <span
            class="ml-1.5 hidden shrink-0 items-center group-hover/session:inline-flex"
            :class="compactMenuOpen ? '!inline-flex' : ''"
            @click.stop
          >
            <DropdownMenu v-model:open="compactMenuOpen">
              <DropdownMenuTrigger as-child>
                <span
                  role="button"
                  class="inline-flex size-4 items-center justify-center text-ink-faint hover:text-ink"
                  :aria-label="$t('app.threadRowActions')"
                  @click.stop
                >
                  <EllipsisIcon class="size-4" />
                </span>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" class="w-44 border-hairline" @click.stop>
                <template v-if="archived">
                  <DropdownMenuItem @select="onCompactMenuSelect('unarchive')">
                    <ArchiveRestoreIcon class="mr-2 size-4" />
                    {{ $t("app.unarchiveThread") }}
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem
                    class="text-destructive focus:text-destructive"
                    @select="onCompactMenuSelect('delete')"
                  >
                    <Trash2Icon class="mr-2 size-4" />
                    {{ $t("app.deleteThread") }}
                  </DropdownMenuItem>
                </template>
                <template v-else>
                  <DropdownMenuItem @select="onCompactMenuSelect('togglePin')">
                    {{ pinLabel }}
                  </DropdownMenuItem>
                  <DropdownMenuItem @select="onCompactMenuSelect('rename')">
                    {{ $t("app.renameThread") }}
                  </DropdownMenuItem>
                  <DropdownMenuItem @select="onCompactMenuSelect('archive')">
                    <ArchiveIcon class="mr-2 size-4" />
                    {{ $t("app.archiveThread") }}
                  </DropdownMenuItem>
                </template>
              </DropdownMenuContent>
            </DropdownMenu>
          </span>
        </span>
        <SidebarRowLabel v-else :title="threadTitle" :subtitle="subtitle">
          <template #title-prefix>
            <StarIcon
              v-if="showPinnedIcon"
              class="size-3.5 shrink-0 fill-current text-accent-orange"
            />
          </template>
          <template #trailing>
            <ThreadStatusIndicator :status="status" :completion-attention="completionAttention" />
          </template>
        </SidebarRowLabel>
      </Button>
    </ContextMenuTrigger>
    <ContextMenuContent :collision-padding="12" prioritize-position class="w-44">
      <template v-if="archived">
        <ContextMenuItem @select="emit('unarchive')">
          <ArchiveRestoreIcon class="mr-2 size-4" />
          {{ $t("app.unarchiveThread") }}
        </ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem class="text-destructive focus:text-destructive" @select="emit('delete')">
          <Trash2Icon class="mr-2 size-4" />
          {{ $t("app.deleteThread") }}
        </ContextMenuItem>
      </template>
      <template v-else>
        <ContextMenuItem @select="emit('togglePin')">
          {{ pinLabel }}
        </ContextMenuItem>
        <ContextMenuItem @select="emit('rename')">
          {{ $t("app.renameThread") }}
        </ContextMenuItem>
        <ContextMenuItem @select="emit('archive')">
          <ArchiveIcon class="mr-2 size-4" />
          {{ $t("app.archiveThread") }}
        </ContextMenuItem>
      </template>
    </ContextMenuContent>
  </ContextMenu>
</template>

<style scoped>
.session-row {
  animation: session-row-in 150ms ease-out;
}

@keyframes session-row-in {
  from {
    opacity: 0;
  }
}

@media (prefers-reduced-motion: reduce) {
  .session-row {
    animation: none;
  }
}
</style>
