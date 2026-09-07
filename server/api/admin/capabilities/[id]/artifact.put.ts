import { createError, getRouterParam, readRawBody, type H3Event } from "h3";
import { requireAdminUser } from "../../../../utils/gateway/auth/context";
import { auditStore } from "../../../../utils/gateway/audit/audit-store";
import { reconcileUserRuntime } from "../../../../utils/gateway/capabilities/reconciler";
import { skillArtifactWriter } from "../../../../utils/gateway/capabilities/skill-artifact-writer";
import { capabilityStore } from "../../../../utils/gateway/capabilities/store";
import { capabilityIdSchema } from "../../../../utils/gateway/capabilities/schemas";
import { defineGatewayEventHandler } from "../../../../utils/gateway/http/errors";

const MAX_SKILL_BYTES = 1024 * 1024;

export async function uploadSkillArtifactForEvent(
  event: H3Event,
  writer: Pick<typeof skillArtifactWriter, "write"> = skillArtifactWriter,
) {
  const admin = requireAdminUser(event);
  const capabilityId = capabilityIdSchema.parse(getRouterParam(event, "id"));
  const rawBody = await readRawBody(event, false);
  const content = Buffer.isBuffer(rawBody) ? rawBody : Buffer.from(rawBody ?? "", "utf8");
  if (content.byteLength > MAX_SKILL_BYTES) {
    throw createError({ statusCode: 413, statusMessage: "Skill artifact exceeds 1 MiB" });
  }
  const artifact = await writer.write(capabilityId, content);
  await auditStore.record({
    actorUserId: admin.id,
    action: "capability.artifact.write",
    outcome: "success",
    metadata: { capabilityId, count: artifact.sizeBytes },
  });
  const assignments = await capabilityStore.listAssignments(capabilityId);
  const syncs = await Promise.all(
    assignments.map(async (assignment) => {
      try {
        return await reconcileUserRuntime({
          userId: assignment.userId,
          projectId: assignment.projectId,
          reason: "assignmentChanged",
        });
      } catch {
        return { status: "pending" as const, safeError: "runtime_unavailable" };
      }
    }),
  );
  return { artifact, syncs };
}

export default defineGatewayEventHandler(async (event) => await uploadSkillArtifactForEvent(event));
