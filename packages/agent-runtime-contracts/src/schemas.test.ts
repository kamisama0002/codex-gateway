import { describe, expect, it } from "vitest";
import { managedRuntimeEndpointSchema, runtimeBrowserStatusSchema } from "./schemas";

describe("managed Runtime browser contracts", () => {
  it("accepts a browser endpoint beside the App Server endpoint", () => {
    expect(
      managedRuntimeEndpointSchema.parse({
        runtimeId: "runtime-a",
        websocketUrl: "ws://codex-runtime-a:4500",
        browserUrl: "http://codex-runtime-a:6080",
        serviceToken: "runtime-token",
      }),
    ).toEqual({
      runtimeId: "runtime-a",
      websocketUrl: "ws://codex-runtime-a:4500",
      browserUrl: "http://codex-runtime-a:6080",
      serviceToken: "runtime-token",
    });
  });

  it("keeps the browser endpoint optional during rolling node upgrades", () => {
    expect(
      managedRuntimeEndpointSchema.parse({
        runtimeId: "runtime-a",
        websocketUrl: "ws://codex-runtime-a:4500",
        serviceToken: "runtime-token",
      }),
    ).not.toHaveProperty("browserUrl");
  });

  it.each(["not_started", "starting", "ready", "failed"] as const)(
    "accepts the %s browser lifecycle state",
    (browser) => {
      const status = browser === "not_started" ? "stopped" : "running";
      expect(runtimeBrowserStatusSchema.parse({ runtimeId: "runtime-a", status, browser })).toEqual(
        { runtimeId: "runtime-a", status, browser },
      );
    },
  );
});
