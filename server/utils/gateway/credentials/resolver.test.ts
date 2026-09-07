import { describe, expect, it, vi } from "vitest";
import type { CredentialTarget, DecryptedCredential } from "~~/shared/types";
import { CredentialResolver } from "./resolver";

describe("CredentialResolver", () => {
  it("maps active fields to validated runtime env and file targets", async () => {
    const credentials: DecryptedCredential[] = [
      credential({
        secret: { token: "secret-token", privateKey: "private-key" },
        mappings: [
          { field: "token", target: { type: "env", name: "BUSINESS_TOKEN" } },
          {
            field: "privateKey",
            target: { type: "file", path: "/run/codex-secrets/business-key" },
          },
        ],
      }),
    ];
    const resolver = new CredentialResolver(
      { resolveSecretsForContext: async () => credentials },
      () => Date.parse("2026-09-07T00:00:00.000Z"),
    );

    await expect(
      resolver.resolveForRuntime({ userId: 7, projectId: 10 }, ["org__business"]),
    ).resolves.toEqual([
      {
        credentialId: "cred__business",
        capabilityId: "org__business",
        version: 1,
        target: { type: "file", path: "/run/codex-secrets/business-key" },
        value: "private-key",
      },
      {
        credentialId: "cred__business",
        capabilityId: "org__business",
        version: 1,
        target: { type: "env", name: "BUSINESS_TOKEN" },
        value: "secret-token",
      },
    ]);
  });

  it("drops expired, future, and revoked credentials", async () => {
    const resolver = new CredentialResolver(
      {
        resolveSecretsForContext: async () => [
          credential({ expiresAt: "2026-09-06T00:00:00.000Z" }),
          credential({ id: "cred__future", notBefore: "2026-09-08T00:00:00.000Z" }),
          credential({ id: "cred__revoked", revokedAt: "2026-09-06T00:00:00.000Z" }),
        ],
      },
      () => Date.parse("2026-09-07T00:00:00.000Z"),
    );

    await expect(
      resolver.resolveForRuntime({ userId: 7, projectId: null }, ["org__business"]),
    ).resolves.toEqual([]);
  });

  it("issues external credentials at resolution time instead of storing a token", async () => {
    const issue = vi.fn(async () => ({
      token: "fresh-short-token",
      expiresAt: "2026-09-07T00:10:00.000Z",
    }));
    const resolver = new CredentialResolver(
      {
        resolveSecretsForContext: async () => [
          credential({
            kind: "external_issuer",
            secret: {
              issuerUrl: "https://issuer.example.test/v1/token",
              audience: "business-mcp",
            },
            mappings: [{ field: "token", target: { type: "env", name: "BUSINESS_TOKEN" } }],
          }),
        ],
      },
      () => Date.parse("2026-09-07T00:00:00.000Z"),
      { issue },
    );

    await expect(
      resolver.resolveForRuntime({ userId: 7, projectId: 10 }, ["org__business"]),
    ).resolves.toEqual([expect.objectContaining({ value: "fresh-short-token" })]);
    expect(issue).toHaveBeenCalledWith(
      {
        url: "https://issuer.example.test/v1/token",
        audience: "business-mcp",
        timeoutMs: 5_000,
      },
      { userId: 7, projectId: 10, capabilityId: "org__business" },
    );
  });

  const unsafeTargets: CredentialTarget[] = [
    { type: "env", name: "lowercase" },
    { type: "env", name: "1TOKEN" },
    { type: "file", path: "/etc/passwd" },
    { type: "file", path: "/run/codex-secrets/nested/key" },
    { type: "file", path: "/run/codex-secrets/../key" },
  ];

  it.each(unsafeTargets)("rejects an unsafe runtime target %#", async (target) => {
    const resolver = new CredentialResolver({
      resolveSecretsForContext: async () => [
        credential({ mappings: [{ field: "token", target }] }),
      ],
    });

    await expect(
      resolver.resolveForRuntime({ userId: 7, projectId: null }, ["org__business"]),
    ).rejects.toThrow(/target/i);
  });
});

function credential(overrides: Partial<DecryptedCredential> = {}): DecryptedCredential {
  return {
    id: "cred__business",
    capabilityId: "org__business",
    userId: 7,
    projectId: null,
    kind: "token",
    secret: { token: "secret-token" },
    mappings: [{ field: "token", target: { type: "env", name: "BUSINESS_TOKEN" } }],
    notBefore: null,
    expiresAt: null,
    revokedAt: null,
    version: 1,
    createdAt: "2026-09-07T00:00:00.000Z",
    updatedAt: "2026-09-07T00:00:00.000Z",
    ...overrides,
  };
}
