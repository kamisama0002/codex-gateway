import { describe, expect, it } from "vitest";
import { threadCatalogEvents } from "./thread-catalog-events";

describe("threadCatalogEvents", () => {
  it("fans a catalog update out to every subscriber for that user", () => {
    const first: unknown[] = [];
    const second: unknown[] = [];
    const otherUser: unknown[] = [];
    const update = { hostId: 1, threadId: "t1", action: "archived" as const, thread: null };
    const unsubFirst = threadCatalogEvents.subscribe(3, (event) => first.push(event));
    const unsubSecond = threadCatalogEvents.subscribe(3, (event) => second.push(event));
    const unsubOther = threadCatalogEvents.subscribe(4, (event) => otherUser.push(event));

    threadCatalogEvents.publish(3, update);

    expect(first).toEqual([update]);
    expect(second).toEqual([update]);
    expect(otherUser).toEqual([]);
    unsubFirst();
    unsubSecond();
    unsubOther();
  });
});
