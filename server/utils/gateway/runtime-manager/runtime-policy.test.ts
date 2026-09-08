import { describe, expect, it } from "vitest";
import { assignRuntimePolicy } from "./runtime-policy";

describe("runtime policy assignment", () => {
  it("normalizes all persisted timestamps to canonical UTC within the MySQL column width", () => {
    const assigned = assignRuntimePolicy({
      userId: 1,
      tenantId: 10,
      policy: {
        version: 1,
        imageAlias: "stable",
        memoryMiB: 2048,
        cpuCores: 2,
        pidsLimit: 256,
      },
      sourceIssuedAt: "2026-09-04T02:00:00.000+02:00",
      now: "Fri Sep 04 2026 00:01:00 GMT+0000 (Coordinated Universal Time)",
    });

    expect(assigned).toMatchObject({
      sourceIssuedAt: "2026-09-04T00:00:00.000Z",
      createdAt: "2026-09-04T00:01:00.000Z",
      updatedAt: "2026-09-04T00:01:00.000Z",
    });
    for (const timestamp of [assigned.sourceIssuedAt, assigned.createdAt, assigned.updatedAt]) {
      expect(timestamp).toHaveLength(24);
      expect(timestamp.length).toBeLessThanOrEqual(32);
    }
  });
});
