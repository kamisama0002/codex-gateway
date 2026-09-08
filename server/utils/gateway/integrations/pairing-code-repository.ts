import type { DbRow, GatewayDb } from "../storage/contracts";
import { gatewayDatabase } from "../storage/database";
import { DATAOPS_INTEGRATION_PROVIDER } from "./dataops-types";

interface PairingCodeRow extends DbRow {
  expires_at: string;
  created_at: string;
}

export interface CreatePairingCodeInput {
  actorUserId: number;
  codeHash: string;
  expiresAt: string;
  now: string;
}

export function createPairingCodeRepository(db: GatewayDb = gatewayDatabase()) {
  return {
    async create(input: CreatePairingCodeInput): Promise<{ expiresAt: string }> {
      validateInput(input);
      return await db.transaction(
        async (tx) => {
          await tx.execute(
            "UPDATE integration_pairing_codes SET revoked_at = ? WHERE provider = ? AND consumed_at IS NULL AND revoked_at IS NULL",
            [input.now, DATAOPS_INTEGRATION_PROVIDER],
          );
          await tx.execute(
            "INSERT INTO integration_pairing_codes (provider, code_hash, expires_at, created_by_user_id, created_at) VALUES (?, ?, ?, ?, ?)",
            [
              DATAOPS_INTEGRATION_PROVIDER,
              input.codeHash,
              input.expiresAt,
              input.actorUserId,
              input.now,
            ],
          );
          return { expiresAt: input.expiresAt };
        },
        { isolationLevel: "serializable" },
      );
    },

    async consume(codeHash: string, pairingId: string, now: string): Promise<boolean> {
      validateHash(codeHash);
      if (!/^[A-Za-z0-9_-]{8,64}$/.test(pairingId)) throw new Error("pairing_id_invalid");
      const result = await db.execute(
        "UPDATE integration_pairing_codes SET consumed_at = ?, pairing_id = ? WHERE provider = ? AND code_hash = ? AND consumed_at IS NULL AND revoked_at IS NULL AND expires_at > ?",
        [now, pairingId, DATAOPS_INTEGRATION_PROVIDER, codeHash, now],
      );
      return result.affectedRows === 1;
    },

    async revokeActive(now: string): Promise<number> {
      const result = await db.execute(
        "UPDATE integration_pairing_codes SET revoked_at = ? WHERE provider = ? AND consumed_at IS NULL AND revoked_at IS NULL",
        [now, DATAOPS_INTEGRATION_PROVIDER],
      );
      return result.affectedRows;
    },

    async activeStatus(now: string): Promise<{ expiresAt: string; createdAt: string } | null> {
      const row = await db.one<PairingCodeRow>(
        "SELECT expires_at, created_at FROM integration_pairing_codes WHERE provider = ? AND consumed_at IS NULL AND revoked_at IS NULL AND expires_at > ? ORDER BY id DESC LIMIT 1",
        [DATAOPS_INTEGRATION_PROVIDER, now],
      );
      return row === null ? null : { expiresAt: row.expires_at, createdAt: row.created_at };
    },
  };
}

function validateInput(input: CreatePairingCodeInput): void {
  if (!Number.isSafeInteger(input.actorUserId) || input.actorUserId < 1) {
    throw new Error("pairing_actor_invalid");
  }
  validateHash(input.codeHash);
  if (Number.isNaN(Date.parse(input.now)) || Date.parse(input.expiresAt) <= Date.parse(input.now)) {
    throw new Error("pairing_expiry_invalid");
  }
}

function validateHash(value: string): void {
  if (!/^[a-f0-9]{64}$/.test(value)) throw new Error("pairing_code_hash_invalid");
}
