import { describe, expect, it, vi } from "vitest";
import { RuntimeIdleReaper } from "./runtime-idle-reaper";

describe("RuntimeIdleReaper", () => {
  it("runs a sweep immediately and does not overlap sweeps", async () => {
    let release!: () => void;
    let runningSweep!: Promise<number[]>;
    const releaseIdleRuntimes = vi.fn(() => {
      runningSweep = new Promise<number[]>((resolve) => {
        release = () => resolve([7]);
      });
      return runningSweep;
    });
    const reaper = new RuntimeIdleReaper({
      idleTimeoutMs: 1_800_000,
      intervalMs: 60_000,
      releaseIdleRuntimes,
    });

    reaper.start();
    await vi.waitFor(() => expect(releaseIdleRuntimes).toHaveBeenCalledOnce());
    await expect(reaper.sweep()).resolves.toEqual([]);
    release();
    await expect(runningSweep).resolves.toEqual([7]);
    reaper.stop();
  });

  it("does not start when the timeout is disabled", async () => {
    const releaseIdleRuntimes = vi.fn(async () => [7]);
    const reaper = new RuntimeIdleReaper({ idleTimeoutMs: 0, releaseIdleRuntimes });

    reaper.start();
    await expect(reaper.sweep()).resolves.toEqual([]);
    expect(releaseIdleRuntimes).not.toHaveBeenCalled();
  });
});
