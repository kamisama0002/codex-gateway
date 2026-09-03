import { createError, getRouterParam, readValidatedBody } from "h3";
import { defineGatewayConfigMutationHandler } from "../../utils/gateway/http/config-mutation";
import {
  isManagedRuntimeHostId,
  isManagedRuntimeProjectId,
} from "~~/shared/runtime/managed-runtime";
import { requireRecord } from "../../utils/gateway/http/validation/common";
import { projectUpdateSchema } from "../../utils/gateway/http/validation/hosts-projects";
import { hostStore } from "../../utils/gateway/state/hosts";
import { projectStore } from "../../utils/gateway/state/projects";
import { userConfigMutationService } from "../../utils/gateway/config/user-config-mutation-service";

export default defineGatewayConfigMutationHandler(async (event) => {
  const id = Number(getRouterParam(event, "id"));
  if (isManagedRuntimeProjectId(id)) {
    throw createError({
      statusCode: 400,
      statusMessage: "The local Agent workspace cannot be edited",
    });
  }
  const input = await readValidatedBody(event, (body) => projectUpdateSchema.parse(body));
  if (!isManagedRuntimeHostId(input.hostId)) {
    requireRecord(hostStore.get(input.hostId), "Host not found");
  }
  return userConfigMutationService.commit(event.context.auth!.user.id, () =>
    requireRecord(projectStore.update(id, input), "Project not found"),
  );
});
