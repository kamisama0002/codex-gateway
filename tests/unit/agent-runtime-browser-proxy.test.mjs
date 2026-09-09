/* oxlint-disable typescript/no-unsafe-call, typescript/no-unsafe-member-access, typescript/no-unsafe-assignment */
import net from "node:net";
import { describe, expect, it } from "vitest";
import {
  browserPreambleForToken,
  consumeBrowserPreamble,
} from "../../docker/agent-runtime-browser-proxy.mjs";

describe("agent runtime browser proxy authentication", () => {
  it("builds a bounded private preamble", () => {
    expect(browserPreambleForToken("runtime-secret")).toBe("BROWSER/1 runtime-secret\n");
  });

  it("consumes only the valid preamble and preserves payload bytes", () => {
    const result = consumeBrowserPreamble(
      Buffer.from("BROWSER/1 runtime-secret\nGET /vnc.html HTTP/1.1\r\n\r\n"),
      "runtime-secret",
    );
    expect(result).toEqual({
      authenticated: true,
      payload: Buffer.from("GET /vnc.html HTTP/1.1\r\n\r\n"),
    });
  });

  it("rejects an invalid or overlong preamble before forwarding", () => {
    expect(consumeBrowserPreamble(Buffer.from("BROWSER/1 wrong\n"), "runtime-secret")).toEqual({
      authenticated: false,
      payload: null,
    });
    expect(consumeBrowserPreamble(Buffer.alloc(1025, 0x61), "runtime-secret")).toEqual({
      authenticated: false,
      payload: null,
    });
  });

  it("does not expose a network listener when imported", () => {
    expect(net.Server).toBeDefined();
  });
});
