<script setup lang="ts">
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@codex-gateway/ui/alert-dialog";

defineProps<{
  open: boolean;
  deleting: boolean;
}>();

const emit = defineEmits<{
  cancel: [];
  confirm: [];
}>();
</script>

<template>
  <AlertDialog :open="open" @update:open="(value) => !value && emit('cancel')">
    <AlertDialogContent data-testid="delete-thread-dialog">
      <AlertDialogHeader>
        <AlertDialogTitle>{{ $t("app.deleteThreadTitle") }}</AlertDialogTitle>
        <AlertDialogDescription class="space-y-2">
          <span class="block">{{ $t("app.deleteThreadDescription") }}</span>
        </AlertDialogDescription>
      </AlertDialogHeader>
      <AlertDialogFooter>
        <AlertDialogCancel :disabled="deleting" @click="emit('cancel')">
          {{ $t("app.cancel") }}
        </AlertDialogCancel>
        <AlertDialogAction
          variant="destructive"
          data-testid="delete-thread-confirm"
          :disabled="deleting"
          @click.capture="emit('confirm')"
        >
          {{ $t("app.deleteThreadConfirm") }}
        </AlertDialogAction>
      </AlertDialogFooter>
    </AlertDialogContent>
  </AlertDialog>
</template>
