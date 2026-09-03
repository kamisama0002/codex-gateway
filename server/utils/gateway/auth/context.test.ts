import { createEvent } from "h3";
import { IncomingMessage, ServerResponse } from "node:http";
import { Socket } from "node:net";
import { describe, expect, it } from "vitest";
import type { AuthenticatedUser } from "./users";
import { requireAdminUser } from "./context";

describe("requireAdminUser", () => {
  it("returns the authenticated administrator and rejects ordinary users", () => {
    const adminEvent = eventFor({ id: 1, username: "admin", role: "admin" });
    const userEvent = eventFor({ id: 2, username: "user", role: "user" });

    expect(requireAdminUser(adminEvent)).toMatchObject({ id: 1, role: "admin" });
    expect(() => requireAdminUser(userEvent)).toThrow(expect.objectContaining({ statusCode: 403 }));
  });
});

function eventFor(user: AuthenticatedUser) {
  const request = new IncomingMessage(new Socket());
  const response = new ServerResponse(request);
  const event = createEvent(request, response);
  event.context.auth = { user, token: "token" };
  return event;
}
