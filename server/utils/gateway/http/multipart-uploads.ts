import Busboy, { type BusboyFileStream } from "@fastify/busboy";
import { randomUUID } from "node:crypto";
import { createWriteStream } from "node:fs";
import { basename, extname, join } from "node:path";
import { pipeline } from "node:stream/promises";
import { createError, type H3Event } from "h3";
import ensureError from "ensure-error";
import { normalizeWorkspaceUploadPath } from "./validation/workspace-uploads";

const MAX_UPLOAD_FILES = 8;
const MAX_UPLOAD_FILE_BYTES = 25 * 1024 * 1024;

export interface MultipartUploadOptions {
  maxFiles?: number;
  maxFileBytes?: number;
  maxTotalBytes?: number;
  preserveRelativePaths?: boolean;
}

export interface ParsedUploadFile {
  originalName: string;
  mimeType: string | null;
  localPath: string;
  safeName: string;
  relativePath: string;
  size: number;
}

export function streamMultipartUploads(
  event: H3Event,
  tempDir: string,
  options: MultipartUploadOptions = {},
) {
  const contentType = event.node.req.headers["content-type"];
  if (typeof contentType !== "string" || contentType === "") {
    throw createError({ statusCode: 415, statusMessage: "Expected multipart content type" });
  }
  return new Promise<ParsedUploadFile[]>((resolve, reject) => {
    const maxFiles = options.maxFiles ?? MAX_UPLOAD_FILES;
    const maxFileBytes = options.maxFileBytes ?? MAX_UPLOAD_FILE_BYTES;
    const maxTotalBytes = options.maxTotalBytes ?? maxFiles * maxFileBytes;
    const parser = new Busboy({
      headers: { ...event.node.req.headers, "content-type": contentType },
      preservePath: options.preserveRelativePaths === true,
      limits: {
        files: maxFiles,
        fileSize: maxFileBytes,
        fields: 0,
        parts: maxFiles,
      },
    });
    const files: ParsedUploadFile[] = [];
    const writes: Promise<void>[] = [];
    let limitError: Error | null = null;
    let writeError: unknown = null;
    let totalSize = 0;
    let settled = false;

    const settle = (error?: unknown) => {
      if (settled) {
        return;
      }
      settled = true;
      event.node.req.off("aborted", handleAbort);
      if (error !== undefined) {
        reject(ensureError(error));
      } else {
        resolve(files);
      }
    };
    const handleAbort = () => {
      const error = createError({ statusCode: 499, statusMessage: "Upload request was aborted" });
      parser.destroy(error);
      settle(error);
    };

    parser.on("file", (fieldName, stream, filename, _encoding, mimeType) => {
      if (fieldName !== "files" || filename === "") {
        stream.resume();
        return;
      }
      let relativePath: string;
      try {
        relativePath =
          options.preserveRelativePaths === true
            ? normalizeWorkspaceUploadPath(filename)
            : basename(filename);
      } catch (error) {
        writeError ??= error;
        stream.resume();
        return;
      }
      const originalName = basename(relativePath);
      const safeName = `${randomUUID()}${extname(originalName)}`;
      const localPath = join(tempDir, safeName);
      const file: ParsedUploadFile = {
        originalName,
        mimeType: mimeType === "" ? null : mimeType,
        localPath,
        safeName,
        relativePath,
        size: 0,
      };
      stream.on("data", (chunk: Buffer) => {
        file.size += chunk.length;
        totalSize += chunk.length;
        if (totalSize > maxTotalBytes) {
          limitError ??= uploadLimitError(
            `Upload batch exceeds ${Math.round(maxTotalBytes / 1024 / 1024)} MB`,
          );
        }
      });
      stream.once("limit", () => {
        limitError = uploadLimitError(
          `Upload file exceeds ${Math.round(maxFileBytes / 1024 / 1024)} MB`,
        );
      });
      writes.push(
        writeUpload(stream, localPath).catch((error) => {
          writeError ??= error;
        }),
      );
      files.push(file);
    });
    parser.once("filesLimit", () => {
      limitError = uploadLimitError(`Upload accepts at most ${maxFiles} files`);
    });
    parser.once("partsLimit", () => {
      limitError ??= uploadLimitError(`Upload accepts at most ${maxFiles} parts`);
    });
    parser.once("error", settle);
    parser.once("finish", () => {
      void Promise.all(writes).then(() => settle(limitError ?? writeError ?? undefined));
    });
    event.node.req.once("aborted", handleAbort);
    event.node.req.pipe(parser);
  });
}

async function writeUpload(stream: BusboyFileStream, localPath: string) {
  await pipeline(stream, createWriteStream(localPath, { mode: 0o600 }));
}

function uploadLimitError(message: string) {
  return createError({ statusCode: 413, statusMessage: message });
}
