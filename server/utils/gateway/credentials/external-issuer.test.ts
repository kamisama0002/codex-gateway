import { describe, expect, it, vi } from "vitest";
import { ExternalCredentialIssuer } from "./external-issuer";

describe("ExternalCredentialIssuer", () => {
  it("posts bounded context to an administrator-allowed HTTPS origin", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(async () =>
      Response.json({ token: "short-token", expiresAt: "2026-09-07T00:10:00.000Z" }),
    );
    const issuer = new ExternalCredentialIssuer({
      allowedOrigins: ["https://issuer.example.test"],
      fetch,
      now: () => Date.parse("2026-09-07T00:00:00.000Z"),
    });

    await expect(
      issuer.issue(
        {
          url: "https://issuer.example.test/v1/token",
          audience: "business-mcp",
          timeoutMs: 2_000,
        },
        { userId: 7, projectId: 10, capabilityId: "org__business" },
      ),
    ).resolves.toEqual({ token: "short-token", expiresAt: "2026-09-07T00:10:00.000Z" });
    expect(fetch.mock.calls[0]?.[0]).toBe("https://issuer.example.test/v1/token");
    expect(fetch.mock.calls[0]?.[1]).toMatchObject({
      method: "POST",
      redirect: "manual",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        audience: "business-mcp",
        capabilityId: "org__business",
        projectId: 10,
        userId: 7,
      }),
    });
  });

  it("rejects non-HTTPS, unlisted origins, redirects, large bodies, and near-expiry tokens", async () => {
    const issuer = new ExternalCredentialIssuer({
      allowedOrigins: ["https://issuer.example.test"],
      fetch: async (url) => {
        const href = requestUrl(url);
        if (href.includes("redirect")) {
          return new Response(null, { status: 302, headers: { location: "https://other.test" } });
        }
        if (href.includes("large")) return new Response("x".repeat(70_000));
        return Response.json({ token: "short", expiresAt: "2026-09-07T00:00:30.000Z" });
      },
      now: () => Date.parse("2026-09-07T00:00:00.000Z"),
    });
    const context = { userId: 7, projectId: null, capabilityId: "org__business" };

    for (const url of [
      "http://issuer.example.test/token",
      "https://other.example.test/token",
      "https://issuer.example.test/redirect",
      "https://issuer.example.test/large",
      "https://issuer.example.test/near-expiry",
    ]) {
      await expect(
        issuer.issue({ url, audience: "business-mcp", timeoutMs: 1_000 }, context),
      ).rejects.toThrow();
    }
  });
});

function requestUrl(value: string | URL | Request) {
  if (typeof value === "string") return value;
  return value instanceof URL ? value.href : value.url;
}
