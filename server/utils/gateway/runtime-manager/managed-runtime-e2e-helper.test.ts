import { describe, expect, it } from "vitest";

import {
  loginGatewayUser,
  listManagedRuntimeThreads,
  materializeManagedRuntimeThread,
  readManagedRuntimeStatus,
  restartGateway,
  restartManagedRuntimeAsAdmin,
  startManagedRuntime,
} from "../../../../tests/e2e/helpers/managed-runtime";

const pinnedSectionId = "01984de2-8f74-7c91-a3b2-5c5e937cf999";
const sectionListResponse = {
  data: [{ id: pinnedSectionId, name: "Pinned", appearance: null }],
  nextCursor: null,
};
const readyRuntimeStatus = {
  userId: 7,
  hostId: 2_000_000_000,
  runtimeType: "codex-app-server",
  imageVersion: "0.151.0",
  runtimeVersion: "0.151.0",
  schemaHash: "e2e-schema",
  status: "ready",
  lastError: null,
  createdAt: "2026-09-01T00:00:00.000Z",
  updatedAt: "2026-09-01T00:00:01.000Z",
};

describe("managed Runtime E2E helper", () => {
  it("lists pre-turn App Server threads across every recognized source kind", async () => {
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
          sourceKinds: [
            "cli",
            "vscode",
            "exec",
            "appServer",
            "subAgent",
            "subAgentReview",
            "subAgentCompact",
            "subAgentThreadSpawn",
            "subAgentOther",
            "unknown",
          ],
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

  it("uses the managed loopback origin for every Gateway request including restart polling", async () => {
    const urls: string[] = [];
    let bootReadCount = 0;
    const response = (value: unknown, status = 200) => ({
      ok: () => status >= 200 && status < 400,
      status: () => status,
      json: async () => value,
    });
    const request = {
      async get(url: string) {
        urls.push(url);
        if (url.endsWith("/api/runtime/me")) return response(readyRuntimeStatus);
        if (url.endsWith("/api/e2e/gateway-process")) {
          bootReadCount += 1;
          return response({
            bootId:
              bootReadCount === 1
                ? "01991c80-4000-7000-8000-000000000001"
                : "01991c80-4000-7000-8000-000000000002",
          });
        }
        throw new Error(`Unexpected GET ${url}`);
      },
      async post(url: string) {
        urls.push(url);
        if (url.endsWith("/api/auth/login")) {
          return response({
            token: "gateway-session-token",
            expiresAt: "2026-10-01T00:00:00.000Z",
            user: { id: 7, username: "runtime-a", role: "admin" },
          });
        }
        if (url.endsWith("/api/runtime/start")) return response(readyRuntimeStatus);
        if (url.endsWith("/api/admin/runtimes/7/restart")) {
          return response(readyRuntimeStatus);
        }
        if (url.endsWith("/api/e2e/gateway-restart")) return response({}, 202);
        throw new Error(`Unexpected POST ${url}`);
      },
    };

    const session = await loginGatewayUser(request, "runtime-a", "runtime-password");
    await startManagedRuntime(request, session);
    await readManagedRuntimeStatus(request, session);
    await restartManagedRuntimeAsAdmin(request, session, session);
    await restartGateway(request, session);

    expect(urls).toEqual([
      "http://127.0.0.1:3100/api/auth/login",
      "http://127.0.0.1:3100/api/runtime/start",
      "http://127.0.0.1:3100/api/runtime/me",
      "http://127.0.0.1:3100/api/admin/runtimes/7/restart",
      "http://127.0.0.1:3100/api/runtime/start",
      "http://127.0.0.1:3100/api/e2e/gateway-process",
      "http://127.0.0.1:3100/api/e2e/gateway-restart",
      "http://127.0.0.1:3100/api/e2e/gateway-process",
    ]);
  });
});
