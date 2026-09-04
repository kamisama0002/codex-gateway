<script setup lang="ts">
type StateDotState = "done" | "warning" | "ongoing" | "error";

defineProps<{
  state: StateDotState;
}>();

const matrixCells = [
  [0, 0],
  [4, 0],
  [8, 0],
  [8, 4],
  [8, 8],
  [4, 8],
  [0, 8],
  [0, 4],
] as const;
</script>

<template>
  <svg
    v-if="state === 'ongoing'"
    class="state-dot-matrix size-2.5 shrink-0"
    data-state="ongoing"
    viewBox="0 0 10 10"
    shape-rendering="crispEdges"
    aria-hidden="true"
  >
    <rect
      v-for="([x, y], index) in matrixCells"
      :key="`${x}-${y}`"
      class="state-dot-cell"
      :x="x"
      :y="y"
      width="2"
      height="2"
      :style="{ animationDelay: `${(index - matrixCells.length) * 125}ms` }"
    />
  </svg>
  <span v-else class="state-dot size-2.5 shrink-0" :data-state="state" aria-hidden="true" />
</template>

<style scoped>
.state-dot {
  position: relative;
  display: inline-block;
}

.state-dot::before,
.state-dot::after {
  position: absolute;
  content: "";
  border-radius: 9999rem;
  background: currentColor;
}

.state-dot::before {
  inset: 0;
  opacity: 0.1;
}

.state-dot::after {
  inset: 20%;
}

.state-dot[data-state="done"] {
  color: var(--accent-green);
}

.state-dot[data-state="warning"] {
  color: var(--accent-orange);
}

.state-dot[data-state="error"] {
  color: var(--destructive);
}

.state-dot-matrix {
  color: var(--primary);
}

.state-dot-cell {
  fill: currentColor;
  opacity: 0.15;
  animation: state-dot-chase 1s infinite;
}

@keyframes state-dot-chase {
  0%,
  12.4% {
    opacity: 1;
  }
  12.5%,
  24.9% {
    opacity: 0.6;
  }
  25%,
  37.4% {
    opacity: 0.35;
  }
  37.5%,
  100% {
    opacity: 0.15;
  }
}

@media (prefers-reduced-motion: reduce) {
  .state-dot-cell {
    animation: none;
    opacity: 0.6;
  }
}
</style>
