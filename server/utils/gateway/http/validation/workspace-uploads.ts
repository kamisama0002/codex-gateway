import { posix } from "node:path";
import { createError } from "h3";
import { z } from "zod";

const MAX_UPLOAD_PATH_LENGTH = 2_048;
const MAX_UPLOAD_PATH_SEGMENT_LENGTH = 255;

export const workspaceUploadQuerySchema = z.object({
  hostId: z.coerce.number().int().positive(),
  projectId: z.coerce.number().int().positive(),
  overwrite: z
    .enum(["true", "false"])
    .default("false")
    .transform((value) => value === "true"),
});

export function normalizeWorkspaceUploadPath(input: string) {
  if (
    input === "" ||
    input.length > MAX_UPLOAD_PATH_LENGTH ||
    input.startsWith("/") ||
    input.includes("\\") ||
    /^[A-Za-z]:/.test(input) ||
    hasControlCharacter(input)
  ) {
    throw invalidUploadPath(input);
  }
  const segments = input.split("/");
  if (
    segments.some(
      (segment) =>
        segment === "" ||
        segment === "." ||
        segment === ".." ||
        segment.length > MAX_UPLOAD_PATH_SEGMENT_LENGTH,
    )
  ) {
    throw invalidUploadPath(input);
  }
  return segments.join("/");
}

function hasControlCharacter(value: string) {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code <= 0x1f || code === 0x7f) return true;
  }
  return false;
}

export function workspaceUploadRemotePath(projectRoot: string, relativePath: string) {
  const root = posix.normalize(projectRoot.trim());
  if (!root.startsWith("/")) {
    throw createError({
      statusCode: 400,
      statusMessage: "Project workspace path must be absolute",
    });
  }
  const safeRelativePath = normalizeWorkspaceUploadPath(relativePath);
  const target = posix.join(root, safeRelativePath);
  const prefix = root === "/" ? "/" : `${root}/`;
  if (!target.startsWith(prefix)) throw invalidUploadPath(relativePath);
  return target;
}

function invalidUploadPath(path: string) {
  return createError({
    statusCode: 400,
    statusMessage: `Invalid workspace upload path: ${path}`,
  });
}
