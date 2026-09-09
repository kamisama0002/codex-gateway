import { randomUUID } from "node:crypto";
import type {
  ModelCapabilities,
  ModelProviderDefinition,
  ProviderModelInput,
  ProviderModelDefinition,
  PublicModelProviderDefinition,
  UpstreamWireApi,
  UserModelGrant,
  UserProviderModel,
} from "~~/shared/types";
import {
  modelCapabilitiesSchema,
  providerBaseUrlSchema,
  providerIdSchema,
  providerModelIdSchema,
  providerNameSchema,
  upstreamWireApiSchema,
} from "../http/validation/providers";
import type { GatewayDb, SqlValue } from "../storage/contracts";
import { decryptJson, encryptJson } from "../storage/crypto";
import { gatewayDatabase } from "../storage/database";

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

export interface ProviderStore {
  create(input: ProviderCreateInput): Promise<PublicModelProviderDefinition>;
  update(id: string, input: ProviderUpdateInput): Promise<PublicModelProviderDefinition>;
  listPublic(): Promise<PublicModelProviderDefinition[]>;
  getPublic(id: string): Promise<PublicModelProviderDefinition | null>;
  getWithSecret(id: string): Promise<(ModelProviderDefinition & { apiKey: string }) | null>;
  delete(id: string): Promise<boolean>;
  upsertModel(providerId: string, input: ProviderModelInput): Promise<ProviderModelDefinition>;
  syncDiscoveredModels(
    providerId: string,
    inputs: ProviderModelInput[],
  ): Promise<ProviderModelDefinition[]>;
  listModels(providerId: string): Promise<ProviderModelDefinition[]>;
  grant(input: { userId: number; providerId: string; modelId: string }): Promise<UserModelGrant>;
  revoke(input: { userId: number; providerId: string; modelId: string }): Promise<boolean>;
  listForUser(userId: number): Promise<UserProviderModel[]>;
}

export function createProviderStore(db: GatewayDb): ProviderStore {
  return {
    async create(input) {
      const id = providerIdSchema.parse(input.id ?? `provider_${randomUUID().replaceAll("-", "")}`);
      const name = providerNameSchema.parse(input.name);
      const baseUrl = providerBaseUrlSchema.parse(input.baseUrl).replace(/\/$/, "");
      const wireApi = upstreamWireApiSchema.parse(input.wireApi);
      const apiKey = input.apiKey.trim();
      if (apiKey === "") throw new Error("Provider API key is required");
      const enabled = input.enabled ?? true;
      const requestTimeoutMs = normalizeTimeout(input.requestTimeoutMs ?? 30_000);
      const now = new Date().toISOString();
      return await db.transaction(async (tx) => {
        await tx.execute(
          `INSERT INTO model_providers
           (id, name, base_url, wire_api, encrypted_api_key, enabled, request_timeout_ms, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            id,
            name,
            baseUrl,
            wireApi,
            encryptJson({ apiKey }),
            enabled,
            requestTimeoutMs,
            now,
            now,
          ],
        );
        return await requiredPublic(tx, id);
      });
    },

    async update(id, input) {
      const normalizedId = providerIdSchema.parse(id);
      const assignments: string[] = [];
      const params: SqlValue[] = [];
      if (input.name !== undefined) {
        assignments.push("name = ?");
        params.push(providerNameSchema.parse(input.name));
      }
      if (input.baseUrl !== undefined) {
        assignments.push("base_url = ?");
        params.push(providerBaseUrlSchema.parse(input.baseUrl).replace(/\/$/, ""));
      }
      if (input.wireApi !== undefined) {
        assignments.push("wire_api = ?");
        params.push(upstreamWireApiSchema.parse(input.wireApi));
      }
      if (input.apiKey !== undefined && input.apiKey.trim() !== "") {
        assignments.push("encrypted_api_key = ?");
        params.push(encryptJson({ apiKey: input.apiKey.trim() }));
      }
      if (input.enabled !== undefined) {
        assignments.push("enabled = ?");
        params.push(input.enabled);
      }
      if (input.requestTimeoutMs !== undefined) {
        assignments.push("request_timeout_ms = ?");
        params.push(normalizeTimeout(input.requestTimeoutMs));
      }
      assignments.push("updated_at = ?");
      params.push(new Date().toISOString(), normalizedId);
      return await db.transaction(async (tx) => {
        await tx.execute(
          `UPDATE model_providers
           SET ${assignments.join(", ")}
           WHERE id = ?`,
          params,
        );
        return await requiredPublic(tx, normalizedId);
      });
    },

    async listPublic() {
      const rows = await db.many("SELECT * FROM model_providers ORDER BY name ASC, id ASC");
      return rows.map(rowToPublic);
    },

    async getPublic(id) {
      const row = await db.one("SELECT * FROM model_providers WHERE id = ?", [
        providerIdSchema.parse(id),
      ]);
      return row === null ? null : rowToPublic(row);
    },

    async getWithSecret(id) {
      const row = await db.one("SELECT * FROM model_providers WHERE id = ?", [
        providerIdSchema.parse(id),
      ]);
      if (row === null) return null;
      const provider = rowToProvider(row);
      const secret = decryptJson(provider.encryptedApiKey);
      if (!isRecord(secret) || typeof secret.apiKey !== "string" || secret.apiKey.length === 0) {
        throw new Error("Stored provider API key is invalid");
      }
      return { ...provider, apiKey: secret.apiKey };
    },

    async delete(id) {
      const result = await db.execute("DELETE FROM model_providers WHERE id = ?", [
        providerIdSchema.parse(id),
      ]);
      return result.affectedRows === 1;
    },

    async upsertModel(providerId, input) {
      const normalizedProviderId = providerIdSchema.parse(providerId);
      const modelId = providerModelIdSchema.parse(input.modelId);
      const displayName = input.displayName.trim();
      if (displayName === "") throw new Error("Model display name is required");
      const capabilities = modelCapabilitiesSchema.parse(input.capabilities);
      const now = new Date().toISOString();
      return await db.transaction(async (tx) => {
        await requiredProvider(tx, normalizedProviderId);
        await tx.execute(
          `INSERT INTO provider_models
           (provider_id, model_id, display_name, enabled, capabilities_json, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?)
           ON DUPLICATE KEY UPDATE
             display_name = VALUES(display_name),
             enabled = VALUES(enabled),
             capabilities_json = VALUES(capabilities_json),
             updated_at = VALUES(updated_at)`,
          [
            normalizedProviderId,
            modelId,
            displayName,
            input.enabled ?? true,
            JSON.stringify(capabilities),
            now,
            now,
          ],
        );
        return await requiredModel(tx, normalizedProviderId, modelId);
      });
    },

    async syncDiscoveredModels(providerId, inputs) {
      const normalizedProviderId = providerIdSchema.parse(providerId);
      if (inputs.length === 0) throw new Error("No models were discovered");
      const now = new Date().toISOString();
      return await db.transaction(async (tx) => {
        await requiredProvider(tx, normalizedProviderId);
        for (const input of inputs) {
          const modelId = providerModelIdSchema.parse(input.modelId);
          const displayName = input.displayName.trim();
          if (displayName === "") throw new Error("Model display name is required");
          const capabilities = modelCapabilitiesSchema.parse(input.capabilities);
          await tx.execute(
            `INSERT INTO provider_models
             (provider_id, model_id, display_name, enabled, capabilities_json, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?)
             ON DUPLICATE KEY UPDATE
               display_name = VALUES(display_name),
               capabilities_json = VALUES(capabilities_json),
               updated_at = VALUES(updated_at)`,
            [
              normalizedProviderId,
              modelId,
              displayName,
              input.enabled ?? true,
              JSON.stringify(capabilities),
              now,
              now,
            ],
          );
        }
        return await listModelsInTransaction(tx, normalizedProviderId);
      });
    },

    async listModels(providerId) {
      const rows = await db.many(
        "SELECT * FROM provider_models WHERE provider_id = ? ORDER BY model_id ASC",
        [providerIdSchema.parse(providerId)],
      );
      return rows.map(rowToModel);
    },

    async grant(input) {
      const userId = positiveUserId(input.userId);
      const providerId = providerIdSchema.parse(input.providerId);
      const modelId = providerModelIdSchema.parse(input.modelId);
      return await db.transaction(async (tx) => {
        await requiredModel(tx, providerId, modelId);
        await tx.execute(
          `INSERT INTO user_model_grants (user_id, provider_id, model_id, created_at)
           VALUES (?, ?, ?, ?)
           ON DUPLICATE KEY UPDATE created_at = created_at`,
          [userId, providerId, modelId, new Date().toISOString()],
        );
        const row = await tx.one(
          "SELECT * FROM user_model_grants WHERE user_id = ? AND provider_id = ? AND model_id = ?",
          [userId, providerId, modelId],
        );
        if (row === null) throw new Error("Model grant was not recorded");
        return {
          userId: Number(row.user_id),
          providerId: String(row.provider_id),
          modelId: String(row.model_id),
          createdAt: String(row.created_at),
        };
      });
    },

    async revoke(input) {
      const result = await db.execute(
        "DELETE FROM user_model_grants WHERE user_id = ? AND provider_id = ? AND model_id = ?",
        [
          positiveUserId(input.userId),
          providerIdSchema.parse(input.providerId),
          providerModelIdSchema.parse(input.modelId),
        ],
      );
      return result.affectedRows === 1;
    },

    async listForUser(userId) {
      // Model availability is controlled globally by administrators. Keep the
      // user argument for API and runtime compatibility, but do not require a
      // per-user grant before exposing an enabled model.
      positiveUserId(userId);
      const rows = await db.many(
        `SELECT p.*, m.model_id, m.display_name, m.enabled AS model_enabled, m.capabilities_json,
                m.created_at AS model_created_at, m.updated_at AS model_updated_at
         FROM model_providers p
         JOIN provider_models m ON m.provider_id = p.id
         WHERE p.enabled = 1 AND m.enabled = 1
         ORDER BY p.name ASC, m.model_id ASC`,
        [],
      );
      return rows.map((row) => ({
        provider: rowToPublic(row),
        providerId: String(row.id),
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

export const providerStore: ProviderStore = {
  create(input) {
    return createProviderStore(gatewayDatabase()).create(input);
  },
  update(id, input) {
    return createProviderStore(gatewayDatabase()).update(id, input);
  },
  listPublic() {
    return createProviderStore(gatewayDatabase()).listPublic();
  },
  getPublic(id) {
    return createProviderStore(gatewayDatabase()).getPublic(id);
  },
  getWithSecret(id) {
    return createProviderStore(gatewayDatabase()).getWithSecret(id);
  },
  delete(id) {
    return createProviderStore(gatewayDatabase()).delete(id);
  },
  upsertModel(providerId, input) {
    return createProviderStore(gatewayDatabase()).upsertModel(providerId, input);
  },
  syncDiscoveredModels(providerId, inputs) {
    return createProviderStore(gatewayDatabase()).syncDiscoveredModels(providerId, inputs);
  },
  listModels(providerId) {
    return createProviderStore(gatewayDatabase()).listModels(providerId);
  },
  grant(input) {
    return createProviderStore(gatewayDatabase()).grant(input);
  },
  revoke(input) {
    return createProviderStore(gatewayDatabase()).revoke(input);
  },
  listForUser(userId) {
    return createProviderStore(gatewayDatabase()).listForUser(userId);
  },
};

async function requiredProvider(db: GatewayDb, id: string): Promise<ModelProviderDefinition> {
  const row = await db.one("SELECT * FROM model_providers WHERE id = ?", [
    providerIdSchema.parse(id),
  ]);
  if (row === null) throw new Error("Provider not found");
  return rowToProvider(row);
}

async function requiredPublic(db: GatewayDb, id: string): Promise<PublicModelProviderDefinition> {
  const row = await db.one("SELECT * FROM model_providers WHERE id = ?", [
    providerIdSchema.parse(id),
  ]);
  if (row === null) throw new Error("Provider not found");
  return rowToPublic(row);
}

async function requiredModel(
  db: GatewayDb,
  providerId: string,
  modelId: string,
): Promise<ProviderModelDefinition> {
  const row = await db.one("SELECT * FROM provider_models WHERE provider_id = ? AND model_id = ?", [
    providerIdSchema.parse(providerId),
    providerModelIdSchema.parse(modelId),
  ]);
  if (row === null) throw new Error("Provider model not found");
  return rowToModel(row);
}

async function listModelsInTransaction(
  db: GatewayDb,
  providerId: string,
): Promise<ProviderModelDefinition[]> {
  const rows = await db.many(
    "SELECT * FROM provider_models WHERE provider_id = ? ORDER BY model_id ASC",
    [providerIdSchema.parse(providerId)],
  );
  return rows.map(rowToModel);
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
