import { describe, expect, it } from "vitest";
import { assignRuntimePolicy } from "./runtime-policy";

describe("runtime policy assignment", () => {
  it("normalizes an accepted source timestamp to canonical UTC within the MySQL column width", () => {
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
      sourceIssuedAt: "Fri Sep 04 2026 00:00:00 GMT+0000 (Coordinated Universal Time)",
      now: "2026-09-04T00:01:00.000Z",
    });

    expect(assigned.sourceIssuedAt).toBe("2026-09-04T00:00:00.000Z");
    expect(assigned.sourceIssuedAt).toHaveLength(24);
    expect(assigned.sourceIssuedAt.length).toBeLessThanOrEqual(32);
  });
});
