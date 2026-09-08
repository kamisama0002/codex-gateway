import { z } from "zod";
import type {
  CapabilityContext,
  CredentialCreateInput,
  CredentialDescriptor,
  DecryptedCredential,
} from "~~/shared/types";
import { capabilityIdSchema } from "../capabilities/schemas";
import type { GatewayDb } from "../storage/contracts";
import { decryptJson, encryptJson } from "../storage/crypto";
import { gatewayDatabase } from "../storage/database";
import {
  credentialIdSchema,
  credentialKindSchema,
  parseCredentialCreateInput,
  parseCredentialMappings,
  parseCredentialSecret,
} from "./schemas";

const encryptedPayloadSchema = z
  .object({
    binding: z
      .object({
        id: credentialIdSchema,
        capabilityId: capabilityIdSchema,
        userId: z.number().int().positive(),
        projectId: z.number().int().positive().nullable(),
        kind: credentialKindSchema,
        version: z.number().int().positive(),
      })
      .strict(),
    secret: z.record(z.string(), z.string()),
  })
  .strict();

export interface CredentialStore {
  create(input: CredentialCreateInput): Promise<CredentialDescriptor>;
  upsert(input: CredentialCreateInput): Promise<CredentialDescriptor>;
  get(id: string): Promise<CredentialDescriptor | null>;
  list(userId?: number): Promise<CredentialDescriptor[]>;
  rotate(id: string, secret: Record<string, string>): Promise<CredentialDescriptor>;
  revoke(id: string): Promise<CredentialDescriptor>;
  resolveSecretsForContext(
    context: CapabilityContext,
    capabilityIds: string[],
  ): Promise<DecryptedCredential[]>;
}

export function createCredentialStore(
  db: GatewayDb,
  now: () => string = () => new Date().toISOString(),
): CredentialStore {
  return {
    async create(input) {
      const credential = parseCredentialCreateInput(input);
      const timestamp = now();
      const encrypted = encryptedCredential(credential, 1);
      await db.execute(
        `INSERT INTO credentials (
           id, capability_id, user_id, project_id, kind, encrypted_payload, mappings_json,
           not_before, expires_at, revoked_at, version, created_at, updated_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, 1, ?, ?)`,
        [
          credential.id,
          credential.capabilityId,
          credential.userId,
          credential.projectId,
          credential.kind,
          encrypted,
          JSON.stringify(credential.mappings),
          credential.notBefore,
          credential.expiresAt,
          timestamp,
          timestamp,
        ],
      );
      return await requiredDescriptor(db, credential.id);
    },

    async upsert(input) {
      const credential = parseCredentialCreateInput(input);
      return await db.transaction(async (tx) => {
        const row = await tx.one("SELECT * FROM credentials WHERE id = ? FOR UPDATE", [
          credential.id,
        ]);
        if (row === null) {
          const timestamp = now();
          await tx.execute(
            `INSERT INTO credentials (
               id, capability_id, user_id, project_id, kind, encrypted_payload, mappings_json,
               not_before, expires_at, revoked_at, version, created_at, updated_at
             ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, 1, ?, ?)`,
            [
              credential.id,
              credential.capabilityId,
              credential.userId,
              credential.projectId,
              credential.kind,
              encryptedCredential(credential, 1),
              JSON.stringify(credential.mappings),
              credential.notBefore,
              credential.expiresAt,
              timestamp,
              timestamp,
            ],
          );
          return await requiredDescriptor(tx, credential.id);
        }
        const current = rowToDescriptor(row);
        if (
          current.capabilityId !== credential.capabilityId ||
          current.userId !== credential.userId ||
          current.projectId !== credential.projectId ||
          current.kind !== credential.kind
        ) {
          throw new Error("Credential binding does not match its database scope");
        }
        const version = current.version + 1;
        await tx.execute(
          `UPDATE credentials SET encrypted_payload = ?, mappings_json = ?, not_before = ?,
             expires_at = ?, revoked_at = NULL, version = ?, updated_at = ? WHERE id = ?`,
          [
            encryptedCredential(credential, version),
            JSON.stringify(credential.mappings),
            credential.notBefore,
            credential.expiresAt,
            version,
            now(),
            credential.id,
          ],
        );
        return await requiredDescriptor(tx, credential.id);
      });
    },

    async get(id) {
      const row = await db.one("SELECT * FROM credentials WHERE id = ?", [
        credentialIdSchema.parse(id),
      ]);
      return row === null ? null : rowToDescriptor(row);
    },

    async list(userId) {
      const rows =
        userId === undefined
          ? await db.many("SELECT * FROM credentials ORDER BY user_id ASC, id ASC")
          : await db.many("SELECT * FROM credentials WHERE user_id = ? ORDER BY id ASC", [
              positiveId(userId, "user ID"),
            ]);
      return rows.map(rowToDescriptor);
    },

    async rotate(id, secret) {
      const credentialId = credentialIdSchema.parse(id);
      return await db.transaction(async (tx) => {
        const row = await tx.one("SELECT * FROM credentials WHERE id = ? FOR UPDATE", [
          credentialId,
        ]);
        if (row === null) throw new Error("Credential not found");
        const current = rowToDescriptor(row);
        if (current.revokedAt !== null) throw new Error("Credential is revoked");
        const normalizedSecret = parseCredentialSecret(current.kind, secret, current.mappings);
        const version = current.version + 1;
        const encrypted = encryptedCredential(
          {
            ...current,
            secret: normalizedSecret,
          },
          version,
        );
        await tx.execute(
          `UPDATE credentials SET encrypted_payload = ?, version = ?, updated_at = ?
           WHERE id = ?`,
          [encrypted, version, now(), credentialId],
        );
        return await requiredDescriptor(tx, credentialId);
      });
    },

    async revoke(id) {
      const credentialId = credentialIdSchema.parse(id);
      await db.execute(
        `UPDATE credentials SET revoked_at = COALESCE(revoked_at, ?), updated_at = ?
         WHERE id = ?`,
        [now(), now(), credentialId],
      );
      return await requiredDescriptor(db, credentialId);
    },

    async resolveSecretsForContext(context, capabilityIds) {
      const scope = normalizeContext(context);
      const ids = [...new Set(capabilityIds.map((id) => capabilityIdSchema.parse(id)))].sort();
      if (ids.length === 0) return [];
      const placeholders = ids.map(() => "?").join(", ");
      const rows = await db.many(
        `SELECT * FROM credentials
         WHERE user_id = ?
           AND revoked_at IS NULL
           AND (project_id IS NULL OR project_id = ?)
           AND capability_id IN (${placeholders})
         ORDER BY id ASC`,
        [scope.userId, scope.projectId, ...ids],
      );
      return rows.map(rowToDecryptedCredential);
    },
  };
}

export const credentialStore: CredentialStore = {
  create(input) {
    return createCredentialStore(gatewayDatabase()).create(input);
  },
  upsert(input) {
    return createCredentialStore(gatewayDatabase()).upsert(input);
  },
  get(id) {
    return createCredentialStore(gatewayDatabase()).get(id);
  },
  list(userId) {
    return createCredentialStore(gatewayDatabase()).list(userId);
  },
  rotate(id, secret) {
    return createCredentialStore(gatewayDatabase()).rotate(id, secret);
  },
  revoke(id) {
    return createCredentialStore(gatewayDatabase()).revoke(id);
  },
  resolveSecretsForContext(context, capabilityIds) {
    return createCredentialStore(gatewayDatabase()).resolveSecretsForContext(
      context,
      capabilityIds,
    );
  },
};

function encryptedCredential(
  credential: Pick<
    DecryptedCredential,
    "id" | "capabilityId" | "userId" | "projectId" | "kind" | "secret"
  >,
  version: number,
) {
  return encryptJson({
    binding: {
      id: credential.id,
      capabilityId: credential.capabilityId,
      userId: credential.userId,
      projectId: credential.projectId,
      kind: credential.kind,
      version,
    },
    secret: credential.secret,
  });
}

function rowToDecryptedCredential(row: Record<string, unknown>): DecryptedCredential {
  const descriptor = rowToDescriptor(row);
  const payload = encryptedPayloadSchema.parse(
    decryptJson(requiredText(row.encrypted_payload, "encrypted_payload")),
  );
  if (
    payload.binding.id !== descriptor.id ||
    payload.binding.capabilityId !== descriptor.capabilityId ||
    payload.binding.userId !== descriptor.userId ||
    payload.binding.projectId !== descriptor.projectId ||
    payload.binding.kind !== descriptor.kind ||
    payload.binding.version !== descriptor.version
  ) {
    throw new Error("Credential binding does not match its database scope");
  }
  return {
    ...descriptor,
    secret: parseCredentialSecret(descriptor.kind, payload.secret, descriptor.mappings),
  };
}

function rowToDescriptor(row: Record<string, unknown>): CredentialDescriptor {
  return {
    id: credentialIdSchema.parse(row.id),
    capabilityId: capabilityIdSchema.parse(row.capability_id),
    userId: positiveId(Number(row.user_id), "user ID"),
    projectId: nullablePositiveId(row.project_id, "project ID"),
    kind: credentialKindSchema.parse(row.kind),
    mappings: parseCredentialMappings(parseStoredJson(row.mappings_json)),
    notBefore: nullableTimestamp(row.not_before),
    expiresAt: nullableTimestamp(row.expires_at),
    revokedAt: nullableTimestamp(row.revoked_at),
    version: positiveId(Number(row.version), "credential version"),
    createdAt: requiredText(row.created_at, "created_at"),
    updatedAt: requiredText(row.updated_at, "updated_at"),
  };
}

async function requiredDescriptor(db: GatewayDb, id: string) {
  const row = await db.one("SELECT * FROM credentials WHERE id = ?", [id]);
  if (row === null) throw new Error("Credential not found");
  return rowToDescriptor(row);
}

function normalizeContext(context: CapabilityContext) {
  return {
    userId: positiveId(context.userId, "user ID"),
    projectId: nullablePositiveId(context.projectId, "project ID"),
  };
}

function positiveId(value: number, label: string) {
  if (!Number.isInteger(value) || value <= 0) throw new Error(`Invalid ${label}`);
  return value;
}

function nullablePositiveId(value: unknown, label: string) {
  return value === null ? null : positiveId(Number(value), label);
}

function requiredText(value: unknown, label: string) {
  if (typeof value !== "string" || value === "") throw new Error(`Invalid ${label}`);
  return value;
}

function nullableTimestamp(value: unknown) {
  if (value === null) return null;
  if (typeof value !== "string" || !Number.isFinite(Date.parse(value))) {
    throw new Error("Invalid credential timestamp");
  }
  return value;
}

function parseStoredJson(value: unknown) {
  if (typeof value !== "string") throw new Error("Invalid stored JSON");
  return JSON.parse(value) as unknown;
}
