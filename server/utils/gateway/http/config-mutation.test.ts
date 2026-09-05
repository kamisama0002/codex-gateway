import { createEvent } from "h3";
import { IncomingMessage, ServerResponse } from "node:http";
import { Socket } from "node:net";
import { describe, expect, it } from "vitest";
import type { AuthenticatedUser } from "../auth/users";
import { currentGatewayMemoryState, runWithGatewayUser } from "../state/memory";
import { defineGatewayConfigMutationHandler } from "./config-mutation";

describe("defineGatewayConfigMutationHandler", () => {
  it("keeps async config mutations serialized per user", async () => {
    const user = { id: 601, username: "serialized", role: "user" as const };
    runWithGatewayUser(user.id, () => {
      currentGatewayMemoryState().configLoaded = true;
      currentGatewayMemoryState().configRevision = 0;
    });
    let releaseFirst!: () => void;
    const firstGate = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    let active = 0;
    let maximumActive = 0;
    let calls = 0;
    const handler = defineGatewayConfigMutationHandler(async () => {
      calls += 1;
      active += 1;
      maximumActive = Math.max(maximumActive, active);
      if (calls === 1) await firstGate;
      active -= 1;
      return calls;
    });

    const first = handler(eventFor(user));
    await Promise.resolve();
    const second = handler(eventFor(user));
    await Promise.resolve();
    expect(calls).toBe(1);

    releaseFirst();
    await expect(Promise.all([first, second])).resolves.toEqual([1, 2]);
    expect(maximumActive).toBe(1);
  });
});

function eventFor(user: AuthenticatedUser) {
  const request = new IncomingMessage(new Socket());
  const event = createEvent(request, new ServerResponse(request));
  event.context.auth = { user, token: "token" };
  return event;
}
