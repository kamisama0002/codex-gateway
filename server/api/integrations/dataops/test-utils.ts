import { createEvent } from "h3";
import { IncomingMessage, ServerResponse } from "node:http";
import { Socket } from "node:net";
import type { AuthenticatedUser } from "../../../utils/gateway/auth/users";

export function eventWithJson(value: unknown, authorization?: string) {
  const request = new IncomingMessage(new Socket());
  const body = JSON.stringify(value);
  request.method = "POST";
  request.headers["content-type"] = "application/json";
  request.headers["content-length"] = String(Buffer.byteLength(body));
  if (authorization !== undefined) request.headers.authorization = authorization;
  request.push(body);
  request.push(null);
  return createEvent(request, new ServerResponse(request));
}

export function eventForUser(user: AuthenticatedUser) {
  const event = eventWithJson({});
  event.context.auth = { user, token: "local-admin-token" };
  return event;
}

export const localAdmin: AuthenticatedUser = { id: 1, username: "admin", role: "admin" };

export const dataOpsAdmin: AuthenticatedUser = {
  id: 2,
  username: "dataops-admin",
  role: "admin",
  dataOps: {
    provider: "dataops",
    externalSubject: "dataops:1:2",
    tenantId: 1,
    dataOpsUserId: 2,
    projectId: 4,
    authzVersion: 1,
  },
};
