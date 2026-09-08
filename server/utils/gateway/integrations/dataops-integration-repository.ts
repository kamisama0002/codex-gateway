import { decryptJson, encryptJson } from "../storage/crypto";
import type { GatewayDb } from "../storage/contracts";
import { gatewayDatabase } from "../storage/database";
import { recordFromUnknown } from "~~/shared/utils/records";
import {
  DATAOPS_INTEGRATION_PROVIDER,
  type DataOpsBindingStatus,
  type DataOpsIntegrationRow,
  type DataOpsIntegrationSecret,
  normalizeDataOpsBaseUrl,
  positiveSafeRevision,
  type StageDataOpsIntegrationInput,
} from "./dataops-types";

export class DataOpsIntegrationRevisionConflictError extends Error {
  readonly code = "integration_revision_conflict";

  constructor() {
    super("integration_revision_conflict");
    this.name = "DataOpsIntegrationRevisionConflictError";
  }
}

export function createDataOpsIntegrationRepository(db: GatewayDb = gatewayDatabase()) {
  return {
    async active(): Promise<DataOpsIntegrationSecret | null> {
      return mapRow(
        await db.one<DataOpsIntegrationRow>(
          "SELECT * FROM platform_integrations WHERE provider = ? AND status = 'active' ORDER BY revision DESC LIMIT 1",
          [DATAOPS_INTEGRATION_PROVIDER],
        ),
      );
    },

    async acceptedForAuthentication(now: string): Promise<DataOpsIntegrationSecret[]> {
      const rows = await db.many<DataOpsIntegrationRow>(
        "SELECT * FROM platform_integrations WHERE provider = ? AND (status = 'active' OR (status = 'grace' AND grace_expires_at > ?)) ORDER BY CASE status WHEN 'active' THEN 0 ELSE 1 END, revision DESC",
        [DATAOPS_INTEGRATION_PROVIDER, now],
      );
      return rows.map(requiredMappedRow);
    },

    async pending(pairingId: string): Promise<DataOpsIntegrationSecret | null> {
      return mapRow(
        await db.one<DataOpsIntegrationRow>(
          "SELECT * FROM platform_integrations WHERE provider = ? AND pairing_id = ? AND status = 'pending'",
          [DATAOPS_INTEGRATION_PROVIDER, pairingId],
        ),
      );
    },

    async stage(input: StageDataOpsIntegrationInput): Promise<DataOpsIntegrationSecret> {
      const normalized = validateStageInput(input);
      return await db.transaction(
        async (tx) => {
          const existing = await tx.one<DataOpsIntegrationRow>(
            "SELECT * FROM platform_integrations WHERE pairing_id = ? FOR UPDATE",
            [normalized.pairingId],
          );
          if (existing !== null) {
            const mapped = requiredMappedRow(existing);
            if (
              mapped.status === "pending" &&
              mapped.revision === normalized.revision &&
              mapped.dataOpsBaseUrl === normalized.dataOpsBaseUrl &&
              mapped.sharedSecret === normalized.sharedSecret
            ) {
              return mapped;
            }
            throw new DataOpsIntegrationRevisionConflictError();
          }
          if (normalized.revision <= (await providerHighWaterRevision(tx))) {
            throw new DataOpsIntegrationRevisionConflictError();
          }
          await tx.execute(
            "UPDATE platform_integrations SET status = 'retired', updated_at = ? WHERE provider = ? AND status = 'pending'",
            [normalized.now, DATAOPS_INTEGRATION_PROVIDER],
          );
          await tx.execute(
            "INSERT INTO platform_integrations (provider, pairing_id, base_url, encrypted_shared_secret, status, revision, created_at, updated_at) VALUES (?, ?, ?, ?, 'pending', ?, ?, ?)",
            [
              DATAOPS_INTEGRATION_PROVIDER,
              normalized.pairingId,
              normalized.dataOpsBaseUrl,
              encryptJson({ sharedSecret: normalized.sharedSecret }),
              normalized.revision,
              normalized.now,
              normalized.now,
            ],
          );
          return requiredMappedRow(
            await tx.one<DataOpsIntegrationRow>(
              "SELECT * FROM platform_integrations WHERE pairing_id = ?",
              [normalized.pairingId],
            ),
          );
        },
        { isolationLevel: "serializable" },
      );
    },

    async confirm(
      pairingId: string,
      revision: number,
      graceExpiresAt: string,
    ): Promise<DataOpsIntegrationSecret> {
      validateIdentity(pairingId, revision);
      if (Number.isNaN(Date.parse(graceExpiresAt)))
        throw new Error("integration_timestamp_invalid");
      return await db.transaction(
        async (tx) => {
          const row = await tx.one<DataOpsIntegrationRow>(
            "SELECT * FROM platform_integrations WHERE pairing_id = ? FOR UPDATE",
            [pairingId],
          );
          if (row === null || positiveSafeRevision(row.revision) !== revision) {
            throw new DataOpsIntegrationRevisionConflictError();
          }
          if (row.status === "active") return requiredMappedRow(row);
          if (row.status !== "pending") throw new DataOpsIntegrationRevisionConflictError();
          if (revision !== (await providerHighWaterRevision(tx))) {
            throw new DataOpsIntegrationRevisionConflictError();
          }
          const now = new Date().toISOString();
          await tx.execute(
            "UPDATE platform_integrations SET status = 'retired', updated_at = ? WHERE provider = ? AND status = 'grace'",
            [now, DATAOPS_INTEGRATION_PROVIDER],
          );
          await tx.execute(
            "UPDATE platform_integrations SET status = 'grace', grace_expires_at = ?, updated_at = ? WHERE provider = ? AND status = 'active'",
            [graceExpiresAt, now, DATAOPS_INTEGRATION_PROVIDER],
          );
          await tx.execute(
            "UPDATE platform_integrations SET status = 'active', grace_expires_at = NULL, updated_at = ? WHERE pairing_id = ? AND status = 'pending'",
            [now, pairingId],
          );
          return requiredMappedRow(
            await tx.one<DataOpsIntegrationRow>(
              "SELECT * FROM platform_integrations WHERE pairing_id = ?",
              [pairingId],
            ),
          );
        },
        { isolationLevel: "serializable" },
      );
    },

    async finalize(pairingId: string, revision: number): Promise<DataOpsIntegrationSecret> {
      validateIdentity(pairingId, revision);
      return await db.transaction(
        async (tx) => {
          const row = await tx.one<DataOpsIntegrationRow>(
            "SELECT * FROM platform_integrations WHERE pairing_id = ? FOR UPDATE",
            [pairingId],
          );
          if (
            row === null ||
            row.status !== "active" ||
            positiveSafeRevision(row.revision) !== revision
          ) {
            throw new DataOpsIntegrationRevisionConflictError();
          }
          await tx.execute(
            "UPDATE platform_integrations SET status = 'retired', updated_at = ? WHERE provider = ? AND status = 'grace'",
            [new Date().toISOString(), DATAOPS_INTEGRATION_PROVIDER],
          );
          return requiredMappedRow(row);
        },
        { isolationLevel: "serializable" },
      );
    },
  };
}

async function providerHighWaterRevision(db: GatewayDb): Promise<number> {
  const row = await db.one<{ revision: number | bigint | string }>(
    "SELECT revision FROM platform_integrations WHERE provider = ? ORDER BY revision DESC LIMIT 1 FOR UPDATE",
    [DATAOPS_INTEGRATION_PROVIDER],
  );
  return row === null ? 0 : positiveSafeRevision(row.revision);
}

function validateStageInput(input: StageDataOpsIntegrationInput): StageDataOpsIntegrationInput {
  validateIdentity(input.pairingId, input.revision);
  if (input.sharedSecret.trim().length < 32) throw new Error("integration_shared_secret_invalid");
  if (Number.isNaN(Date.parse(input.now))) throw new Error("integration_timestamp_invalid");
  return { ...input, dataOpsBaseUrl: normalizeDataOpsBaseUrl(input.dataOpsBaseUrl) };
}

function validateIdentity(pairingId: string, revision: number): void {
  if (!/^[A-Za-z0-9_-]{8,64}$/.test(pairingId)) throw new Error("pairing_id_invalid");
  positiveSafeRevision(revision);
}

function mapRow(row: DataOpsIntegrationRow | null): DataOpsIntegrationSecret | null {
  return row === null ? null : requiredMappedRow(row);
}

function requiredMappedRow(row: DataOpsIntegrationRow | null): DataOpsIntegrationSecret {
  if (row === null) throw new Error("integration_row_missing");
  const secret = recordFromUnknown(decryptJson(row.encrypted_shared_secret));
  if (
    secret === null ||
    typeof secret.sharedSecret !== "string" ||
    secret.sharedSecret.length < 32
  ) {
    throw new Error("integration_shared_secret_invalid");
  }
  return {
    id: positiveInteger(row.id),
    pairingId: row.pairing_id,
    dataOpsBaseUrl: row.base_url,
    sharedSecret: secret.sharedSecret,
    status: storedStatus(row.status),
    revision: positiveSafeRevision(row.revision),
    graceExpiresAt: row.grace_expires_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function storedStatus(value: string): DataOpsBindingStatus {
  if (value === "pending" || value === "active" || value === "grace" || value === "retired") {
    return value;
  }
  throw new Error("integration_status_invalid");
}

function positiveInteger(value: unknown): number {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < 1) throw new Error("integration_id_invalid");
  return number;
}
