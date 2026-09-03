import { z } from "zod";

const fuzzyFileSearchFileSchema = z
  .object({
    root: z.string().min(1),
    path: z.string().min(1),
    match_type: z.enum(["file", "directory"]),
    file_name: z.string().min(1),
    score: z.number().int().nonnegative(),
    indices: z.array(z.number().int().nonnegative()).nullable(),
  })
  .strict();

export const fuzzyFileSearchResponseSchema = z
  .object({ files: z.array(fuzzyFileSearchFileSchema) })
  .strict();

export const fsWatchResponseSchema = z.object({ path: z.string().min(1) }).strict();

export const fsChangedNotificationSchema = z
  .object({
    watchId: z.string().min(1),
    changedPaths: z.array(z.string().min(1)),
  })
  .strict();

export function parseFuzzyFileSearchResponse(value: unknown) {
  return fuzzyFileSearchResponseSchema.parse(value);
}

export const fsReadDirectoryResponseSchema = z
  .object({
    entries: z.array(
      z
        .object({
          fileName: z.string().min(1),
          isDirectory: z.boolean(),
          isFile: z.boolean(),
        })
        .strict(),
    ),
  })
  .strict();

export const fsCreateDirectoryResponseSchema = z.object({}).strict();

export function parseFsWatchResponse(value: unknown) {
  return fsWatchResponseSchema.parse(value);
}

export function parseFsReadDirectoryResponse(value: unknown) {
  return fsReadDirectoryResponseSchema.parse(value);
}

export function parseFsCreateDirectoryResponse(value: unknown) {
  return fsCreateDirectoryResponseSchema.parse(value);
}

export function fsChangedNotificationFromUnknown(value: unknown) {
  const result = fsChangedNotificationSchema.safeParse(value);
  return result.success ? result.data : null;
}
