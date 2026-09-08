import { describe, expect, it } from "vitest";
import { Virtualizer, type VirtualizerOptions } from "@tanstack/virtual-core";

describe("virtual-core prepend measurements", () => {
  it("keeps newly prepended items renderable until their real sizes are measured", () => {
    const existingKeys = Array.from({ length: 7 }, (_, index) => `existing-${index}`);
    const prependedKeys = Array.from({ length: 5 }, (_, index) => `prepended-${index}`);
    const virtualizer = new Virtualizer(options(existingKeys));
    Reflect.set(virtualizer, "scrollElement", {});
    virtualizer.scrollRect = { width: 800, height: 100 };
    virtualizer.scrollOffset = 0;
    virtualizer.getVirtualItems();

    virtualizer.setOptions(options([...prependedKeys, ...existingKeys]));

    expect(virtualizer.scrollOffset).toBe(720);
    expect(virtualizer.getVirtualItems().map((item) => item.index)).toEqual(
      expect.arrayContaining([0, 1, 2, 3, 4]),
    );

    for (let index = 0; index < prependedKeys.length; index += 1) {
      virtualizer.resizeItem(index, 64);
    }

    expect(virtualizer.scrollOffset).toBe(320);
    expect(virtualizer.getVirtualItems().map((item) => item.index)).toEqual([5]);
  });

  it("keeps pending prepend measurements across an intervening append", () => {
    const existingKeys = Array.from({ length: 7 }, (_, index) => `existing-${index}`);
    const prependedKeys = Array.from({ length: 5 }, (_, index) => `prepended-${index}`);
    const virtualizer = new Virtualizer(options(existingKeys));
    Reflect.set(virtualizer, "scrollElement", {});
    virtualizer.scrollRect = { width: 800, height: 100 };
    virtualizer.scrollOffset = 0;
    virtualizer.getVirtualItems();

    const prependedAndExisting = [...prependedKeys, ...existingKeys];
    virtualizer.setOptions(options(prependedAndExisting));
    virtualizer.setOptions(options([...prependedAndExisting, "appended"]));

    expect(virtualizer.getVirtualItems().map((item) => item.index)).toEqual(
      expect.arrayContaining([0, 1, 2, 3, 4]),
    );
  });

  it("rebases pending measurements across a second prepend", () => {
    const existingKeys = Array.from({ length: 7 }, (_, index) => `existing-${index}`);
    const firstPrepend = Array.from({ length: 5 }, (_, index) => `first-${index}`);
    const secondPrepend = ["second-0", "second-1"];
    const virtualizer = new Virtualizer(options(existingKeys));
    Reflect.set(virtualizer, "scrollElement", {});
    virtualizer.scrollRect = { width: 800, height: 100 };
    virtualizer.scrollOffset = 0;
    virtualizer.getVirtualItems();

    const firstPage = [...firstPrepend, ...existingKeys];
    virtualizer.setOptions(options(firstPage));
    virtualizer.setOptions(options([...secondPrepend, ...firstPage]));

    expect(virtualizer.getVirtualItems().map((item) => item.index)).toEqual(
      expect.arrayContaining([0, 1, 2, 3, 4, 5, 6]),
    );
  });

  it("clears pending prepend measurements when virtualization is disabled", () => {
    const existingKeys = Array.from({ length: 7 }, (_, index) => `existing-${index}`);
    const prependedKeys = Array.from({ length: 5 }, (_, index) => `prepended-${index}`);
    const virtualizer = new Virtualizer(options(existingKeys));
    Reflect.set(virtualizer, "scrollElement", {});
    virtualizer.scrollRect = { width: 800, height: 100 };
    virtualizer.scrollOffset = 0;
    virtualizer.getVirtualItems();

    virtualizer.setOptions(options([...prependedKeys, ...existingKeys]));
    virtualizer.setOptions(options([...prependedKeys, ...existingKeys], { enabled: false }));

    expect(virtualizer.getVirtualItems()).toEqual([]);
  });

  it("clears pending prepend measurements when the scroll element detaches", () => {
    const existingKeys = Array.from({ length: 7 }, (_, index) => `existing-${index}`);
    const prependedKeys = Array.from({ length: 5 }, (_, index) => `prepended-${index}`);
    const virtualizer = new Virtualizer(options(existingKeys));
    Reflect.set(virtualizer, "scrollElement", {});
    virtualizer.scrollRect = { width: 800, height: 100 };
    virtualizer.scrollOffset = 0;
    virtualizer.getVirtualItems();

    virtualizer.setOptions(options([...prependedKeys, ...existingKeys]));
    virtualizer._willUpdate();

    expect(virtualizer.getVirtualItems().map((item) => item.index)).toEqual([5]);
  });
});

function options(
  keys: string[],
  overrides: Partial<VirtualizerOptions<HTMLElement, HTMLElement>> = {},
): VirtualizerOptions<HTMLElement, HTMLElement> {
  return {
    count: keys.length,
    getScrollElement: () => null,
    estimateSize: () => 144,
    getItemKey: (index) => keys[index] ?? index,
    observeElementRect: () => undefined,
    observeElementOffset: () => undefined,
    scrollToFn: () => undefined,
    anchorTo: "end",
    followOnAppend: false,
    scrollEndThreshold: Number.NEGATIVE_INFINITY,
    overscan: 0,
    initialRect: { width: 800, height: 100 },
    ...overrides,
  };
}
