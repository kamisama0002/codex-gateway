import { describe, expect, it, vi } from "vitest";
import { SafeWebFetcher, assertPublicWebUrl } from "./url-policy";

describe("public web URL policy", () => {
  it.each([
    ["http://127.0.0.1/x", "127.0.0.1"],
    ["http://10.0.0.1/x", "10.0.0.1"],
    ["http://169.254.169.254/x", "169.254.169.254"],
    ["http://[::1]/x", "::1"],
    ["http://[fe80::1]/x", "fe80::1"],
  ])("rejects %s", async (url, address) => {
    await expect(assertPublicWebUrl(url, async () => [address])).rejects.toThrow(/public/i);
  });

  it("revalidates redirect destinations and caps response bytes", async () => {
    const resolve = vi.fn(async (hostname: string) =>
      hostname === "public.example" ? ["93.184.216.34"] : ["127.0.0.1"],
    );
    const redirecting = new SafeWebFetcher({
      resolve,
      fetch: async () =>
        new Response(null, {
          status: 302,
          headers: { location: "http://private.example/secret" },
        }),
    });
    await expect(redirecting.fetchText("https://public.example/page")).rejects.toThrow(/public/i);
    expect(resolve).toHaveBeenCalledWith("private.example");

    const oversized = new SafeWebFetcher({
      resolve,
      maxBytes: 8,
      fetch: async () => new Response("123456789"),
    });
    await expect(oversized.fetchText("https://public.example/page")).rejects.toThrow(/large/i);
  });

  it("aborts a fetch after the configured timeout", async () => {
    const fetcher = new SafeWebFetcher({
      resolve: async () => ["93.184.216.34"],
      timeoutMs: 5,
      fetch: async (_input, init) =>
        await new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => reject(new Error("request aborted")), {
            once: true,
          });
        }),
    });

    await expect(fetcher.fetchText("https://example.com/slow")).rejects.toThrow();
  });
});
