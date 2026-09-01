<script setup lang="ts">
import { ChevronRightIcon, FolderIcon, FolderOpenIcon, FolderXIcon, PlusIcon, Trash2Icon } from "@lucide/vue";
import type { ProjectRecord } from "~~/shared/types";
import { Button } from "@codex-gateway/ui/button";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
} from "@codex-gateway/ui/context-menu";

const props = defineProps<{
  project: ProjectRecord;
  expanded: boolean;
  selected: boolean;
  missing?: boolean;
  longPressHandlers?: Record<string, unknown>;
}>();

const emit = defineEmits<{
  select: [event: MouseEvent];
  edit: [];
  delete: [];
  startThread: [];
}>();

function selectProject(event: MouseEvent) {
  if (!props.missing) {
    emit("select", event);
  }
}
</script>

<template>
  <ContextMenu>
    <ContextMenuTrigger as-child>
      <Button
        :data-testid="`project-button-${project.id}`"
        v-bind="longPressHandlers"
        variant="ghost"
        class="group/project h-[2.125rem] w-full min-w-0 justify-start gap-1.5 overflow-hidden rounded-lg px-2 text-sm font-normal hover:bg-muted focus-visible:ring-0"
        :class="[
          missing ? 'text-ink-faint' : 'text-ink',
          selected && !missing ? 'bg-muted' : '',
        ]"
        :data-project-missing="missing ? 'true' : 'false'"
        @click="selectProject"
      >
        <FolderXIcon v-if="missing" class="size-4 shrink-0 text-destructive/70" />
        <template v-else>
          <span
            class="hidden size-4 shrink-0 items-center justify-center group-hover/project:inline-flex"
          >
            <ChevronRightIcon
              class="size-3.5 text-ink-faint transition-transform"
              :class="expanded ? 'rotate-90' : ''"
            />
          </span>
          <span
            class="inline-flex size-4 shrink-0 items-center justify-center group-hover/project:hidden"
          >
            <FolderIcon class="size-4 text-ink-muted" />
          </span>
        </template>
        <span class="min-w-0 flex-1 truncate text-left" :title="project.name">
          {{ project.name }}
        </span>
      </Button>
    </ContextMenuTrigger>
    <ContextMenuContent :collision-padding="12" prioritize-position class="w-44">
      <ContextMenuItem @select="emit('edit')">
        <FolderOpenIcon class="mr-2 size-4" />
        {{ $t("app.editProject") }}
      </ContextMenuItem>
      <ContextMenuItem v-if="!missing" @select="emit('startThread')">
        <PlusIcon class="mr-2 size-4" />
        {{ $t("app.newThread") }}
      </ContextMenuItem>
      <ContextMenuItem class="text-destructive focus:text-destructive" @select="emit('delete')">
        <Trash2Icon class="mr-2 size-4" />
        {{ $t("app.deleteProject") }}
      </ContextMenuItem>
    </ContextMenuContent>
  </ContextMenu>
</template>
