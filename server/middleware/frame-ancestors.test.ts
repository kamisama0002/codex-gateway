import { createEvent } from "h3";
import { IncomingMessage, ServerResponse } from "node:http";
import { Socket } from "node:net";
import { describe, expect, it } from "vitest";
import { applyFrameAncestorsHeader, frameAncestorsPolicy } from "./frame-ancestors";

describe("DataOps frame ancestors", () => {
  it("normalizes and deduplicates configured HTTP origins", () => {
    expect(
      frameAncestorsPolicy(
        "https://dataops.example.com/, http://localhost:8000 https://dataops.example.com",
      ),
    ).toBe("frame-ancestors 'self' https://dataops.example.com http://localhost:8000");
  });

  it.each([
    "ftp://dataops.example.com",
    "https://user:dataops.example.com",
    "https://dataops.example.com/workbench",
    "https://*.example.com",
  ])("rejects invalid frame ancestor %s", (value) => {
    expect(() => frameAncestorsPolicy(value)).toThrow("Invalid DataOps allowed origin");
  });

  it("sets the policy on HTML navigation responses only", () => {
    const html = eventWithAccept("text/html,application/xhtml+xml");
    const api = eventWithAccept("application/json");

    applyFrameAncestorsHeader(html.event, "http://localhost:8000");
    applyFrameAncestorsHeader(api.event, "http://localhost:8000");

    expect(html.response.getHeader("content-security-policy")).toBe(
      "frame-ancestors 'self' http://localhost:8000",
    );
    expect(api.response.getHeader("content-security-policy")).toBeUndefined();
  });
});

function eventWithAccept(accept: string) {
  const request = new IncomingMessage(new Socket());
  request.method = "GET";
  request.url = "/";
  request.headers.accept = accept;
  const response = new ServerResponse(request);
  return { event: createEvent(request, response), response };
}
