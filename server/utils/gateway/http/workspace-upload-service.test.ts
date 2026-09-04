import { describe, expect, it } from "vitest";
import type { ParsedUploadFile } from "./multipart-uploads";
import { uploadWorkspaceFiles } from "./workspace-upload-service";

const host = { id: 1 };
const project = { id: 2, hostId: 1, remotePath: "/workspace/finance" };

describe("workspace upload service", () => {
  it("rejects the whole batch with relative conflict paths before writing", async () => {
    const writes: string[] = [];
    const parts = [part("report.csv"), part("nested/data.json")];

    const result = await uploadWorkspaceFiles({
      host,
      project,
      parts,
      overwrite: false,
      remoteFiles: {
        existingPaths: async () => ["/workspace/finance/nested/data.json"],
        uploadFile: async (_host, _localPath, remotePath) => {
          writes.push(remotePath);
        },
      },
    });

    expect(result).toEqual({
      status: "conflict",
      conflicts: ["nested/data.json"],
    });
    expect(writes).toEqual([]);
  });

  it("writes the selected hierarchy after overwrite is confirmed", async () => {
    const writes: string[] = [];
    const parts = [part("report.csv"), part("nested/data.json")];

    const result = await uploadWorkspaceFiles({
      host,
      project,
      parts,
      overwrite: true,
      remoteFiles: {
        existingPaths: async () => ["/workspace/finance/report.csv"],
        uploadFile: async (_host, _localPath, remotePath) => {
          writes.push(remotePath);
        },
      },
    });

    expect(writes).toEqual([
      "/workspace/finance/report.csv",
      "/workspace/finance/nested/data.json",
    ]);
    if (result.status !== "uploaded") throw new Error("Expected uploaded workspace result");
    expect(result.files.map((file) => file.relativePath)).toEqual([
      "report.csv",
      "nested/data.json",
    ]);
  });

  it("rejects duplicate destinations inside one browser batch", async () => {
    const error = await uploadWorkspaceFiles({
      host,
      project,
      parts: [part("report.csv"), part("report.csv")],
      overwrite: true,
      remoteFiles: {
        existingPaths: async () => [],
        uploadFile: async () => {},
      },
    }).catch((caught: unknown) => caught);

    expect(error).toMatchObject({ statusCode: 400 });
  });
});

function part(relativePath: string): ParsedUploadFile {
  return {
    originalName: relativePath.split("/").at(-1) ?? relativePath,
    mimeType: "text/plain",
    localPath: `C:/tmp/${relativePath.replaceAll("/", "-")}`,
    safeName: "safe-upload",
    relativePath,
    size: 10,
  };
}
