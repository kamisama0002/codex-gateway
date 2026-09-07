import { extname } from "node:path";
import { createError, getValidatedQuery } from "h3";
import { defineGatewayEventHandler } from "../../utils/gateway/http/errors";
import { sendRemoteFile } from "../../utils/gateway/http/remote-file-response";
import { remoteImageSchema } from "../../utils/gateway/http/validation/remote";
import { requireWorkspaceHost } from "../../utils/gateway/runtime-manager/local-workspace";

const MAX_REMOTE_IMAGE_BYTES = 12 * 1024 * 1024;

const imageMimeTypes: Record<string, string> = {
  ".avif": "image/avif",
  ".gif": "image/gif",
  ".jpeg": "image/jpeg",
  ".jpg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
};

export default defineGatewayEventHandler(async (event) => {
  const query = await getValidatedQuery(event, (body) => remoteImageSchema.parse(body));
  const host = await requireWorkspaceHost(query.hostId);

  const mimeType = imageMimeTypes[extname(query.path).toLowerCase()];
  if (mimeType === undefined) {
    throw createError({ statusCode: 415, statusMessage: "Unsupported remote image type" });
  }

  return sendRemoteFile(event, host, query.path, {
    maxSize: MAX_REMOTE_IMAGE_BYTES,
    contentType: mimeType,
    previewKind: "document",
  });
});
