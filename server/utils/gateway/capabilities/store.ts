import type { DatabaseSync } from "node:sqlite";
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
  create(input: CapabilityCreateInput): CapabilityDefinition;
  get(id: string): CapabilityDefinition | null;
  list(): CapabilityDefinition[];
  update(id: string, input: CapabilityUpdateInput): CapabilityDefinition;
  delete(id: string): boolean;
  upsertArtifact(input: CapabilityArtifactInput): CapabilityArtifact;
  getArtifact(capabilityId: string, version: string): CapabilityArtifact | null;
  assign(input: CapabilityAssignmentInput): CapabilityAssignment;
  unassign(input: CapabilityAssignmentInput): boolean;
  listAssignments(capabilityId: string): CapabilityAssignment[];
  listDesiredForContext(context: CapabilityContext): CapabilityDefinition[];
}

export function createCapabilityStore(db: DatabaseSync): CapabilityStore {
  return {
    create(input) {
      const definition = parseCapabilityCreateInput(input);
      if (definition.createdByUserId !== null) requireUser(db, definition.createdByUserId);
      const now = new Date().toISOString();
      db.prepare(
        `INSERT INTO capability_definitions (
           id, kind, display_name, description, version, source_json, config_json,
           sensitive_fields_json, enabled, created_by_user_id, created_at, updated_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        definition.id,
        definition.kind,
        definition.displayName,
        definition.description,
        definition.version,
        JSON.stringify(definition.source),
        JSON.stringify(definition.config),
        JSON.stringify(definition.sensitiveFields),
        definition.enabled ? 1 : 0,
        definition.createdByUserId,
        now,
        now,
      );
      return requiredDefinition(db, definition.id);
    },

    get(id) {
      const row = db
        .prepare("SELECT * FROM capability_definitions WHERE id = ?")
        .get(capabilityIdSchema.parse(id));
      return row === undefined ? null : rowToDefinition(row);
    },

    list() {
      return db
        .prepare("SELECT * FROM capability_definitions ORDER BY id ASC")
        .all()
        .map(rowToDefinition);
    },

    update(id, input) {
      const capabilityId = capabilityIdSchema.parse(id);
      const current = requiredDefinition(db, capabilityId);
      const change = parseCapabilityUpdateInput(input);
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
      db.prepare(
        `UPDATE capability_definitions SET
           display_name = ?, description = ?, version = ?, source_json = ?, config_json = ?,
           sensitive_fields_json = ?, enabled = ?, updated_at = ?
         WHERE id = ?`,
      ).run(
        definition.displayName,
        definition.description,
        definition.version,
        JSON.stringify(definition.source),
        JSON.stringify(definition.config),
        JSON.stringify(definition.sensitiveFields),
        definition.enabled ? 1 : 0,
        new Date().toISOString(),
        capabilityId,
      );
      return requiredDefinition(db, capabilityId);
    },

    delete(id) {
      const result = db
        .prepare("DELETE FROM capability_definitions WHERE id = ?")
        .run(capabilityIdSchema.parse(id));
      return changedOneRow(result.changes);
    },

    upsertArtifact(input) {
      const artifact = parseCapabilityArtifactInput(input);
      requiredDefinition(db, artifact.capabilityId);
      const now = new Date().toISOString();
      db.prepare(
        `INSERT INTO capability_artifacts (
           capability_id, version, sha256, storage_path, size_bytes, created_at
         ) VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(capability_id, version) DO UPDATE SET
           sha256 = excluded.sha256,
           storage_path = excluded.storage_path,
           size_bytes = excluded.size_bytes`,
      ).run(
        artifact.capabilityId,
        artifact.version,
        artifact.sha256,
        artifact.storagePath,
        artifact.sizeBytes,
        now,
      );
      return requiredArtifact(db, artifact.capabilityId, artifact.version);
    },

    getArtifact(capabilityId, version) {
      const normalizedId = capabilityIdSchema.parse(capabilityId);
      const normalizedVersion = capabilityVersionSchema.parse(version);
      const row = db
        .prepare("SELECT * FROM capability_artifacts WHERE capability_id = ? AND version = ?")
        .get(normalizedId, normalizedVersion);
      return row === undefined ? null : rowToArtifact(row);
    },

    assign(input) {
      const assignment = normalizeAssignment(input);
      requiredDefinition(db, assignment.capabilityId);
      requireUser(db, assignment.userId);
      const now = new Date().toISOString();
      db.prepare(
        `INSERT OR IGNORE INTO capability_assignments (
           capability_id, user_id, project_id, created_at
         ) VALUES (?, ?, ?, ?)`,
      ).run(assignment.capabilityId, assignment.userId, assignment.projectId, now);
      const row = db
        .prepare(
          `SELECT * FROM capability_assignments
           WHERE capability_id = ? AND user_id = ? AND project_id IS ?`,
        )
        .get(assignment.capabilityId, assignment.userId, assignment.projectId);
      if (row === undefined) throw new Error("Capability assignment was not recorded");
      return rowToAssignment(row);
    },

    unassign(input) {
      const assignment = normalizeAssignment(input);
      const result = db
        .prepare(
          `DELETE FROM capability_assignments
           WHERE capability_id = ? AND user_id = ? AND project_id IS ?`,
        )
        .run(assignment.capabilityId, assignment.userId, assignment.projectId);
      return changedOneRow(result.changes);
    },

    listAssignments(capabilityId) {
      return db
        .prepare(
          `SELECT * FROM capability_assignments
           WHERE capability_id = ? ORDER BY user_id ASC, project_id ASC, id ASC`,
        )
        .all(capabilityIdSchema.parse(capabilityId))
        .map(rowToAssignment);
    },

    listDesiredForContext(context) {
      const normalized = normalizeContext(context);
      return db
        .prepare(
          `SELECT DISTINCT d.*
           FROM capability_definitions d
           JOIN capability_assignments a ON a.capability_id = d.id
           WHERE a.user_id = ?
             AND d.enabled = 1
             AND (a.project_id IS NULL OR a.project_id IS ?)
           ORDER BY d.id ASC`,
        )
        .all(normalized.userId, normalized.projectId)
        .map(rowToDefinition);
    },
  };
}

export const capabilityStore: CapabilityStore = createCapabilityStore(gatewayDatabase());

function requiredDefinition(db: DatabaseSync, id: string) {
  const row = db.prepare("SELECT * FROM capability_definitions WHERE id = ?").get(id);
  if (row === undefined) throw new Error("Capability not found");
  return rowToDefinition(row);
}

function requiredArtifact(db: DatabaseSync, capabilityId: string, version: string) {
  const row = db
    .prepare("SELECT * FROM capability_artifacts WHERE capability_id = ? AND version = ?")
    .get(capabilityId, version);
  if (row === undefined) throw new Error("Capability artifact not found");
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
    capabilityId: String(row.capability_id),
    version: String(row.version),
    sha256: String(row.sha256),
    storagePath: String(row.storage_path),
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

function requireUser(db: DatabaseSync, userId: number) {
  if (
    db.prepare("SELECT 1 FROM users WHERE id = ?").get(positiveId(userId, "user ID")) === undefined
  ) {
    throw new Error("User not found");
  }
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
  if (typeof value !== "string" || value === "")
    throw new Error(`Stored capability ${name} is invalid`);
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

function changedOneRow(changes: number | bigint) {
  return changes === 1 || changes === 1n;
}
