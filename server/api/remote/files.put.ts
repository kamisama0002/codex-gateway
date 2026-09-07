import { createError, getHeader, getValidatedQuery, readRawBody } from "h3";
import type { RemoteFileWriteResult } from "~~/shared/types";
import { isManagedRuntimeHost } from "~~/shared/runtime/managed-runtime";
import {
  defineGatewayEventHandler,
  hostLogContext,
  setGatewayRequestLogContext,
} from "../../utils/gateway/http/errors";
import { remoteFileEtag } from "../../utils/gateway/http/remote-file-response";
import { remoteFileSchema } from "../../utils/gateway/http/validation/remote";
import { remoteFiles } from "../../utils/gateway/infra/host-services";
import { requireWorkspaceHost } from "../../utils/gateway/runtime-manager/local-workspace";
import { threadBroker } from "../../utils/gateway/runtime/broker";

const MAX_EDITABLE_FILE_BYTES = 5 * 1024 * 1024;

export default defineGatewayEventHandler(async (event): Promise<RemoteFileWriteResult> => {
  const query = await getValidatedQuery(event, (value) => remoteFileSchema.parse(value));
  const host = await requireWorkspaceHost(query.hostId);
  setGatewayRequestLogContext(event, "remote/files.put", {
    ...hostLogContext(host),
    path: query.path,
  });

  const rawBody = await readRawBody(event, false);
  const body = Buffer.isBuffer(rawBody) ? rawBody : Buffer.from(rawBody ?? "", "utf8");
  if (body.byteLength > MAX_EDITABLE_FILE_BYTES) {
    throw createError({ statusCode: 413, statusMessage: "Editable file exceeds 5 MiB" });
  }

  const force = getHeader(event, "x-codex-force-overwrite") === "true";
  const expectedEtag = getHeader(event, "if-match");
  const current = isManagedRuntimeHost(host)
    ? await threadBroker.statFile(host, query.path)
    : await remoteFiles.statRemoteFile(host, query.path, {
        maxSize: Number.MAX_SAFE_INTEGER,
      });
  const currentEtag = remoteFileEtag(current.size, current.modifiedAt);
  if (
    !force &&
    (expectedEtag === undefined || expectedEtag === "" || expectedEtag !== currentEtag)
  ) {
    throw createError({
      statusCode: 409,
      statusMessage: "Remote file changed since it was opened",
      data: {
        code: "remoteFileConflict",
        remoteEtag: currentEtag,
        remoteLastModified: new Date(current.modifiedAt).toUTCString(),
      },
    });
  }

  const written = isManagedRuntimeHost(host)
    ? await threadBroker.writeFile(host, query.path, body)
    : await remoteFiles.writeTextFile(host, query.path, body);
  return {
    etag: remoteFileEtag(written.size, written.modifiedAt),
    lastModified: new Date(written.modifiedAt).toUTCString(),
    size: written.size,
  };
});
