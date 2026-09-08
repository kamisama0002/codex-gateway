<script setup lang="ts">
import { computed } from "vue";
import { CheckIcon, CopyIcon } from "@lucide/vue";
import { useClipboard } from "@vueuse/core";
import { Message, MessageAction, MessageContent } from "@codex-gateway/ai-elements/message";
import { Badge } from "@codex-gateway/ui/badge";
import { toast } from "@codex-gateway/ui/sonner";
import MarkdownContent from "@/components/common/MarkdownContent.vue";
import ThreadImageAttachment from "@/components/thread/attachments/ThreadImageAttachment.vue";
import MessageTimeLabel from "@/components/thread/MessageTimeLabel.vue";
import { threadItemText } from "@/utils/thread-items";
import { copyMessageText } from "@/utils/message-copy";
import type { ThreadHistoryItem } from "~~/shared/types";
import { recordFromUnknown } from "~~/shared/utils/records";

const props = defineProps<{
  item: ThreadHistoryItem;
  hostId: number | null;
  variant?: "normal" | "steer";
  messageTimeMs?: number | null;
}>();

const { t } = useI18n();
const text = computed(() => threadItemText(props.item));
const { copy, copied, isSupported } = useClipboard({
  source: text,
  copiedDuring: 1200,
  legacy: true,
});
type ImagePart = Record<string, unknown> & { type: "image" | "localImage" };

async function copyText() {
  const success = await copyMessageText(text.value, isSupported.value, (value) => copy(value));
  if (success) {
    toast.success(t("app.userMessageCopied"));
  } else {
    toast.error(t("app.copyUserMessageFailed"));
  }
}

function isImagePart(part: Record<string, unknown> | null): part is ImagePart {
  return part?.type === "image" || part?.type === "localImage";
}

const imageParts = computed(() => {
  if (!Array.isArray(props.item.content)) {
    return [];
  }
  return props.item.content
    .map(recordFromUnknown)
    .filter(isImagePart)
    .map((part, index: number) => ({
      id: `${props.item.id || props.item.clientId || "image"}-${index}`,
      type: part.type,
      url: typeof part.url === "string" ? part.url : "",
      path: typeof part.path === "string" ? part.path : "",
      detail: typeof part.detail === "string" ? part.detail : null,
    }));
});

function imageSource(image: { type: string; url: string; path: string }) {
  if (image.type === "image") {
    return image.url;
  }
  if (image.type === "localImage" && props.hostId && image.path) {
    const query = new URLSearchParams({
      hostId: String(props.hostId),
      path: image.path,
    });
    return `/api/remote/images?${query.toString()}`;
  }
  return "";
}
</script>

<template>
  <Message from="user" class="min-w-0 max-w-full">
    <div class="flex min-w-0 max-w-full flex-col items-end gap-1.5">
      <MessageContent
        :data-testid="variant === 'steer' ? 'steered-conversation-item' : undefined"
        :class="[
          'thread-user-message min-w-0 max-w-full space-y-2 px-3 py-2 text-sm leading-6 text-ink group-[.is-user]:py-2 group-[.is-user]:text-ink md:max-w-2xl md:px-3.5 md:group-[.is-user]:px-3.5',
          variant === 'steer'
            ? 'rounded-lg border border-primary/20 bg-primary/5 group-[.is-user]:rounded-lg group-[.is-user]:border group-[.is-user]:border-primary/20 group-[.is-user]:bg-primary/5'
            : 'rounded-lg bg-user-bubble group-[.is-user]:rounded-lg group-[.is-user]:bg-user-bubble',
        ]"
      >
        <div
          v-if="variant === 'steer'"
          class="flex items-center gap-2 text-sm font-medium text-primary"
        >
          <Badge variant="outline" class="border-primary/30 bg-surface/60 text-primary">{{
            t("app.steeredConversation")
          }}</Badge>
        </div>
        <div v-if="imageParts.length" class="grid max-w-2xl grid-cols-1 gap-2 sm:grid-cols-2">
          <template v-for="image in imageParts" :key="image.id">
            <ThreadImageAttachment
              v-if="imageSource(image)"
              :source="imageSource(image)"
              :label="image.path || null"
              :detail="image.detail"
            />
          </template>
        </div>
        <MarkdownContent v-if="text" :content="text" compact />
      </MessageContent>
      <div data-testid="user-message-actions" class="flex h-7 items-center gap-2">
        <MessageTimeLabel :time-ms="messageTimeMs ?? null" />
        <MessageAction
          v-if="text"
          :tooltip="copied ? t('app.userMessageCopied') : t('app.copyUserMessage')"
          size="sm"
          class="size-7 p-0 text-ink-muted hover:bg-canvas-soft hover:text-ink"
          @click="copyText"
        >
          <CheckIcon v-if="copied" class="size-4 text-accent-green" />
          <CopyIcon v-else class="size-4" />
        </MessageAction>
      </div>
    </div>
  </Message>
</template>

<style scoped>
.thread-user-message :deep(.markdown-content),
.thread-user-message :deep(.markdown-content p),
.thread-user-message :deep(.markdown-content li),
.thread-user-message :deep(.markdown-content code),
.thread-user-message :deep(.markdown-content a) {
  overflow-wrap: anywhere;
}
</style>
