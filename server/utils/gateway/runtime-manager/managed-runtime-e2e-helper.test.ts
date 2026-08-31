import { describe, expect, it } from "vitest";

import {
  listManagedRuntimeThreads,
  materializeManagedRuntimeThread,
} from "../../../../tests/e2e/helpers/managed-runtime";

const pinnedSectionId = "01984de2-8f74-7c91-a3b2-5c5e937cf999";
const sectionListResponse = {
  data: [{ id: pinnedSectionId, name: "Pinned", appearance: null }],
  nextCursor: null,
};

describe("managed Runtime E2E helper", () => {
  it("lists App Server-created threads explicitly instead of relying on interactive defaults", async () => {
    const requests: Array<{ method: string; params: unknown }> = [];
    const threads = await listManagedRuntimeThreads({
      async request(method, params) {
        requests.push({ method, params });
        if (method === "threadSection/list") return sectionListResponse;
        if (method === "thread/list") return { data: [], nextCursor: null };
        throw new Error(`Unexpected request ${method}`);
      },
    });

    expect(threads).toEqual([]);
    expect(requests).toEqual([
      {
        method: "threadSection/list",
        params: { limit: 100 },
      },
      {
        method: "thread/list",
        params: {
          limit: 100,
          sectionId: pinnedSectionId,
          sortDirection: "desc",
          sourceKinds: ["appServer"],
          useStateDbOnly: true,
        },
      },
    ]);
  });

  it("materializes an empty App Server thread by awaiting a move to the discovered pinned section", async () => {
    const requests: Array<{ method: string; params: unknown }> = [];
    const sectionId = await materializeManagedRuntimeThread(
      {
        async request(method, params) {
          requests.push({ method, params });
          if (method === "threadSection/list") return sectionListResponse;
          if (method === "thread/section/move") return {};
          throw new Error(`Unexpected request ${method}`);
        },
      },
      "thread-a",
    );

    expect(sectionId).toBe(pinnedSectionId);
    expect(requests).toEqual([
      {
        method: "threadSection/list",
        params: { limit: 100 },
      },
      {
        method: "thread/section/move",
        params: {
          beforeThreadId: null,
          sectionId: pinnedSectionId,
          threadId: "thread-a",
        },
      },
    ]);
  });

  it("rejects malformed Section list and move responses", async () => {
    await expect(
      listManagedRuntimeThreads({
        async request() {
          return {
            data: [{ ...sectionListResponse.data[0], internalId: "must-not-be-accepted" }],
            nextCursor: null,
          };
        },
      }),
    ).rejects.toMatchObject({ name: "ZodError" });

    await expect(
      materializeManagedRuntimeThread(
        {
          async request(method) {
            if (method === "threadSection/list") return sectionListResponse;
            return { moved: true };
          },
        },
        "thread-a",
      ),
    ).rejects.toMatchObject({ name: "ZodError" });
  });
});
