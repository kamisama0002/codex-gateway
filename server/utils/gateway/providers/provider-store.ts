import { randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import type {
  ModelCapabilities,
  ModelProviderDefinition,
  ProviderModelDefinition,
  PublicModelProviderDefinition,
  UpstreamWireApi,
  UserModelGrant,
  UserProviderModel,
} from "~~/shared/types";
import { encryptJson, decryptJson } from "../storage/crypto";
import { gatewayDatabase } from "../storage/database";
import {
  modelCapabilitiesSchema,
  providerBaseUrlSchema,
  providerIdSchema,
  providerModelIdSchema,
  providerNameSchema,
  upstreamWireApiSchema,
} from "../http/validation/providers";

export interface ProviderCreateInput {
  id?: string;
  name: string;
  baseUrl: string;
  wireApi: UpstreamWireApi;
  apiKey: string;
  enabled?: boolean;
  requestTimeoutMs?: number;
}

export interface ProviderUpdateInput {
  name?: string;
  baseUrl?: string;
  wireApi?: UpstreamWireApi;
  apiKey?: string;
  enabled?: boolean;
  requestTimeoutMs?: number;
}

export interface ProviderModelInput {
  modelId: string;
  displayName: string;
  enabled?: boolean;
  capabilities: ModelCapabilities;
}

export interface ProviderStore {
  create(input: ProviderCreateInput): PublicModelProviderDefinition;
  update(id: string, input: ProviderUpdateInput): PublicModelProviderDefinition;
  listPublic(): PublicModelProviderDefinition[];
  getPublic(id: string): PublicModelProviderDefinition | null;
  getWithSecret(id: string): (ModelProviderDefinition & { apiKey: string }) | null;
  delete(id: string): boolean;
  upsertModel(providerId: string, input: ProviderModelInput): ProviderModelDefinition;
  listModels(providerId: string): ProviderModelDefinition[];
  grant(input: { userId: number; providerId: string; modelId: string }): UserModelGrant;
  revoke(input: { userId: number; providerId: string; modelId: string }): boolean;
  listForUser(userId: number): UserProviderModel[];
}

export function createProviderStore(db: DatabaseSync): ProviderStore {
  return {
    create(input) {
      const id = providerIdSchema.parse(input.id ?? `provider_${randomUUID().replaceAll("-", "")}`);
      const name = providerNameSchema.parse(input.name);
      const baseUrl = providerBaseUrlSchema.parse(input.baseUrl).replace(/\/$/, "");
      const wireApi = upstreamWireApiSchema.parse(input.wireApi);
      const apiKey = input.apiKey.trim();
      if (apiKey === "") throw new Error("Provider API key is required");
      const enabled = input.enabled ?? true;
      const requestTimeoutMs = normalizeTimeout(input.requestTimeoutMs ?? 30_000);
      const now = new Date().toISOString();
      db.prepare(
        `INSERT INTO model_providers
         (id, name, base_url, wire_api, encrypted_api_key, enabled, request_timeout_ms, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        id,
        name,
        baseUrl,
        wireApi,
        encryptJson({ apiKey }),
        enabled ? 1 : 0,
        requestTimeoutMs,
        now,
        now,
      );
      return requiredPublic(db, id);
    },

    update(id, input) {
      const normalizedId = providerIdSchema.parse(id);
      const current = requiredProvider(db, normalizedId);
      const name = input.name === undefined ? current.name : providerNameSchema.parse(input.name);
      const baseUrl =
        input.baseUrl === undefined
          ? current.baseUrl
          : providerBaseUrlSchema.parse(input.baseUrl).replace(/\/$/, "");
      const wireApi =
        input.wireApi === undefined ? current.wireApi : upstreamWireApiSchema.parse(input.wireApi);
      const enabled = input.enabled === undefined ? current.enabled : input.enabled;
      const requestTimeoutMs =
        input.requestTimeoutMs === undefined
          ? current.requestTimeoutMs
          : normalizeTimeout(input.requestTimeoutMs);
      const encryptedApiKey =
        input.apiKey === undefined || input.apiKey.trim() === ""
          ? current.encryptedApiKey
          : encryptJson({ apiKey: input.apiKey.trim() });
      db.prepare(
        `UPDATE model_providers
         SET name = ?, base_url = ?, wire_api = ?, encrypted_api_key = ?, enabled = ?,
             request_timeout_ms = ?, updated_at = ?
         WHERE id = ?`,
      ).run(
        name,
        baseUrl,
        wireApi,
        encryptedApiKey,
        enabled ? 1 : 0,
        requestTimeoutMs,
        new Date().toISOString(),
        normalizedId,
      );
      return requiredPublic(db, normalizedId);
    },

    listPublic() {
      return db
        .prepare("SELECT * FROM model_providers ORDER BY name ASC, id ASC")
        .all()
        .map(rowToPublic);
    },

    getPublic(id) {
      const row = db
        .prepare("SELECT * FROM model_providers WHERE id = ?")
        .get(providerIdSchema.parse(id));
      return row === undefined ? null : rowToPublic(row);
    },

    getWithSecret(id) {
      const row = db
        .prepare("SELECT * FROM model_providers WHERE id = ?")
        .get(providerIdSchema.parse(id));
      if (row === undefined) return null;
      const provider = rowToProvider(row);
      const secret = decryptJson(provider.encryptedApiKey);
      if (!isRecord(secret) || typeof secret.apiKey !== "string" || secret.apiKey.length === 0) {
        throw new Error("Stored provider API key is invalid");
      }
      return { ...provider, apiKey: secret.apiKey };
    },

    delete(id) {
      const result = db
        .prepare("DELETE FROM model_providers WHERE id = ?")
        .run(providerIdSchema.parse(id));
      return result.changes === 1 || result.changes === 1n;
    },

    upsertModel(providerId, input) {
      const normalizedProviderId = providerIdSchema.parse(providerId);
      requiredProvider(db, normalizedProviderId);
      const modelId = providerModelIdSchema.parse(input.modelId);
      const displayName = input.displayName.trim();
      if (displayName === "") throw new Error("Model display name is required");
      const capabilities = modelCapabilitiesSchema.parse(input.capabilities);
      const now = new Date().toISOString();
      db.prepare(
        `INSERT INTO provider_models
         (provider_id, model_id, display_name, enabled, capabilities_json, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(provider_id, model_id) DO UPDATE SET
           display_name = excluded.display_name,
           enabled = excluded.enabled,
           capabilities_json = excluded.capabilities_json,
           updated_at = excluded.updated_at`,
      ).run(
        normalizedProviderId,
        modelId,
        displayName,
        (input.enabled ?? true) ? 1 : 0,
        JSON.stringify(capabilities),
        now,
        now,
      );
      return requiredModel(db, normalizedProviderId, modelId);
    },

    listModels(providerId) {
      return db
        .prepare("SELECT * FROM provider_models WHERE provider_id = ? ORDER BY model_id ASC")
        .all(providerIdSchema.parse(providerId))
        .map(rowToModel);
    },

    grant(input) {
      const userId = positiveUserId(input.userId);
      const providerId = providerIdSchema.parse(input.providerId);
      const modelId = providerModelIdSchema.parse(input.modelId);
      requiredModel(db, providerId, modelId);
      const createdAt = new Date().toISOString();
      db.prepare(
        `INSERT INTO user_model_grants (user_id, provider_id, model_id, created_at)
         VALUES (?, ?, ?, ?)
         ON CONFLICT(user_id, provider_id, model_id) DO NOTHING`,
      ).run(userId, providerId, modelId, createdAt);
      const row = db
        .prepare(
          "SELECT * FROM user_model_grants WHERE user_id = ? AND provider_id = ? AND model_id = ?",
        )
        .get(userId, providerId, modelId);
      if (row === undefined) throw new Error("Model grant was not recorded");
      return {
        userId: Number(row.user_id),
        providerId: String(row.provider_id),
        modelId: String(row.model_id),
        createdAt: String(row.created_at),
      };
    },

    revoke(input) {
      const result = db
        .prepare(
          "DELETE FROM user_model_grants WHERE user_id = ? AND provider_id = ? AND model_id = ?",
        )
        .run(
          positiveUserId(input.userId),
          providerIdSchema.parse(input.providerId),
          providerModelIdSchema.parse(input.modelId),
        );
      return result.changes === 1 || result.changes === 1n;
    },

    listForUser(userId) {
      const rows = db
        .prepare(
          `SELECT p.*, m.model_id, m.display_name, m.enabled AS model_enabled, m.capabilities_json,
                  m.created_at AS model_created_at, m.updated_at AS model_updated_at
           FROM user_model_grants g
           JOIN model_providers p ON p.id = g.provider_id
           JOIN provider_models m ON m.provider_id = g.provider_id AND m.model_id = g.model_id
           WHERE g.user_id = ? AND p.enabled = 1 AND m.enabled = 1
           ORDER BY p.name ASC, m.model_id ASC`,
        )
        .all(positiveUserId(userId));
      return rows.map((row) => ({
        provider: rowToPublic(row),
        providerId: String(row.provider_id),
        modelId: String(row.model_id),
        displayName: String(row.display_name),
        enabled: Number(row.model_enabled) === 1,
        capabilities: parseCapabilities(row.capabilities_json),
        createdAt: String(row.model_created_at),
        updatedAt: String(row.model_updated_at),
      }));
    },
  };
}

export const providerStore: ProviderStore = createProviderStore(gatewayDatabase());

function requiredProvider(db: DatabaseSync, id: string): ModelProviderDefinition {
  const row = db.prepare("SELECT * FROM model_providers WHERE id = ?").get(providerIdSchema.parse(id));
  if (row === undefined) throw new Error("Provider not found");
  return rowToProvider(row);
}

function requiredPublic(db: DatabaseSync, id: string): PublicModelProviderDefinition {
  const row = db.prepare("SELECT * FROM model_providers WHERE id = ?").get(providerIdSchema.parse(id));
  if (row === undefined) throw new Error("Provider not found");
  return rowToPublic(row);
}

function requiredModel(db: DatabaseSync, providerId: string, modelId: string): ProviderModelDefinition {
  const row = db
    .prepare("SELECT * FROM provider_models WHERE provider_id = ? AND model_id = ?")
    .get(providerIdSchema.parse(providerId), providerModelIdSchema.parse(modelId));
  if (row === undefined) throw new Error("Provider model not found");
  return rowToModel(row);
}

function rowToProvider(row: Record<string, unknown>): ModelProviderDefinition {
  return {
    id: providerIdSchema.parse(row.id),
    name: providerNameSchema.parse(row.name),
    baseUrl: String(row.base_url),
    wireApi: upstreamWireApiSchema.parse(row.wire_api),
    encryptedApiKey: String(row.encrypted_api_key),
    enabled: Number(row.enabled) === 1,
    requestTimeoutMs: normalizeTimeout(Number(row.request_timeout_ms)),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

function rowToPublic(row: Record<string, unknown>): PublicModelProviderDefinition {
  const provider = rowToProvider(row);
  const { encryptedApiKey: _encryptedApiKey, ...publicProvider } = provider;
  return { ...publicProvider, hasApiKey: true };
}

function rowToModel(row: Record<string, unknown>): ProviderModelDefinition {
  return {
    providerId: providerIdSchema.parse(row.provider_id),
    modelId: providerModelIdSchema.parse(row.model_id),
    displayName: String(row.display_name),
    enabled: Number(row.enabled) === 1,
    capabilities: parseCapabilities(row.capabilities_json),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

function parseCapabilities(value: unknown): ModelCapabilities {
  if (typeof value !== "string") throw new Error("Stored provider capabilities are invalid");
  return modelCapabilitiesSchema.parse(JSON.parse(value));
}

function normalizeTimeout(value: number): number {
  if (!Number.isInteger(value) || value < 1000 || value > 300000) {
    throw new Error("Provider request timeout must be between 1000 and 300000 ms");
  }
  return value;
}

function positiveUserId(value: number): number {
  if (!Number.isInteger(value) || value <= 0) throw new Error("User ID must be a positive integer");
  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
