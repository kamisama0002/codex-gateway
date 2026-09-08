<script setup lang="ts">
import { computed, ref, watch } from "vue";
import {
  ArrowDownIcon,
  ArrowUpIcon,
  CheckIcon,
  ChevronDownIcon,
  PencilIcon,
  PlayIcon,
  ListTodoIcon,
  SendIcon,
  Trash2Icon,
  XIcon,
} from "@lucide/vue";
import type { QueuedSubmission } from "~~/shared/types";
import { TooltipProvider } from "@codex-gateway/ui/tooltip";
import ComposerQueueAction from "@/components/chat/composer/ComposerQueueAction.vue";
import {
  editableQueuedText,
  queueDockKind,
  queuedSubmissionPreview,
} from "@/components/chat/composer/queue-presentation";

const props = defineProps<{
  items: QueuedSubmission[];
  running: boolean;
  pendingId: string | null;
  hostId: number | null;
}>();

const emit = defineEmits<{
  edit: [id: string, text: string];
  remove: [id: string];
  move: [id: string, direction: "up" | "down"];
  sendNow: [id: string];
}>();

const { t } = useI18n();
const collapsed = ref(true);
const editing = ref<{ id: string; text: string } | null>(null);
const dockKind = computed(() => queueDockKind(props.items.length));
const expanded = computed(
  () => props.items.length <= 1 || !collapsed.value || editing.value !== null,
);

watch(
  () => props.items,
  (items) => {
    if (editing.value !== null && !items.some((item) => item.id === editing.value?.id)) {
      editing.value = null;
    }
    if (items.length === 0) collapsed.value = true;
  },
  { deep: true },
);

function beginEdit(item: QueuedSubmission) {
  const text = editableQueuedText(item);
  if (text !== null) editing.value = { id: item.id, text };
}

function saveEdit() {
  const value = editing.value;
  if (value === null || value.text.trim() === "") return;
  emit("edit", value.id, value.text.trim());
  editing.value = null;
}

function images(item: QueuedSubmission) {
  return item.input.filter((part) => part.type === "image" || part.type === "localImage");
}

function imageSource(part: Record<string, unknown>) {
  if (part.type === "image" && typeof part.url === "string") return part.url;
  if (part.type !== "localImage" || typeof part.path !== "string" || props.hostId === null) {
    return "";
  }
  const query = new URLSearchParams({ hostId: String(props.hostId), path: part.path });
  return `/api/remote/images?${query.toString()}`;
}
</script>

<template>
  <div
    v-if="dockKind !== 'empty'"
    data-testid="composer-queue-dock"
    class="relative z-10 -mb-1 px-3"
  >
    <div class="overflow-hidden rounded-t-lg border border-b-0 border-hairline bg-muted/70 py-1">
      <button
        v-if="dockKind === 'multiple'"
        type="button"
        class="flex h-9 w-full items-center gap-2 px-3 text-left text-sm text-ink-secondary hover:text-ink"
        :aria-expanded="expanded"
        @click="collapsed = !collapsed"
      >
        <ListTodoIcon class="size-4 shrink-0 text-ink-muted" />
        <span class="min-w-0 flex-1 truncate font-medium">{{
          t("app.queueCount", { count: items.length })
        }}</span>
        <ChevronDownIcon
          class="size-4 shrink-0 text-ink-faint transition-transform"
          :class="expanded ? 'rotate-0' : '-rotate-90'"
        />
      </button>
      <ul v-show="expanded" class="max-h-44 overflow-y-auto">
        <li
          v-for="(item, index) in items"
          :key="item.id"
          class="flex min-h-9 items-center gap-2 px-2.5 py-1 text-sm not-first:border-t not-first:border-hairline"
          :data-testid="`queued-message-${item.id}`"
        >
          <ListTodoIcon v-if="dockKind === 'single'" class="size-4 shrink-0 text-ink-muted" />
          <span v-if="images(item).length" class="flex shrink-0 gap-1">
            <img
              v-for="(image, imageIndex) in images(item)"
              :key="`${item.id}-${imageIndex}`"
              :src="imageSource(image)"
              :alt="t('app.queuedImage')"
              class="size-6 rounded border border-hairline object-cover"
            />
          </span>
          <input
            v-if="editing?.id === item.id"
            v-model="editing.text"
            :aria-label="t('app.editQueuedMessage')"
            class="h-7 min-w-0 flex-1 rounded-md border border-hairline bg-surface px-2 outline-none focus:border-primary"
            autofocus
            @keydown.enter.prevent="saveEdit"
            @keydown.esc="editing = null"
          />
          <span v-else class="min-w-0 flex-1 truncate text-ink-secondary">
            {{ queuedSubmissionPreview(item, t("app.queuedAttachment")) }}
          </span>
          <TooltipProvider :delay-duration="300">
            <div class="flex shrink-0 items-center gap-0.5">
              <template v-if="editing?.id === item.id">
                <ComposerQueueAction
                  :label="t('app.saveQueuedMessage')"
                  :disabled="pendingId !== null || editing.text.trim() === ''"
                  @click="saveEdit"
                >
                  <CheckIcon class="size-3.5" />
                </ComposerQueueAction>
                <ComposerQueueAction
                  :label="t('app.cancelQueuedMessageEdit')"
                  :disabled="pendingId !== null"
                  @click="editing = null"
                >
                  <XIcon class="size-3.5" />
                </ComposerQueueAction>
              </template>
              <template v-else>
                <ComposerQueueAction
                  :label="t('app.editQueuedMessage')"
                  :disabled="pendingId !== null || editableQueuedText(item) === null"
                  @click="beginEdit(item)"
                >
                  <PencilIcon class="size-3.5" />
                </ComposerQueueAction>
                <ComposerQueueAction
                  v-if="items.length > 1"
                  :label="t('app.moveQueuedMessageUp')"
                  :disabled="pendingId !== null || index === 0"
                  @click="emit('move', item.id, 'up')"
                >
                  <ArrowUpIcon class="size-3.5" />
                </ComposerQueueAction>
                <ComposerQueueAction
                  v-if="items.length > 1"
                  :label="t('app.moveQueuedMessageDown')"
                  :disabled="pendingId !== null || index === items.length - 1"
                  @click="emit('move', item.id, 'down')"
                >
                  <ArrowDownIcon class="size-3.5" />
                </ComposerQueueAction>
                <ComposerQueueAction
                  :label="running ? t('app.steerQueuedMessage') : t('app.startQueuedMessage')"
                  :disabled="pendingId !== null"
                  @click="emit('sendNow', item.id)"
                >
                  <SendIcon v-if="running" class="size-3.5" />
                  <PlayIcon v-else class="size-3.5" />
                </ComposerQueueAction>
                <ComposerQueueAction
                  :label="t('app.deleteQueuedMessage')"
                  :disabled="pendingId !== null"
                  @click="emit('remove', item.id)"
                >
                  <Trash2Icon class="size-3.5" />
                </ComposerQueueAction>
              </template>
            </div>
          </TooltipProvider>
        </li>
      </ul>
    </div>
  </div>
</template>
