import { getRouterParam, readValidatedBody, type H3Event } from "h3";
import { requireAdminUser } from "../../../../utils/gateway/auth/context";
import { capabilityAdministrationService } from "../../../../utils/gateway/capabilities/administration";
import {
  capabilityAssignmentMutationSchema,
  capabilityIdSchema,
} from "../../../../utils/gateway/capabilities/schemas";
import { defineGatewayEventHandler } from "../../../../utils/gateway/http/errors";

export async function setCapabilityAssignmentForEvent(
  event: H3Event,
  service: Pick<
    typeof capabilityAdministrationService,
    "setAssignment"
  > = capabilityAdministrationService,
) {
  const admin = requireAdminUser(event);
  const capabilityId = capabilityIdSchema.parse(getRouterParam(event, "id"));
  const input = await readValidatedBody(event, (body) =>
    capabilityAssignmentMutationSchema.parse(body),
  );
  return await service.setAssignment({ capabilityId, ...input }, admin.id);
}

export default defineGatewayEventHandler(
  async (event) => await setCapabilityAssignmentForEvent(event),
);
