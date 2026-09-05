<script setup lang="ts">
import { computed } from "vue";
import {
  Attachment,
  AttachmentInfo,
  AttachmentPreview,
  AttachmentRemove,
  Attachments,
} from "@codex-gateway/ai-elements/attachments";
import type { ComposerAttachment } from "@/composables/composer/useComposerDraft";
import { presentComposerAttachment } from "./attachment-presentation";

const props = defineProps<{
  files: ComposerAttachment[];
  disabled: boolean;
}>();

const emit = defineEmits<{
  remove: [id: string];
}>();

const { t } = useI18n();
const presentations = computed(() => props.files.map(presentComposerAttachment));
</script>

<template>
  <Attachments v-if="presentations.length" variant="inline" class="mb-2 max-w-full">
    <Attachment
      v-for="attachment in presentations"
      :key="attachment.id"
      :data="attachment.data"
      class="max-w-full"
      @remove="emit('remove', attachment.id)"
    >
      <AttachmentPreview />
      <AttachmentInfo class="max-w-48" />
      <!-- AI Elements hides inline removal until hover; touch users need a persistent target. -->
      <AttachmentRemove
        :label="t('app.removeAttachment')"
        :disabled="disabled"
        class="opacity-100"
      />
    </Attachment>
  </Attachments>
</template>
