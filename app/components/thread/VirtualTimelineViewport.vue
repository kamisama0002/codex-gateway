<script setup lang="ts">
import type { VirtualItem } from "@tanstack/virtual-core";
import { useDocumentVisibility, useElementVisibility, useEventListener } from "@vueuse/core";
import type { ComponentPublicInstance } from "vue";
import { computed, inject, nextTick, ref, watch } from "vue";
import {
  CHAT_VIEWPORT_LAYOUT_REVISION,
  ChatVirtualScrollFrame,
  useChatVirtualizer,
} from "@/components/common/chat-virtualizer";
import TurnNavigator, { type TurnNavigatorItem } from "@/components/thread/TurnNavigator.vue";
import type { ThreadTurnNavigation } from "@/components/thread/timeline-rows";

interface TimelineViewportRow {
  key: string;
  type?: string;
  section?: string;
  turnId?: string;
  turnNavigation?: ThreadTurnNavigation;
}

const props = defineProps<{
  rows: TimelineViewportRow[];
  estimateSize: (row: unknown, index: number) => number;
  scrollToLatestToken?: number;
}>();

const emit = defineEmits<{
  reachStart: [];
  userDetachedChange: [detached: boolean];
  visibleTurnIdsChange: [turnIds: string[]];
}>();

const scrollFrameRef = ref<InstanceType<typeof ChatVirtualScrollFrame> | null>(null);
// Keep end following strict like TanStack's Chat default: a reader who moves even slightly away
// from latest owns that position. The larger top threshold is only an ergonomic history trigger;
// sharing it with end detection previously made a 48px upward scroll continue following output.
const latestThreshold = 2;
const historyStartThreshold = 80;
const startControlsVisible = ref(false);
const viewportReady = ref(false);
const didInitialScroll = ref(false);
const activeTurnId = ref<string | null>(null);
const turnNavigationItems = computed<TurnNavigatorItem[]>(() =>
  props.rows.flatMap((row, rowIndex) =>
    row.turnNavigation === undefined ? [] : [{ ...row.turnNavigation, rowIndex }],
  ),
);

const chatVirtualizer = useChatVirtualizer({
  count: () => props.rows.length,
  threshold: latestThreshold,
  getViewport: scrollViewport,
  // Capture the array reference without copying every key on each streaming update. This is the
  // Vue equivalent of React's dependency-bound callback: old and new Core options retain distinct
  // row snapshots, while each indexed lookup stays O(1).
  getItemKeySnapshot: () => {
    const rows = props.rows;
    return (index: number) => rows[index]?.key ?? index;
  },
  estimateSize: (index: number) => props.estimateSize(props.rows[index], index),
  overscan: 6,
  onViewportScroll: (viewport) => {
    syncActiveTurn(viewport);
    // A short chat is simultaneously at the top and bottom. Only interpret
    // top proximity as history intent after explicit upward input detached the
    // outer timeline. Do not infer intent from an underfilled initial page: the
    // initial activation is atomic, and older history is loaded only on explicit input.
    const reachedStart =
      chatVirtualizer.userDetached.value && viewport.scrollTop <= historyStartThreshold;
    startControlsVisible.value = reachedStart;
    if (reachedStart) {
      emit("reachStart");
    }
  },
});

const virtualRows = chatVirtualizer.virtualItems;
const visibleTurnIds = computed(() => [
  ...new Set(
    virtualRows.value.flatMap((virtualRow) => {
      const turnId = props.rows[virtualRow.index]?.turnId;
      return turnId === undefined || turnId === "" ? [] : [turnId];
    }),
  ),
]);
const viewportElement = computed(() => scrollViewport());
const viewportVisible = useElementVisibility(viewportElement);
const documentVisibility = useDocumentVisibility();
const workspaceLayoutRevision = inject(CHAT_VIEWPORT_LAYOUT_REVISION, null);

// An underfilled first page is both at the start and at the end, so no scroll event can express
// that the reader moved away from latest. The upward wheel itself is explicit intent: detach before
// requesting history so concurrent streaming cannot reclaim the bottom while the page prepends.
// This listener never writes scrollTop; Core still owns keyed anchors and every correction.
useEventListener(
  viewportElement,
  "wheel",
  (event) => {
    const viewport = viewportElement.value;
    if (event.deltaY >= 0 || viewport === null || viewport.scrollTop > historyStartThreshold)
      return;
    chatVirtualizer.detachFromLatest();
    startControlsVisible.value = true;
    emit("reachStart");
  },
  { passive: true },
);

function scrollViewport() {
  return scrollFrameRef.value?.getViewport() ?? null;
}

function syncActiveTurn(viewport = scrollViewport()) {
  const items = turnNavigationItems.value;
  if (viewport === null || items.length === 0) {
    activeTurnId.value = null;
    return;
  }
  if (viewport.scrollHeight - viewport.scrollTop - viewport.clientHeight <= latestThreshold) {
    activeTurnId.value = items.at(-1)?.turnId ?? null;
    return;
  }
  const viewportTop = viewport.getBoundingClientRect().top;
  const readingLine = viewportTop + Math.min(96, viewport.clientHeight * 0.2);
  let nextTurnId = items[0]?.turnId ?? null;
  for (const element of viewport.querySelectorAll<HTMLElement>("[data-turn-id]")) {
    if (element.getBoundingClientRect().top > readingLine) break;
    nextTurnId = element.dataset.turnId ?? nextTurnId;
  }
  activeTurnId.value = nextTurnId;
}

async function navigateToTurn(item: TurnNavigatorItem) {
  activeTurnId.value = item.turnId;
  if (item.turnId === turnNavigationItems.value.at(-1)?.turnId) {
    await chatVirtualizer.scrollToLatest();
    return;
  }
  chatVirtualizer.detachFromLatest();
  await nextTick();
  chatVirtualizer.virtualizer.value.scrollToIndex(item.rowIndex, {
    align: "start",
    behavior: "auto",
  });
}

function setRowRef(refValue: Element | ComponentPublicInstance | null) {
  const element = refValue instanceof Element ? refValue : null;
  if (!element) {
    return;
  }
  const index = Number((element as HTMLElement).dataset.index);
  if (Number.isFinite(index)) chatVirtualizer.measureElement(element);
}

function rowStyle(_virtualRow: VirtualItem) {
  return {
    position: "absolute",
    top: "0",
    left: "0",
    width: "100%",
  } as const;
}

function resetFollowLatest() {
  void chatVirtualizer.scrollToLatest();
}

// TanStack's ResizeObserver owns actual viewport changes and dynamic row measurements. These
// watchers only reconnect the direct Vue adapter after Dockview or the browser hid a still-mounted
// panel. They intentionally do not add another resize listener, restore a DOM anchor, or write
// scrollTop; any of those would race the core Chat transaction when the panel becomes visible.
watch(viewportVisible, (visible, previous) => {
  if (visible && previous === false) chatVirtualizer.refresh();
});

watch(documentVisibility, (visibility, previous) => {
  if (visibility === "visible" && previous !== "visible") chatVirtualizer.refresh();
});

if (workspaceLayoutRevision !== null) {
  watch(workspaceLayoutRevision, () => {
    // A keyed Dockview workspace deliberately creates a fresh Agent DOM for each thread. On
    // mobile WebKit the Vue child can finish mounting before Dockview commits the restored panel
    // height, leaving the official initial scrollToEnd aligned to transient geometry. Re-run the
    // same public TanStack operation at Dockview's semantic layout boundary while Chat mode still
    // owns the end. If the reader detached, refresh measurements only: never override reading.
    //
    // Do not replace this with timeouts, rAF loops, scrollTop writes, or a second ResizeObserver.
    // Those mechanisms cannot distinguish Dockview layout from row streaming and would race
    // virtual-core's prepend, iOS momentum, and dynamic-row compensation.
    chatVirtualizer.refresh();
    if (didInitialScroll.value && chatVirtualizer.followLatest.value) resetFollowLatest();
  });
}

watch(
  [viewportReady, () => props.rows.length],
  ([ready, rowCount]) => {
    if (!ready || rowCount === 0 || didInitialScroll.value) return;
    didInitialScroll.value = true;
    // Match TanStack's official React Chat example: perform the one initial end alignment only
    // after both the viewport and the first non-empty message snapshot have committed. Calling
    // scrollToEnd while the list is still empty and treating 0 -> N as an ordinary append leaves
    // WebKit free to settle on the estimated last-row height; its later real measurement can then
    // remain below the viewport. This is intentionally one-shot. All subsequent appends, streaming
    // growth, prepends, and user detachment belong to Core's anchorTo/followOnAppend transaction.
    resetFollowLatest();
  },
  { flush: "post", immediate: true },
);

watch(
  () => props.scrollToLatestToken,
  (token, previous) => {
    if (!viewportReady.value || token === undefined || token === previous) return;
    // A user submission and an explicit thread activation are the only external commands that
    // may reclaim the latest edge. The former content-signature watcher followed every stream
    // delta and overrode readers who had scrolled up; keeping this scalar command separate lets
    // TanStack own all ordinary appends, measurements, and intermediate-step collapse.
    resetFollowLatest();
  },
  { flush: "post" },
);

watch(
  () => chatVirtualizer.userDetached.value,
  (detached) => {
    if (!detached) startControlsVisible.value = false;
    emit("userDetachedChange", detached);
  },
  { immediate: true },
);

watch(
  visibleTurnIds,
  (turnIds) => {
    emit("visibleTurnIdsChange", turnIds);
  },
  { immediate: true },
);

function handleViewportReady() {
  chatVirtualizer.refresh();
  // Do not mark an empty viewport as initially aligned. History commonly arrives after this
  // component mounts; the watcher above is the single equivalent of React's initial layout effect.
  viewportReady.value = true;
  syncActiveTurn();
}

watch(
  [viewportReady, () => props.rows.length],
  async ([ready]) => {
    if (!ready) return;
    await nextTick();
    syncActiveTurn();
  },
  { flush: "post" },
);
</script>

<template>
  <div class="relative h-full min-h-0 flex-1 overflow-hidden">
    <ChatVirtualScrollFrame
      ref="scrollFrameRef"
      data-testid="chat-scroll-area"
      :data-follow-latest="chatVirtualizer.followLatest.value ? 'true' : 'false'"
      :data-is-scrolling="chatVirtualizer.isScrolling.value ? 'true' : 'false'"
      class="h-full min-h-0 overflow-hidden"
      @viewport-ready="handleViewportReady"
    >
      <div class="pointer-events-none sticky top-0 z-10 h-0">
        <slot name="overlay" :visible="startControlsVisible" />
      </div>
      <!--
      Keep trailing spacing inside every measured row. Do not put top spacing
      on `first:*`: after a prepend the old anchor row stops being first, so its
      content moves inside an otherwise stable keyed row. Padding around the
      sizer is also invisible to virtual-core and creates a false scroll range.
    -->
      <div class="thread-column flex min-h-full flex-col px-[clamp(0.875rem,4vw,1.5rem)]">
        <div :ref="chatVirtualizer.containerRef" class="relative mt-auto shrink-0">
          <div
            v-for="virtualRow in virtualRows"
            :key="String(virtualRow.key)"
            :ref="setRowRef"
            :data-index="virtualRow.index"
            :data-row-key="rows[virtualRow.index]?.key"
            :data-row-type="rows[virtualRow.index]?.type"
            :data-row-section="rows[virtualRow.index]?.section"
            :data-turn-id="rows[virtualRow.index]?.turnId"
            class="pb-3 md:pb-4"
            :style="rowStyle(virtualRow)"
          >
            <slot :row="rows[virtualRow.index]" :index="virtualRow.index" />
          </div>
        </div>
      </div>
    </ChatVirtualScrollFrame>
    <TurnNavigator
      :items="turnNavigationItems"
      :active-turn-id="activeTurnId"
      @navigate="navigateToTurn"
    />
  </div>
</template>
