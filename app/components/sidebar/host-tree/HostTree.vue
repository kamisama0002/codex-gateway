<script setup lang="ts">
import { FolderPlusIcon, SlidersHorizontalIcon } from "@lucide/vue";
import { toRef } from "vue";
import { Button } from "@codex-gateway/ui/button";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@codex-gateway/ui/dropdown-menu";
import HostTreeNode from "./HostTreeNode.vue";
import { HOST_TREE_CONTROLLER, type HostTreeController } from "./controller";

const props = defineProps<{ controller: HostTreeController }>();
provide(HOST_TREE_CONTROLLER, toRef(props, "controller"));

function addProject() {
  const selected = props.controller.hosts.find(
    (host) => host.id === props.controller.selectedHostId,
  );
  const host = selected ?? props.controller.hosts[0];
  if (host) props.controller.addProject(host);
}

function toggleArchivedFilter() {
  props.controller.setArchivedFilter(!props.controller.archivedFilterActive);
}
</script>

<template>
  <section class="flex min-w-0 max-w-full flex-col overflow-hidden">
    <div class="flex h-8 items-center gap-0.5 px-1">
      <span class="min-w-0 flex-1 truncate px-1 text-sm text-ink-muted">
        {{ $t("app.workspaces") }}
      </span>
      <DropdownMenu>
        <DropdownMenuTrigger as-child>
          <Button
            data-testid="host-tree-menu"
            type="button"
            variant="ghost"
            size="icon-sm"
            class="shrink-0 text-ink-muted hover:text-ink-secondary"
            :aria-label="$t('app.viewOptions')"
          >
            <SlidersHorizontalIcon />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" class="w-44 border-hairline">
          <DropdownMenuLabel class="text-ink-faint">{{ $t("app.groupBy") }}</DropdownMenuLabel>
          <DropdownMenuRadioGroup model-value="workspace">
            <DropdownMenuRadioItem value="workspace">
              {{ $t("app.groupByWorkspace") }}
            </DropdownMenuRadioItem>
          </DropdownMenuRadioGroup>
          <DropdownMenuSeparator />
          <DropdownMenuLabel class="text-ink-faint">{{ $t("app.orderBy") }}</DropdownMenuLabel>
          <DropdownMenuRadioGroup model-value="updated">
            <DropdownMenuRadioItem value="updated">
              {{ $t("app.orderByUpdated") }}
            </DropdownMenuRadioItem>
          </DropdownMenuRadioGroup>
          <DropdownMenuSeparator />
          <DropdownMenuLabel class="text-ink-faint">{{ $t("app.filters") }}</DropdownMenuLabel>
          <DropdownMenuCheckboxItem
            data-testid="archived-threads-toggle"
            :checked="controller.archivedFilterActive"
            @click="toggleArchivedFilter"
          >
            {{ $t("app.archivedThreads") }}
          </DropdownMenuCheckboxItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        class="shrink-0 text-ink-muted hover:text-ink-secondary"
        :disabled="!controller.hosts.length"
        :aria-label="$t('app.addProject')"
        @click="addProject"
      >
        <FolderPlusIcon />
      </Button>
    </div>
    <div class="min-w-0 overflow-hidden">
      <HostTreeNode v-for="host in controller.hosts" :key="host.id" :host="host" />
    </div>
  </section>
</template>
