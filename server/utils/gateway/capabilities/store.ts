import type {
  CapabilityArtifact,
  CapabilityArtifactInput,
  CapabilityAssignment,
  CapabilityAssignmentInput,
  CapabilityContext,
  CapabilityCreateInput,
  CapabilityDefinition,
  CapabilityUpdateInput,
} from "~~/shared/types";
import type { GatewayDb } from "../storage/contracts";
import { gatewayDatabase } from "../storage/database";
import {
  capabilityIdSchema,
  capabilityVersionSchema,
  parseCapabilityArtifactInput,
  parseCapabilityCreateInput,
  parseCapabilityUpdateInput,
  type NormalizedCapabilityCreateInput,
} from "./schemas";

export interface CapabilityStore {
  create(input: CapabilityCreateInput): Promise<CapabilityDefinition>;
  get(id: string): Promise<CapabilityDefinition | null>;
  list(): Promise<CapabilityDefinition[]>;
  update(id: string, input: CapabilityUpdateInput): Promise<CapabilityDefinition>;
  delete(id: string): Promise<boolean>;
  upsertArtifact(input: CapabilityArtifactInput): Promise<CapabilityArtifact>;
  getArtifact(capabilityId: string, version: string): Promise<CapabilityArtifact | null>;
  assign(input: CapabilityAssignmentInput): Promise<CapabilityAssignment>;
  unassign(input: CapabilityAssignmentInput): Promise<boolean>;
  listAssignments(capabilityId: string): Promise<CapabilityAssignment[]>;
  listDesiredForContext(context: CapabilityContext): Promise<CapabilityDefinition[]>;
}

export function createCapabilityStore(db: GatewayDb): CapabilityStore {
  return {
    async create(input) {
      const definition = parseCapabilityCreateInput(input);
      const now = new Date().toISOString();
      await db.execute(
        `INSERT INTO capability_definitions (
           id, kind, display_name, description, version, source_json, config_json,
           sensitive_fields_json, enabled, created_by_user_id, created_at, updated_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        definitionParams(definition, now),
      );
      return await requiredDefinition(db, definition.id);
    },

    async get(id) {
      const row = await db.one("SELECT * FROM capability_definitions WHERE id = ?", [
        capabilityIdSchema.parse(id),
      ]);
      return row === null ? null : rowToDefinition(row);
    },

    async list() {
      const rows = await db.many("SELECT * FROM capability_definitions ORDER BY id ASC");
      return rows.map(rowToDefinition);
    },

    async update(id, input) {
      const capabilityId = capabilityIdSchema.parse(id);
      const change = parseCapabilityUpdateInput(input);
      return await db.transaction(async (tx) => {
        const current = await requiredDefinition(tx, capabilityId, true);
        const definition = parseCapabilityCreateInput({
          id: capabilityId,
          kind: current.kind,
          displayName: change.displayName ?? current.displayName,
          description: change.description ?? current.description,
          version: change.version ?? current.version,
          source: change.source ?? current.source,
          config: change.config ?? current.config,
          sensitiveFields: change.sensitiveFields ?? current.sensitiveFields,
          enabled: change.enabled ?? current.enabled,
          createdByUserId: current.createdByUserId,
        });
        await tx.execute(
          `UPDATE capability_definitions SET
             display_name = ?, description = ?, version = ?, source_json = ?, config_json = ?,
             sensitive_fields_json = ?, enabled = ?, updated_at = ?
           WHERE id = ?`,
          [
            definition.displayName,
            definition.description,
            definition.version,
            JSON.stringify(definition.source),
            JSON.stringify(definition.config),
            JSON.stringify(definition.sensitiveFields),
            definition.enabled,
            new Date().toISOString(),
            capabilityId,
          ],
        );
        return await requiredDefinition(tx, capabilityId);
      });
    },

    async delete(id) {
      const result = await db.execute("DELETE FROM capability_definitions WHERE id = ?", [
        capabilityIdSchema.parse(id),
      ]);
      return result.affectedRows === 1;
    },

    async upsertArtifact(input) {
      const artifact = parseCapabilityArtifactInput(input);
      const now = new Date().toISOString();
      await db.execute(
        `INSERT INTO capability_artifacts (
           capability_id, version, sha256, storage_path, size_bytes, created_at
         ) VALUES (?, ?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE
           sha256 = VALUES(sha256),
           storage_path = VALUES(storage_path),
           size_bytes = VALUES(size_bytes)`,
        [
          artifact.capabilityId,
          artifact.version,
          artifact.sha256,
          artifact.storagePath,
          artifact.sizeBytes,
          now,
        ],
      );
      return await requiredArtifact(db, artifact.capabilityId, artifact.version);
    },

    async getArtifact(capabilityId, version) {
      const normalizedId = capabilityIdSchema.parse(capabilityId);
      const normalizedVersion = capabilityVersionSchema.parse(version);
      const row = await db.one(
        "SELECT * FROM capability_artifacts WHERE capability_id = ? AND version = ?",
        [normalizedId, normalizedVersion],
      );
      return row === null ? null : rowToArtifact(row);
    },

    async assign(input) {
      const assignment = normalizeAssignment(input);
      const now = new Date().toISOString();
      await db.execute(
        `INSERT INTO capability_assignments (
           capability_id, user_id, project_id, created_at
         ) VALUES (?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE id = LAST_INSERT_ID(id)`,
        [assignment.capabilityId, assignment.userId, assignment.projectId, now],
      );
      const row = await db.one(
        `SELECT * FROM capability_assignments
         WHERE capability_id = ? AND user_id = ? AND project_id <=> ?`,
        [assignment.capabilityId, assignment.userId, assignment.projectId],
      );
      if (row === null) throw new Error("Capability assignment was not recorded");
      return rowToAssignment(row);
    },

    async unassign(input) {
      const assignment = normalizeAssignment(input);
      const result = await db.execute(
        `DELETE FROM capability_assignments
         WHERE capability_id = ? AND user_id = ? AND project_id <=> ?`,
        [assignment.capabilityId, assignment.userId, assignment.projectId],
      );
      return result.affectedRows === 1;
    },

    async listAssignments(capabilityId) {
      const rows = await db.many(
        `SELECT * FROM capability_assignments
         WHERE capability_id = ? ORDER BY user_id ASC, project_id ASC, id ASC`,
        [capabilityIdSchema.parse(capabilityId)],
      );
      return rows.map(rowToAssignment);
    },

    async listDesiredForContext(context) {
      const normalized = normalizeContext(context);
      const rows = await db.many(
        `SELECT DISTINCT d.*
         FROM capability_definitions d
         JOIN capability_assignments a ON a.capability_id = d.id
         WHERE a.user_id = ?
           AND d.enabled = 1
           AND (a.project_id IS NULL OR a.project_id = ?)
         ORDER BY d.id ASC`,
        [normalized.userId, normalized.projectId],
      );
      return rows.map(rowToDefinition);
    },
  };
}

export const capabilityStore: CapabilityStore = {
  create(input) {
    return createCapabilityStore(gatewayDatabase()).create(input);
  },
  get(id) {
    return createCapabilityStore(gatewayDatabase()).get(id);
  },
  list() {
    return createCapabilityStore(gatewayDatabase()).list();
  },
  update(id, input) {
    return createCapabilityStore(gatewayDatabase()).update(id, input);
  },
  delete(id) {
    return createCapabilityStore(gatewayDatabase()).delete(id);
  },
  upsertArtifact(input) {
    return createCapabilityStore(gatewayDatabase()).upsertArtifact(input);
  },
  getArtifact(capabilityId, version) {
    return createCapabilityStore(gatewayDatabase()).getArtifact(capabilityId, version);
  },
  assign(input) {
    return createCapabilityStore(gatewayDatabase()).assign(input);
  },
  unassign(input) {
    return createCapabilityStore(gatewayDatabase()).unassign(input);
  },
  listAssignments(capabilityId) {
    return createCapabilityStore(gatewayDatabase()).listAssignments(capabilityId);
  },
  listDesiredForContext(context) {
    return createCapabilityStore(gatewayDatabase()).listDesiredForContext(context);
  },
};

function definitionParams(definition: NormalizedCapabilityCreateInput, now: string) {
  return [
    definition.id,
    definition.kind,
    definition.displayName,
    definition.description,
    definition.version,
    JSON.stringify(definition.source),
    JSON.stringify(definition.config),
    JSON.stringify(definition.sensitiveFields),
    definition.enabled,
    definition.createdByUserId,
    now,
    now,
  ] as const;
}

async function requiredDefinition(db: GatewayDb, id: string, forUpdate = false) {
  const row = await db.one(
    `SELECT * FROM capability_definitions WHERE id = ?${forUpdate ? " FOR UPDATE" : ""}`,
    [id],
  );
  if (row === null) throw new Error("Capability not found");
  return rowToDefinition(row);
}

async function requiredArtifact(db: GatewayDb, capabilityId: string, version: string) {
  const row = await db.one(
    "SELECT * FROM capability_artifacts WHERE capability_id = ? AND version = ?",
    [capabilityId, version],
  );
  if (row === null) throw new Error("Capability artifact not found");
  return rowToArtifact(row);
}

function rowToDefinition(row: Record<string, unknown>): CapabilityDefinition {
  const normalized: NormalizedCapabilityCreateInput = parseCapabilityCreateInput({
    id: row.id,
    kind: row.kind,
    displayName: row.display_name,
    description: row.description,
    version: row.version,
    source: parseStoredJson(row.source_json, "source"),
    config: parseStoredJson(row.config_json, "config"),
    sensitiveFields: parseStoredJson(row.sensitive_fields_json, "sensitive fields"),
    enabled: Number(row.enabled) === 1,
    createdByUserId: nullablePositiveId(row.created_by_user_id, "createdByUserId"),
  });
  return {
    ...normalized,
    createdAt: requiredStoredText(row.created_at, "created_at"),
    updatedAt: requiredStoredText(row.updated_at, "updated_at"),
  };
}

function rowToArtifact(row: Record<string, unknown>): CapabilityArtifact {
  const normalized = parseCapabilityArtifactInput({
    capabilityId: row.capability_id,
    version: row.version,
    sha256: row.sha256,
    storagePath: row.storage_path,
    sizeBytes: Number(row.size_bytes),
  });
  return { ...normalized, createdAt: requiredStoredText(row.created_at, "created_at") };
}

function rowToAssignment(row: Record<string, unknown>): CapabilityAssignment {
  return {
    id: positiveId(Number(row.id), "assignment ID"),
    capabilityId: capabilityIdSchema.parse(row.capability_id),
    userId: positiveId(Number(row.user_id), "user ID"),
    projectId: nullablePositiveId(row.project_id, "project ID"),
    createdAt: requiredStoredText(row.created_at, "created_at"),
  };
}

function normalizeAssignment(input: CapabilityAssignmentInput) {
  return {
    capabilityId: capabilityIdSchema.parse(input.capabilityId),
    userId: positiveId(input.userId, "user ID"),
    projectId: nullablePositiveId(input.projectId, "project ID"),
  };
}

function normalizeContext(context: CapabilityContext) {
  return {
    userId: positiveId(context.userId, "user ID"),
    projectId: nullablePositiveId(context.projectId, "project ID"),
  };
}

function positiveId(value: number, name: string) {
  if (!Number.isInteger(value) || value <= 0) throw new Error(`${name} must be a positive integer`);
  return value;
}

function nullablePositiveId(value: unknown, name: string) {
  if (value === null || value === undefined) return null;
  return positiveId(Number(value), name);
}

function requiredStoredText(value: unknown, name: string) {
  if (typeof value !== "string" || value === "") {
    throw new Error(`Stored capability ${name} is invalid`);
  }
  return value;
}

function parseStoredJson(value: unknown, name: string): unknown {
  if (typeof value !== "string") throw new Error(`Stored capability ${name} is invalid`);
  try {
    return JSON.parse(value) as unknown;
  } catch {
    throw new Error(`Stored capability ${name} is invalid`);
  }
}
