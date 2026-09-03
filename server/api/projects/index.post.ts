import { createError, readValidatedBody } from "h3";
import { defineGatewayConfigMutationHandler } from "../../utils/gateway/http/config-mutation";
import {
  isManagedRuntimeHostId,
  requireManagedWorkspaceSubpath,
} from "~~/shared/runtime/managed-runtime";
import { requireRecord } from "../../utils/gateway/http/validation/common";
import { projectCreateSchema } from "../../utils/gateway/http/validation/hosts-projects";
import { hostStore } from "../../utils/gateway/state/hosts";
import { projectStore } from "../../utils/gateway/state/projects";
import { userConfigMutationService } from "../../utils/gateway/config/user-config-mutation-service";
import { requireWorkspaceHost } from "../../utils/gateway/runtime-manager/local-workspace";
import { threadBroker } from "../../utils/gateway/runtime/broker";

export default defineGatewayConfigMutationHandler(async (event) => {
  const input = await readValidatedBody(event, (body) => projectCreateSchema.parse(body));
  if (!isManagedRuntimeHostId(input.hostId)) {
    requireRecord(hostStore.get(input.hostId), "Host not found");
    return userConfigMutationService.commit(event.context.auth!.user.id, () =>
      projectStore.create(input),
    );
  }

  let remotePath: string;
  try {
    remotePath = requireManagedWorkspaceSubpath(input.remotePath);
  } catch (error: unknown) {
    throw createError({
      statusCode: 400,
      statusMessage: error instanceof Error ? error.message : "Invalid workspace path",
    });
  }
  const host = await requireWorkspaceHost(input.hostId);
  await threadBroker.createDirectory(host, remotePath);
  return userConfigMutationService.commit(event.context.auth!.user.id, () =>
    projectStore.create({ ...input, remotePath }),
  );
});
