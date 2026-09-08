import { createEvent } from "h3";
import { IncomingMessage, ServerResponse } from "node:http";
import { Socket } from "node:net";
import { describe, expect, it } from "vitest";
import authMiddleware from "./auth";

describe("Gateway authentication middleware", () => {
  it.each([
    "/api/integrations/dataops/pair",
    "/api/integrations/dataops/pair/pairing-id/confirm",
    "/api/integrations/dataops/mcp-credentials",
  ])("defers DataOps service authentication for %s", async (url) => {
    await expect(authMiddleware(eventFor(url))).resolves.toBeUndefined();
  });
});

function eventFor(url: string) {
  const request = new IncomingMessage(new Socket());
  request.method = "POST";
  request.url = url;
  return createEvent(request, new ServerResponse(request));
}
