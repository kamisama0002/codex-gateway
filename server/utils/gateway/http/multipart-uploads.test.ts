import { mkdtemp, readFile, rm } from "node:fs/promises";
import { IncomingMessage, ServerResponse } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Socket } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import { createEvent } from "h3";
import { streamMultipartUploads } from "./multipart-uploads";

const tempDirectories: string[] = [];

describe("streaming workspace uploads", () => {
  afterEach(async () => {
    await Promise.all(tempDirectories.splice(0).map((path) => rm(path, { recursive: true })));
  });

  it("resolves an ordinary attachment after its file stream completes", async () => {
    const tempDir = await createTempDirectory();

    const parts = await streamMultipartUploads(
      multipartEvent([{ filename: "report.txt", content: "ready" }]),
      tempDir,
    );

    expect(parts).toHaveLength(1);
    expect(parts[0]?.originalName).toBe("report.txt");
    expect(await readFile(parts[0]!.localPath, "utf8")).toBe("ready");
  });

  it("preserves a validated browser folder path", async () => {
    const tempDir = await createTempDirectory();
    const parts = await streamMultipartUploads(
      multipartEvent([{ filename: "finance/2026/revenue.csv", content: "42" }]),
      tempDir,
      {
        maxFiles: 200,
        maxFileBytes: 25 * 1024 * 1024,
        maxTotalBytes: 200 * 1024 * 1024,
        preserveRelativePaths: true,
      },
    );

    expect(parts).toHaveLength(1);
    expect(parts[0]?.relativePath).toBe("finance/2026/revenue.csv");
    expect(await readFile(parts[0]!.localPath, "utf8")).toBe("42");
  });

  it("rejects a folder path that escapes the project root", async () => {
    const tempDir = await createTempDirectory();

    await expect(
      streamMultipartUploads(
        multipartEvent([{ filename: "../secret.txt", content: "secret" }]),
        tempDir,
        {
          maxFiles: 200,
          maxFileBytes: 25 * 1024 * 1024,
          maxTotalBytes: 200 * 1024 * 1024,
          preserveRelativePaths: true,
        },
      ),
    ).rejects.toMatchObject({ statusCode: 400 });
  });

  it("rejects a batch after its total byte limit is exceeded", async () => {
    const tempDir = await createTempDirectory();

    await expect(
      streamMultipartUploads(
        multipartEvent([
          { filename: "one.txt", content: "123456" },
          { filename: "two.txt", content: "abcdef" },
        ]),
        tempDir,
        {
          maxFiles: 200,
          maxFileBytes: 25,
          maxTotalBytes: 10,
          preserveRelativePaths: true,
        },
      ),
    ).rejects.toMatchObject({ statusCode: 413 });
  });
});

async function createTempDirectory() {
  const directory = await mkdtemp(join(tmpdir(), "workspace-upload-test-"));
  tempDirectories.push(directory);
  return directory;
}

function multipartEvent(files: Array<{ filename: string; content: string }>) {
  const boundary = "codex-gateway-test-boundary";
  const body = files
    .map((file) =>
      [
        `--${boundary}`,
        `Content-Disposition: form-data; name="files"; filename="${file.filename}"`,
        "Content-Type: text/plain",
        "",
        file.content,
      ].join("\r\n"),
    )
    .concat(`--${boundary}--`)
    .join("\r\n");
  const request = new IncomingMessage(new Socket());
  request.method = "POST";
  request.headers["content-type"] = `multipart/form-data; boundary=${boundary}`;
  request.headers["content-length"] = String(Buffer.byteLength(body));
  request.push(body);
  request.push(null);
  request.complete = true;
  return createEvent(request, new ServerResponse(request));
}
