<script setup lang="ts">
import type { RemoteGitFileStatus } from "~~/shared/types";
import { gitStatusCode, gitStatusTextClass } from "@/utils/git-status-presentation";

defineProps<{ status: RemoteGitFileStatus | null }>();
</script>

<template>
  <span
    v-if="status"
    class="shrink-0 text-[0.6875rem] font-semibold"
    :class="gitStatusTextClass(status)"
    :aria-label="$t(`app.fileGitStatus.${status}`)"
  >
    {{ gitStatusCode(status) }}
  </span>
</template>
