<script setup lang="ts">
defineProps<{ workspace?: string | null }>();
</script>

<template>
  <div class="grid min-h-0 flex-1 place-items-center px-6 pb-[clamp(2rem,12vh,7rem)]">
    <div class="empty-state flex max-w-md flex-col items-center text-center">
      <img src="/android-chrome-192x192.png" alt="" class="size-10 opacity-90" />
      <h1 class="mt-3 text-xl font-medium text-ink">{{ $t("app.emptyThreadTitle") }}</h1>
      <p v-if="workspace" class="mt-1 max-w-full truncate text-sm text-ink-faint">
        {{ $t("app.emptyThreadWorkspace", { workspace }) }}
      </p>
    </div>
  </div>
</template>

<style scoped>
.empty-state {
  animation: empty-state-in 220ms ease-out both;
}

@keyframes empty-state-in {
  from {
    opacity: 0;
    transform: translateY(0.5rem);
  }
}

@media (prefers-reduced-motion: reduce) {
  .empty-state {
    animation: none;
  }
}
</style>
