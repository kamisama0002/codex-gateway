import type { DbRow, GatewayDb } from "../storage/contracts";

export type ConfigRevisionConflictReason = "missing" | "stale";

export class ConfigRevisionConflictError extends Error {
  readonly code = "config_revision_conflict";
  readonly statusCode = 409;

  constructor(readonly reason: ConfigRevisionConflictReason) {
    super("Configuration changed in another request");
    this.name = "ConfigRevisionConflictError";
  }
}

export interface StoredUserConfig {
  encryptedConfigJson: string;
  revision: number;
}

export interface StoredUserConfigWithUser extends StoredUserConfig {
  userId: number;
  username: string;
  role: string;
}

interface UserConfigRow extends DbRow {
  encrypted_config_json: string;
  revision: unknown;
}

interface UserConfigWithUserRow extends UserConfigRow {
  id: number;
  username: string;
  role: string;
}

export class UserConfigRepository {
  constructor(private readonly db: GatewayDb) {}

  async load(userId: number): Promise<StoredUserConfig | null> {
    const row = await this.db.one<UserConfigRow>(
      "SELECT encrypted_config_json, revision FROM user_configs WHERE user_id = ?",
      [userId],
    );
    return row === null ? null : storedConfig(row);
  }

  async save(
    userId: number,
    encryptedConfigJson: string,
    expectedRevision: number,
    now: string,
  ): Promise<number> {
    validateExpectedRevision(expectedRevision);
    return await this.db.transaction(async (tx) => {
      if (expectedRevision === 0) {
        const result = await tx.execute(
          `
            INSERT INTO user_configs (user_id, encrypted_config_json, revision, updated_at)
            VALUES (?, ?, 1, ?)
            ON DUPLICATE KEY UPDATE revision = LAST_INSERT_ID(revision)
          `,
          [userId, encryptedConfigJson, now],
        );
        if (result.insertId === 0) return 1;
        throw new ConfigRevisionConflictError("stale");
      }

      const nextRevision = expectedRevision + 1;
      if (!Number.isSafeInteger(nextRevision)) {
        throw new RangeError("Next config revision is outside JavaScript's safe integer range");
      }
      const result = await tx.execute(
        `
          UPDATE user_configs
          SET encrypted_config_json = ?, revision = revision + 1, updated_at = ?
          WHERE user_id = ? AND revision = ?
        `,
        [encryptedConfigJson, now, userId, expectedRevision],
      );
      if (result.affectedRows === 1) return nextRevision;
      const existing = await tx.one("SELECT user_id FROM user_configs WHERE user_id = ?", [userId]);
      throw new ConfigRevisionConflictError(existing === null ? "missing" : "stale");
    });
  }

  async listActive(): Promise<StoredUserConfigWithUser[]> {
    const rows = await this.db.many<UserConfigWithUserRow>(
      `
        SELECT users.id, users.username, users.role,
               user_configs.encrypted_config_json, user_configs.revision
        FROM users
        JOIN user_configs ON user_configs.user_id = users.id
        WHERE users.is_active = 1
        ORDER BY users.id ASC
      `,
    );
    return rows.map((row) => ({
      userId: Number(row.id),
      username: String(row.username),
      role: String(row.role),
      ...storedConfig(row),
    }));
  }
}

function storedConfig(row: UserConfigRow): StoredUserConfig {
  return {
    encryptedConfigJson: String(row.encrypted_config_json),
    revision: storedRevision(row.revision),
  };
}

function storedRevision(value: unknown): number {
  let revision: number;
  if (typeof value === "bigint") {
    revision = Number(value);
  } else if (typeof value === "number") {
    revision = value;
  } else if (typeof value === "string" && /^\d+$/.test(value)) {
    revision = Number(value);
  } else {
    throw new Error("Stored config revision is invalid");
  }
  if (!Number.isSafeInteger(revision) || revision < 1) {
    throw new RangeError("Stored config revision is outside JavaScript's safe integer range");
  }
  return revision;
}

function validateExpectedRevision(revision: number): void {
  if (!Number.isSafeInteger(revision) || revision < 0) {
    throw new RangeError("Expected config revision must be a non-negative safe integer");
  }
}
