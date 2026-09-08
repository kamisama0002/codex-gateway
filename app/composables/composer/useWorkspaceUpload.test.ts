import { ref } from "vue";
import { beforeEach, describe, expect, it, vi } from "vitest";

const harness = vi.hoisted(() => ({
  requests: [] as Array<{ query: Record<string, unknown>; filenames: string[] }>,
  responses: [] as unknown[],
  errors: [] as string[],
  changedPaths: [] as string[],
  successMessages: [] as string[],
}));

vi.mock("@/utils/gateway-api", () => ({
  gatewayApi: async (_url: string, options: { query: Record<string, unknown>; body: FormData }) => {
    harness.requests.push({
      query: options.query,
      filenames: options.body
        .getAll("files")
        .map((entry) => (entry instanceof File ? entry.name : String(entry))),
    });
    return harness.responses.shift();
  },
}));
vi.mock("@/stores/gateway-bootstrap", () => ({
  useGatewayBootstrapStore: () => ({ setError: (message: string) => harness.errors.push(message) }),
}));
vi.mock("@/stores/file-workspace", () => ({
  useGatewayFileWorkspaceStore: () => ({
    markRemoteFilesChanged: (_hostId: number, _threadId: string, paths: string[]) =>
      harness.changedPaths.push(...paths),
  }),
}));
vi.mock("@codex-gateway/ui/sonner", () => ({
  toast: { success: (message: string) => harness.successMessages.push(message) },
}));
vi.mock("@/composables/i18n/useGatewayTranslator", () => ({
  useGatewayTranslator: () => (key: string, values?: Record<string, unknown>) => {
    const count = typeof values?.count === "number" ? values.count : null;
    return `${key}${count === null ? "" : `:${count}`}`;
  },
}));
vi.mock("@/utils/session-epoch", () => ({ captureSessionEpoch: () => () => true }));
vi.mock("@/utils/gateway-error", () => ({
  gatewayErrorMessage: (error: unknown, fallback: string) =>
    error instanceof Error ? error.message : fallback,
}));

import { useWorkspaceUpload } from "./useWorkspaceUpload";

describe("workspace upload state", () => {
  beforeEach(() => {
    harness.requests.length = 0;
    harness.responses.length = 0;
    harness.errors.length = 0;
    harness.changedPaths.length = 0;
    harness.successMessages.length = 0;
  });

  it("retains a conflicting folder batch and overwrites only after confirmation", async () => {
    harness.responses.push(
      { status: "conflict", conflicts: ["finance/report.csv"] },
      {
        status: "uploaded",
        files: [
          {
            name: "report.csv",
            relativePath: "finance/report.csv",
            path: "/workspace/finance/report.csv",
            mimeType: "text/csv",
            size: 2,
          },
        ],
      },
    );
    const upload = createUpload();
    const file = browserFile("report.csv", "finance/report.csv");

    await upload.uploadFiles([file], "folder");
    expect(upload.pendingConflict.value?.conflicts).toEqual(["finance/report.csv"]);
    expect(harness.changedPaths).toEqual([]);

    await upload.confirmOverwrite();
    expect(upload.pendingConflict.value).toBeNull();
    expect(harness.requests).toEqual([
      {
        query: { hostId: 1, projectId: 2, overwrite: false },
        filenames: ["finance/report.csv"],
      },
      {
        query: { hostId: 1, projectId: 2, overwrite: true },
        filenames: ["finance/report.csv"],
      },
    ]);
    expect(harness.changedPaths).toEqual(["/workspace/finance/report.csv"]);
    expect(harness.successMessages).toEqual(["app.workspaceUploadSucceeded:1"]);
  });

  it("rejects an oversized selection before making a request", async () => {
    const upload = createUpload();
    const oversized = browserFile("large.bin", "", 25 * 1024 * 1024 + 1);

    await upload.uploadFiles([oversized], "files");

    expect(harness.requests).toEqual([]);
    expect(harness.errors).toEqual(["app.workspaceUploadFileTooLarge"]);
  });
});

function createUpload() {
  return useWorkspaceUpload({
    selectedHostId: ref(1),
    selectedProjectId: ref(2),
    selectedThreadId: ref("thread-1"),
  });
}

function browserFile(name: string, relativePath: string, size = 2) {
  const file = new File([], name, { type: "text/csv" });
  Object.defineProperty(file, "size", { value: size });
  Object.defineProperty(file, "webkitRelativePath", { value: relativePath });
  return file;
}
