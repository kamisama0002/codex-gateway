import { createError, getQuery, type H3Event } from "h3";
import { requireAdminUser } from "../../../utils/gateway/auth/context";
import { capabilitySyncStore } from "../../../utils/gateway/capabilities/sync-store";
import { defineGatewayEventHandler } from "../../../utils/gateway/http/errors";

export async function listRuntimeSyncsForEvent(
  event: H3Event,
  store: { list(userId?: number): Promise<unknown[]> } = capabilitySyncStore,
) {
  requireAdminUser(event);
  const rawUserId = getQuery(event).userId;
  if (rawUserId === undefined) return await store.list();
  const userId = Number(rawUserId);
  if (!Number.isInteger(userId) || userId <= 0) {
    throw createError({ statusCode: 400, statusMessage: "Invalid user ID" });
  }
  return await store.list(userId);
}

export default defineGatewayEventHandler(async (event) => await listRuntimeSyncsForEvent(event));
