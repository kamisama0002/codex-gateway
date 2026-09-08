import { beforeEach, describe, expect, it } from "vitest";
import { freshMysqlTestDatabase } from "../../../../tests/mysql/helpers";
import type { GatewayDb } from "../storage/contracts";
import { migrateMysqlGatewayDatabase } from "../storage/mysql-migrations";
import { createDataOpsIntegrationRepository } from "./dataops-integration-repository";

describe("DataOpsIntegrationRepository", () => {
  let db: GatewayDb;
  let store: ReturnType<typeof createDataOpsIntegrationRepository>;

  beforeEach(async () => {
    process.env.CODEX_GATEWAY_CONFIG_SECRET = "dataops-integration-test-encryption-root";
    db = await freshMysqlTestDatabase();
    await migrateMysqlGatewayDatabase(db);
    store = createDataOpsIntegrationRepository(db);
  });

  it("stages an encrypted pending binding without exposing the secret in raw storage", async () => {
    await store.stage({
      pairingId: "pairing-1",
      dataOpsBaseUrl: "https://dinky.example.test/",
      sharedSecret: "fixture-shared-secret-with-32-bytes-minimum",
      revision: 1,
      now: "2026-09-08T00:00:00.000Z",
    });

    await expect(store.pending("pairing-1")).resolves.toMatchObject({
      pairingId: "pairing-1",
      dataOpsBaseUrl: "https://dinky.example.test",
      sharedSecret: "fixture-shared-secret-with-32-bytes-minimum",
      revision: 1,
      status: "pending",
    });
    const raw = await db.one<{ encrypted_shared_secret: string }>(
      "SELECT encrypted_shared_secret FROM platform_integrations WHERE pairing_id = ?",
      ["pairing-1"],
    );
    expect(raw?.encrypted_shared_secret).not.toContain(
      "fixture-shared-secret-with-32-bytes-minimum",
    );
  });

  it("keeps the previous active binding in grace until finalization", async () => {
    await store.stage(candidate("pairing-1", 1));
    await store.confirm("pairing-1", 1, "2026-09-08T00:10:00.000Z");
    await store.stage(candidate("pairing-2", 2));

    await expect(Promise.all([store.active(), store.pending("pairing-2")])).resolves.toEqual([
      expect.objectContaining({ pairingId: "pairing-1", status: "active", revision: 1 }),
      expect.objectContaining({ pairingId: "pairing-2", status: "pending", revision: 2 }),
    ]);

    await store.confirm("pairing-2", 2, "2026-09-08T00:20:00.000Z");

    await expect(store.acceptedForAuthentication("2026-09-08T00:15:00.000Z")).resolves.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ pairingId: "pairing-1", status: "grace" }),
        expect.objectContaining({ pairingId: "pairing-2", status: "active" }),
      ]),
    );

    await store.finalize("pairing-2", 2);
    await expect(store.acceptedForAuthentication("2026-09-08T00:15:00.000Z")).resolves.toEqual([
      expect.objectContaining({ pairingId: "pairing-2", status: "active" }),
    ]);
  });

  it("rejects confirmation with a stale revision", async () => {
    await store.stage(candidate("pairing-1", 2));
    await expect(store.confirm("pairing-1", 1, "2026-09-08T00:10:00.000Z")).rejects.toThrow(
      "integration_revision_conflict",
    );
    await expect(store.active()).resolves.toBeNull();
  });

  it("rejects a stale new pairing revision after a newer revision is active", async () => {
    await store.stage(candidate("pairing-2", 2));
    await store.confirm("pairing-2", 2, "2026-09-08T00:10:00.000Z");

    await expect(store.stage(candidate("pairing-1", 1))).rejects.toThrow(
      "integration_revision_conflict",
    );
    await expect(store.active()).resolves.toMatchObject({
      pairingId: "pairing-2",
      revision: 2,
      status: "active",
    });
  });
});

function candidate(pairingId: string, revision: number) {
  return {
    pairingId,
    dataOpsBaseUrl: "https://dinky.example.test",
    sharedSecret: "secret-" + revision + "-" + "x".repeat(32),
    revision,
    now: "2026-09-08T00:00:00.000Z",
  };
}
