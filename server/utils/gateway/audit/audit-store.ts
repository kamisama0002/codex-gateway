import type {
  AuditEventInput,
  AuditEventRecord,
  AuditMetadata,
  AuditMetadataValue,
} from "~~/shared/types/audit";
import type { GatewayDb } from "../storage/contracts";
import { gatewayDatabase } from "../storage/database";

const SENSITIVE_METADATA_KEY = /token|secret|password|authorization|prompt|input|output|content/i;
const ALLOWED_METADATA_KEYS = new Set([
  "userId",
  "runtimeId",
  "providerId",
  "modelId",
  "requestId",
  "capabilityId",
  "projectId",
  "threadId",
  "conversationId",
  "imageVersion",
  "runtimeVersion",
  "schemaHash",
  "runtimeStatus",
  "previousStatus",
  "nextStatus",
  "status",
  "runtimeType",
  "count",
  "attemptCount",
  "durationMs",
  "latencyMs",
  "modelCount",
  "httpStatus",
  "usageInputTokens",
  "usageOutputTokens",
  "totalTokens",
]);

interface ValidatedAuditEvent {
  actorUserId: number | null;
  userId: number | null;
  action: string;
  outcome: string;
  errorCode: string | null;
  metadata: AuditMetadata;
  createdAt: string;
}

export function createAuditStore(db: GatewayDb) {
  return {
    record(input: AuditEventInput): Promise<AuditEventRecord> {
      return recordValidated(db, validateAuditInput(input));
    },

    async listForAdmin(): Promise<AuditEventRecord[]> {
      const rows = await db.many(
        "SELECT * FROM agent_audit_events ORDER BY created_at DESC, id DESC",
      );
      return rows.map(rowToAuditEvent);
    },

    async listForUser(userId: number): Promise<AuditEventRecord[]> {
      const rows = await db.many(
        "SELECT * FROM agent_audit_events WHERE user_id = ? ORDER BY created_at DESC, id DESC",
        [nullablePositiveId(userId, "userId")],
      );
      return rows.map(rowToAuditEvent);
    },

    getById(id: number): Promise<AuditEventRecord> {
      return getById(db, id);
    },
  };
}

export const auditStore = {
  record(input: AuditEventInput): Promise<AuditEventRecord> {
    const validated = validateAuditInput(input);
    return recordValidated(gatewayDatabase(), validated);
  },
  listForAdmin() {
    return createAuditStore(gatewayDatabase()).listForAdmin();
  },
  listForUser(userId: number) {
    return createAuditStore(gatewayDatabase()).listForUser(userId);
  },
};

async function recordValidated(
  db: GatewayDb,
  input: ValidatedAuditEvent,
): Promise<AuditEventRecord> {
  return await db.transaction(async (tx) => {
    const result = await tx.execute(
      `INSERT INTO agent_audit_events (
         actor_user_id, user_id, action, outcome, error_code, metadata_json, created_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        input.actorUserId,
        input.userId,
        input.action,
        input.outcome,
        input.errorCode,
        JSON.stringify(input.metadata),
        input.createdAt,
      ],
    );
    return await getById(tx, result.insertId);
  });
}

async function getById(db: GatewayDb, id: number): Promise<AuditEventRecord> {
  const row = await db.one("SELECT * FROM agent_audit_events WHERE id = ?", [id]);
  if (row === null) throw new Error(`Audit event ${id} was not recorded`);
  return rowToAuditEvent(row);
}

function validateAuditInput(input: AuditEventInput): ValidatedAuditEvent {
  return {
    actorUserId: nullablePositiveId(input.actorUserId, "actorUserId"),
    userId: nullablePositiveId(input.userId, "userId"),
    action: requiredText(input.action, "action"),
    outcome: requiredText(input.outcome, "outcome"),
    errorCode: optionalText(input.errorCode, "errorCode"),
    metadata: validateMetadata(input.metadata ?? {}),
    createdAt: input.createdAt ?? new Date().toISOString(),
  };
}

function validateMetadata(metadata: unknown): AuditMetadata {
  if (!isPlainObject(metadata)) throw new Error("Audit metadata must be a plain object");
  const validated: AuditMetadata = {};
  for (const [key, value] of Object.entries(metadata)) {
    if (SENSITIVE_METADATA_KEY.test(key)) {
      throw new Error(`Sensitive audit metadata key is not allowed: ${key}`);
    }
    if (!ALLOWED_METADATA_KEYS.has(key)) {
      throw new Error(`Audit metadata key is not allowed: ${key}`);
    }
    if (!isAuditMetadataValue(value)) {
      throw new Error(`Audit metadata value must be a scalar: ${key}`);
    }
    validated[key] = value;
  }
  return validated;
}

function rowToAuditEvent(row: Record<string, unknown>): AuditEventRecord {
  return {
    id: Number(row.id),
    actorUserId: nullableNumber(row.actor_user_id),
    userId: nullableNumber(row.user_id),
    action: String(row.action),
    outcome: String(row.outcome),
    errorCode: nullableText(row.error_code),
    metadata: parseMetadata(requiredRowText(row.metadata_json, "metadata_json")),
    createdAt: requiredRowText(row.created_at, "created_at"),
  };
}

function parseMetadata(serialized: string): AuditMetadata {
  try {
    return validateMetadata(JSON.parse(serialized));
  } catch {
    throw new Error("Stored audit metadata is invalid");
  }
}

function requiredText(value: string, name: string) {
  const text = value.trim();
  if (text === "") throw new Error(`Audit ${name} is required`);
  return text;
}

function optionalText(value: string | null | undefined, name: string) {
  if (value === null || value === undefined) return null;
  return requiredText(value, name);
}

function nullablePositiveId(value: number | null | undefined, name: string) {
  if (value === null || value === undefined) return null;
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`Audit ${name} must be a positive integer`);
  }
  return value;
}

function nullableNumber(value: unknown) {
  return value === null || value === undefined ? null : Number(value);
}

function nullableText(value: unknown) {
  if (value === null || value === undefined) return null;
  return requiredRowText(value, "text");
}

function requiredRowText(value: unknown, field: string) {
  if (typeof value !== "string") throw new Error(`Stored audit ${field} is invalid`);
  return value;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isAuditMetadataValue(value: unknown): value is AuditMetadataValue {
  return (
    value === null ||
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  );
}
