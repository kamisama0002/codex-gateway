import { describe, expect, it } from "vitest";

import { listManagedRuntimeThreads } from "../../../../tests/e2e/helpers/managed-runtime";

describe("managed Runtime E2E helper", () => {
  it("lists App Server-created threads explicitly instead of relying on interactive defaults", async () => {
    const requests: Array<{ method: string; params: unknown }> = [];
    const threads = await listManagedRuntimeThreads({
      async request(method, params) {
        requests.push({ method, params });
        return { data: [], nextCursor: null };
      },
    });

    expect(threads).toEqual([]);
    expect(requests).toEqual([
      {
        method: "thread/list",
        params: {
          limit: 100,
          sortDirection: "desc",
          sourceKinds: ["appServer"],
        },
      },
    ]);
  });
});
