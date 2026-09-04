import { describe, expect, it } from "vitest";
import {
  authStorageKind,
  createDataOpsParentMessage,
  dataOpsParentOrigin,
  parseDataOpsEmbedUrl,
  postDataOpsParentMessage,
} from "./dataops-embed";

describe("DataOps embedded mode", () => {
  it("activates only for embedded=1 and removes the one-time ticket from the fragment", () => {
    const parsed = parseDataOpsEmbedUrl(
      "https://gateway.example.com/?embedded=1#dataops_ticket=pct_private&panel=files",
    );

    expect(parsed).toEqual({
      embedded: true,
      ticket: "pct_private",
      cleanUrl: "https://gateway.example.com/?embedded=1#panel=files",
    });
    expect(parsed.cleanUrl).not.toContain("pct_private");
    expect(parseDataOpsEmbedUrl("https://gateway.example.com/?embedded=true").embedded).toBe(false);
  });

  it("uses per-tab storage for embedded sessions", () => {
    expect(authStorageKind("standalone")).toBe("local");
    expect(authStorageKind("embedded")).toBe("session");
  });

  it("posts credential-free status messages only to the referrer origin", () => {
    const sent: Array<{ message: unknown; targetOrigin: string }> = [];
    const parent = {
      postMessage(message: unknown, targetOrigin: string) {
        sent.push({ message, targetOrigin });
      },
    };
    const message = createDataOpsParentMessage("auth-error", "dataops_auth_failed");

    postDataOpsParentMessage(parent, "https://dataops.example.com", message);

    expect(sent).toEqual([{ message, targetOrigin: "https://dataops.example.com" }]);
    expect(message).toEqual({
      source: "codex-gateway",
      type: "auth-error",
      message: "dataops_auth_failed",
    });
    expect(JSON.stringify(message)).not.toMatch(/ticket|token/i);
    expect(dataOpsParentOrigin("https://dataops.example.com/workbench")).toBe(
      "https://dataops.example.com",
    );
    expect(dataOpsParentOrigin("file:///tmp/workbench.html")).toBeNull();
    expect(dataOpsParentOrigin("not-a-url")).toBeNull();
  });
});
