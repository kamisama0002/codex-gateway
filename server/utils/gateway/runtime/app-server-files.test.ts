import { Readable } from "node:stream";
import { describe, expect, it, vi } from "vitest";
import type { HostRecord } from "~~/shared/types";
import { MANAGED_RUNTIME_HOST_ID } from "~~/shared/runtime/managed-runtime";
import { RemoteFileTooLargeError } from "../infra/files/remote-file-errors";
import { CodexRpcClient } from "../infra/rpc/rpc";
import { AppServerFileService, type AppServerFileControllerRegistry } from "./app-server-files";

const managedHost = {
  id: MANAGED_RUNTIME_HOST_ID,
  connectionKind: "managed",
  name: "Local",
  sshHost: "localhost",
  username: null,
  port: null,
  authMode: "agent",
  privateKeyPath: null,
  privateKey: null,
  password: null,
  proxyUrl: null,
  hasPassword: false,
  createdAt: "",
  updatedAt: "",
} satisfies HostRecord;

describe("AppServerFileService managed workspace files", () => {
  it("reads file bytes and metadata through the App Server", async () => {
    const { service, request } = serviceWithResponses({
      "fs/getMetadata": {
        isDirectory: false,
        isFile: true,
        isSymlink: false,
        createdAtMs: 10,
        modifiedAtMs: 20,
      },
      "fs/readFile": { dataBase64: Buffer.from("营业额 42", "utf8").toString("base64") },
    });

    const file = await service.openFile(managedHost, "/workspace/report.md", { maxSize: 1024 });

    expect(file).toMatchObject({
      path: "/workspace/report.md",
      size: Buffer.byteLength("营业额 42"),
      modifiedAt: 20,
      sample: Buffer.from("营业额 42"),
    });
    expect(await readStream(file.stream)).toEqual(Buffer.from("营业额 42"));
    expect(request.mock.calls.map(([method]) => method)).toEqual(["fs/getMetadata", "fs/readFile"]);
  });

  it("rejects a managed file that exceeds the requested preview limit", async () => {
    const { service } = serviceWithResponses({
      "fs/getMetadata": {
        isDirectory: false,
        isFile: true,
        isSymlink: false,
        createdAtMs: 10,
        modifiedAtMs: 20,
      },
      "fs/readFile": { dataBase64: Buffer.alloc(6).toString("base64") },
    });

    await expect(
      service.openFile(managedHost, "/workspace/large.bin", { maxSize: 5 }),
    ).rejects.toBeInstanceOf(RemoteFileTooLargeError);
  });

  it("writes and removes workspace files through official App Server methods", async () => {
    const { service, request } = serviceWithResponses({
      "fs/writeFile": {},
      "fs/getMetadata": {
        isDirectory: false,
        isFile: true,
        isSymlink: false,
        createdAtMs: 10,
        modifiedAtMs: 30,
      },
      "fs/remove": {},
    });
    const content = Buffer.from("updated", "utf8");

    await expect(service.writeFile(managedHost, "/workspace/report.md", content)).resolves.toEqual({
      path: "/workspace/report.md",
      size: content.byteLength,
      modifiedAt: 30,
    });
    await expect(service.removeFile(managedHost, "/workspace/report.md")).resolves.toBeUndefined();
    expect(request.mock.calls.map(([method, params]) => [method, params])).toEqual([
      ["fs/writeFile", { path: "/workspace/report.md", dataBase64: content.toString("base64") }],
      ["fs/getMetadata", { path: "/workspace/report.md" }],
      ["fs/getMetadata", { path: "/workspace/report.md" }],
      ["fs/remove", { path: "/workspace/report.md", recursive: false, force: false }],
    ]);
  });

  it("does not send managed file RPCs outside /workspace", async () => {
    const { service, request } = serviceWithResponses({});

    await expect(
      service.openFile(managedHost, "/codex-home/auth.json", { maxSize: 1024 }),
    ).rejects.toThrow("Managed workspace files must stay under /workspace");
    await expect(
      service.writeFile(managedHost, "/tmp/report.md", Buffer.from("x")),
    ).rejects.toThrow("Managed workspace files must stay under /workspace");
    await expect(service.removeFile(managedHost, "/etc/passwd")).rejects.toThrow(
      "Managed workspace files must stay under /workspace",
    );
    expect(request).not.toHaveBeenCalled();
  });
});

function serviceWithResponses(responses: Record<string, unknown>) {
  const client = new CodexRpcClient(managedHost, { skipVersionCheck: true });
  const request = vi.spyOn(client, "request").mockImplementation(async (method: string) => {
    if (!Object.hasOwn(responses, method)) throw new Error(`Unexpected method ${method}`);
    return responses[method];
  });
  const registry = {
    getHostClient: async () => client,
  } satisfies AppServerFileControllerRegistry;
  return { service: new AppServerFileService(registry), request };
}

async function readStream(stream: Readable) {
  const chunks: Uint8Array[] = [];
  for await (const chunk of stream) {
    if (!(chunk instanceof Uint8Array)) throw new Error("Expected a byte stream");
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}
