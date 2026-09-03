import { describe, expect, it } from "vitest";
import { KeyedLeaseLimiter } from "./keyed-lease-limiter";

describe("KeyedLeaseLimiter", () => {
  it("admits a queued lease after an active lease is released", async () => {
    const limiter = new KeyedLeaseLimiter(2);
    const first = await limiter.acquire("host");
    const second = await limiter.acquire("host");
    let admitted = false;
    const thirdPending = limiter.acquire("host").then((release) => {
      admitted = true;
      return release;
    });

    await Promise.resolve();
    expect(admitted).toBe(false);
    first();
    const third = await thirdPending;
    expect(admitted).toBe(true);

    second();
    third();
  });

  it("does not let one key block another", async () => {
    const limiter = new KeyedLeaseLimiter(1);
    const first = await limiter.acquire("first");
    const second = await limiter.acquire("second");
    first();
    second();
  });

  it("removes an aborted queued lease", async () => {
    const limiter = new KeyedLeaseLimiter(1);
    const active = await limiter.acquire("host");
    const controller = new AbortController();
    const pending = limiter.acquire("host", { signal: controller.signal });
    controller.abort(new Error("cancelled"));

    await expect(pending).rejects.toThrow("cancelled");
    active();
    const next = await limiter.acquire("host");
    next();
  });

  it("rejects queued leases and starts a new generation after reset", async () => {
    const limiter = new KeyedLeaseLimiter(1);
    const stale = await limiter.acquire("host");
    const pending = limiter.acquire("host");
    limiter.reset("host", new Error("connection closed"));

    await expect(pending).rejects.toThrow("connection closed");
    const current = await limiter.acquire("host");
    stale();
    current();
  });
});
