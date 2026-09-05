import { createEvent } from "h3";
import { IncomingMessage, ServerResponse } from "node:http";
import { Socket } from "node:net";
import { describe, expect, it, vi } from "vitest";
import type { AuthenticatedUser } from "../auth/users";
import { currentGatewayMemoryState, runWithGatewayUser } from "../state/memory";
import { defineGatewayConfigMutationHandler, withUserConfigLock } from "./config-mutation";

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

  it("holds one lock across a remote side effect and its config commit", async () => {
    const user = { id: 602, username: "remote", role: "user" as const };
    const otherUser = { id: 603, username: "other", role: "user" as const };
    installLoadedUser(user.id);
    installLoadedUser(otherUser.id);
    const steps: string[] = [];
    let releaseRemote!: () => void;
    const remoteGate = new Promise<void>((resolve) => {
      releaseRemote = resolve;
    });
    const remote = withUserConfigLock(user.id, async () => {
      steps.push("remote:start");
      await remoteGate;
      steps.push("remote:config-commit");
    });
    const sameUserConfig = defineGatewayConfigMutationHandler(async () => {
      steps.push("same-user:config");
    });
    const otherUserConfig = defineGatewayConfigMutationHandler(async () => {
      steps.push("other-user:config");
    });

    const sameUser = sameUserConfig(eventFor(user));
    const other = otherUserConfig(eventFor(otherUser));
    await vi.waitFor(() => expect(steps).toContain("other-user:config"));
    expect(steps).toEqual(["remote:start", "other-user:config"]);

    releaseRemote();
    await Promise.all([remote, sameUser, other]);
    expect(steps).toEqual([
      "remote:start",
      "other-user:config",
      "remote:config-commit",
      "same-user:config",
    ]);
  });
});

function installLoadedUser(userId: number) {
  runWithGatewayUser(userId, () => {
    currentGatewayMemoryState().configLoaded = true;
    currentGatewayMemoryState().configRevision = 0;
  });
}

function eventFor(user: AuthenticatedUser) {
  const request = new IncomingMessage(new Socket());
  const event = createEvent(request, new ServerResponse(request));
  event.context.auth = { user, token: "token" };
  return event;
}
