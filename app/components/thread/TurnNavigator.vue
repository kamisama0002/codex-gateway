<script setup lang="ts">
import { computed, nextTick, ref, watch } from "vue";

export interface TurnNavigatorItem {
  turnId: string;
  prompt: string;
  response: string;
  active: boolean;
  rowIndex: number;
}

const props = defineProps<{
  items: TurnNavigatorItem[];
  activeTurnId: string | null;
}>();

const emit = defineEmits<{
  navigate: [item: TurnNavigatorItem];
}>();

const { t } = useI18n();
const turnSpacingRem = 0.625;
const railInsetRem = 0.375;
const railFadeRem = 1.5;
const scroller = ref<HTMLElement | null>(null);
const previewTurnId = ref<string | null>(null);
const railScrollTop = ref(0);
const naturalHeight = computed(
  () => `${Math.max(0.75, (props.items.length - 1) * turnSpacingRem + 0.75)}rem`,
);
const previewIndex = computed(() =>
  props.items.findIndex((item) => item.turnId === previewTurnId.value),
);
const previewItem = computed(() =>
  previewIndex.value < 0 ? null : (props.items[previewIndex.value] ?? null),
);

function markStyle(index: number) {
  return { "--turn-position": `${index * turnSpacingRem}rem` };
}

function syncRailScroll() {
  railScrollTop.value = scroller.value?.scrollTop ?? 0;
}

function previewStyle() {
  return {
    "--turn-position": `${Math.max(0, previewIndex.value) * turnSpacingRem}rem`,
    "--turn-scroll-top": `${railScrollTop.value}px`,
  };
}

function jumpLabel(index: number) {
  return t("app.turnNavigatorJump", { turn: index + 1 });
}

function previewPrompt(item: TurnNavigatorItem, index: number) {
  return item.prompt || t("app.turnNavigatorTurn", { turn: index + 1 });
}

watch(
  () => props.activeTurnId,
  async (turnId) => {
    if (turnId === null) return;
    await nextTick();
    const index = props.items.findIndex((item) => item.turnId === turnId);
    const rail = scroller.value;
    if (index < 0 || rail === null) return;
    const rootFontSize = Number.parseFloat(getComputedStyle(document.documentElement).fontSize);
    const rem = Number.isFinite(rootFontSize) ? rootFontSize : 16;
    const markTop = (index * turnSpacingRem + railInsetRem) * rem;
    const fade = railFadeRem * rem;
    if (markTop >= rail.scrollTop + fade && markTop <= rail.scrollTop + rail.clientHeight - fade) {
      return;
    }
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    rail.scrollTo({
      top: Math.max(0, markTop - rail.clientHeight / 2),
      behavior: reducedMotion ? "auto" : "smooth",
    });
  },
  { immediate: true },
);
</script>

<template>
  <nav
    v-if="items.length > 1"
    class="turn-navigator"
    data-testid="turn-navigator"
    :style="{ '--turn-natural-height': naturalHeight }"
    :aria-label="t('app.turnNavigator')"
  >
    <div ref="scroller" class="turn-scroller" @scroll="syncRailScroll">
      <div class="turn-marks">
        <div
          v-for="(item, index) in items"
          :key="item.turnId"
          class="turn-mark-position"
          :style="markStyle(index)"
        >
          <button
            type="button"
            class="turn-mark"
            :class="{
              'turn-mark-active': item.turnId === activeTurnId,
              'turn-mark-busy': item.active,
            }"
            :aria-label="jumpLabel(index)"
            :aria-current="item.turnId === activeTurnId ? 'true' : undefined"
            @click="emit('navigate', item)"
            @focus="previewTurnId = item.turnId"
            @blur="previewTurnId = null"
            @mouseenter="previewTurnId = item.turnId"
            @mouseleave="previewTurnId = null"
          />
        </div>
      </div>
    </div>
    <div v-if="previewItem !== null" role="tooltip" class="turn-preview" :style="previewStyle()">
      <div class="turn-preview-prompt">
        {{ previewPrompt(previewItem, previewIndex) }}
      </div>
      <div v-if="previewItem.response" class="turn-preview-response">
        {{ previewItem.response }}
      </div>
    </div>
  </nav>
</template>

<style scoped>
.turn-navigator {
  --turn-preview-height: 6.25rem;

  position: absolute;
  top: 50%;
  right: 0.75rem;
  z-index: 20;
  width: 1.75rem;
  height: min(var(--turn-natural-height), calc(100% - 4rem), 26.25rem);
  pointer-events: auto;
  transform: translateY(-50%);
  transition: height 220ms cubic-bezier(0.2, 0.8, 0.2, 1);
}

.turn-scroller {
  position: absolute;
  inset: 0;
  overflow-y: auto;
  overscroll-behavior: contain;
  scrollbar-width: none;
}

.turn-scroller::-webkit-scrollbar {
  display: none;
}

.turn-marks {
  position: relative;
  height: var(--turn-natural-height);
}

.turn-mark-position {
  position: absolute;
  top: calc(var(--turn-position) + 0.375rem);
  right: 0;
  left: 0;
  height: 0.625rem;
  transform: translateY(-50%);
  animation: turn-mark-enter 150ms ease-out;
}

.turn-mark {
  position: absolute;
  inset: 0 0 0 auto;
  width: 1.25rem;
  padding: 0;
  border: 0;
  border-radius: 0.5rem;
  background: transparent;
  cursor: pointer;
}

.turn-mark::before {
  position: absolute;
  top: 50%;
  right: 0;
  width: 0.75rem;
  height: 0.125rem;
  border-radius: 0.125rem;
  background: var(--hairline);
  content: "";
  transform: translateY(-50%);
  transition:
    width 140ms ease,
    background-color 140ms ease;
}

.turn-mark:hover::before,
.turn-mark:focus-visible::before {
  width: 1.125rem;
  background: var(--ink-faint);
}

.turn-mark-active::before,
.turn-mark-active:hover::before,
.turn-mark-active:focus-visible::before {
  width: 1.25rem;
  background: var(--ink);
}

.turn-mark-busy::before {
  animation: turn-mark-busy 1s ease-in-out infinite;
}

.turn-mark:focus-visible {
  outline: 0.0625rem solid var(--primary);
  outline-offset: 0.125rem;
}

.turn-preview {
  position: absolute;
  top: clamp(
    0rem,
    calc(var(--turn-position) + 0.375rem - var(--turn-scroll-top) - 3.125rem),
    calc(100% - var(--turn-preview-height))
  );
  right: calc(100% + 0.625rem);
  box-sizing: border-box;
  width: min(18.75rem, calc(100vw - 7.5rem));
  max-height: var(--turn-preview-height);
  overflow: hidden;
  padding: 0.625rem 0.75rem;
  border-radius: 0.625rem;
  background: var(--surface);
  color: var(--ink);
  box-shadow: 0 0.5rem 1.5rem rgb(15 17 21 / 12%);
  pointer-events: none;
  animation: turn-preview-enter 120ms ease-out;
}

.turn-preview-prompt,
.turn-preview-response {
  display: -webkit-box;
  overflow: hidden;
  -webkit-box-orient: vertical;
}

.turn-preview-prompt {
  font-size: 0.8125rem;
  font-weight: 500;
  line-height: 1.25rem;
  -webkit-line-clamp: 1;
}

.turn-preview-response {
  margin-top: 0.25rem;
  color: var(--ink-faint);
  font-size: 0.75rem;
  line-height: 1.125rem;
  -webkit-line-clamp: 3;
}

@keyframes turn-mark-enter {
  from {
    opacity: 0;
  }
}

@keyframes turn-preview-enter {
  from {
    opacity: 0;
    transform: translateX(0.25rem);
  }
}

@keyframes turn-mark-busy {
  50% {
    opacity: 0.35;
  }
}

@media (max-width: 56.25rem) {
  .turn-navigator {
    display: none;
  }
}

@media (prefers-reduced-motion: reduce) {
  .turn-navigator,
  .turn-mark-position,
  .turn-mark::before,
  .turn-mark-busy::before,
  .turn-preview {
    transition: none;
    animation: none;
  }
}
</style>
