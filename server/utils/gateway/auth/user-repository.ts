import type { DbRow, GatewayDb } from "../storage/contracts";
import {
  DEFAULT_BROWSER_CAPABILITY_ID,
  DEFAULT_WEB_SEARCH_CAPABILITY_ID,
} from "../../../../shared/types/capabilities.ts";

export type UserRole = "admin" | "user";

export interface StoredUser {
  id: number;
  username: string;
  passwordHash: string;
  isActive: boolean;
  role: UserRole;
}

interface UserRow extends DbRow {
  id: number;
  username: string;
  password_hash: string;
  is_active: number;
  role: string;
}

interface CreateUserInput {
  username: string;
  passwordHash: string;
  role: UserRole;
  now: string;
}

interface UpdateUserCredentialsInput {
  userId: number;
  passwordHash: string;
  role: UserRole | null;
  now: string;
}

export class UserRepository {
  private readonly db: GatewayDb;

  constructor(db: GatewayDb) {
    this.db = db;
  }

  async createWithAutomaticRole(input: Omit<CreateUserInput, "role">): Promise<StoredUser> {
    return await this.db.transaction(async (tx) => {
      const repository = new UserRepository(tx);
      await repository.lockIdentityCreation();
      const administrator = await tx.one("SELECT id FROM users WHERE role = 'admin' LIMIT 1");
      return await repository.create({
        ...input,
        role: administrator === null ? "admin" : "user",
      });
    });
  }

  async lockIdentityCreation(): Promise<void> {
    // Migration 1 is guaranteed to exist before repositories are used and gives empty user tables
    // a stable row to lock while assigning the first role or external identity.
    await this.db.one("SELECT version FROM schema_migrations WHERE version = 1 FOR UPDATE");
  }

  async create(input: CreateUserInput): Promise<StoredUser> {
    const username = normalizeUsername(input.username);
    const result = await this.db.execute(
      `
        INSERT INTO users (username, password_hash, is_active, role, created_at, updated_at)
        VALUES (?, ?, 1, ?, ?, ?)
      `,
      [username, input.passwordHash, input.role, input.now, input.now],
    );
    await this.db.execute(
      `INSERT IGNORE INTO capability_assignments (
         capability_id, user_id, project_id, created_at
       )
       SELECT id, ?, NULL, ?
       FROM capability_definitions
       WHERE id IN (?, ?)`,
      [
        result.insertId,
        input.now,
        DEFAULT_BROWSER_CAPABILITY_ID,
        DEFAULT_WEB_SEARCH_CAPABILITY_ID,
      ],
    );
    const user = await this.findById(result.insertId);
    if (user === null) throw new Error("Created user could not be loaded");
    return user;
  }

  async findUsername(userId: number): Promise<string | null> {
    if (!Number.isInteger(userId) || userId <= 0) return null;
    const row = await this.db.one<{ username: string }>("SELECT username FROM users WHERE id = ?", [
      userId,
    ]);
    return row === null ? null : String(row.username);
  }

  async findByUsername(username: string): Promise<StoredUser | null> {
    const row = await this.db.one<UserRow>(
      "SELECT id, username, password_hash, is_active, role FROM users WHERE username = ?",
      [normalizeUsername(username)],
    );
    return row === null ? null : storedUser(row);
  }

  async findById(userId: number): Promise<StoredUser | null> {
    const row = await this.db.one<UserRow>(
      "SELECT id, username, password_hash, is_active, role FROM users WHERE id = ?",
      [userId],
    );
    return row === null ? null : storedUser(row);
  }

  async updateRole(userId: number, role: UserRole, now: string): Promise<void> {
    await this.db.execute("UPDATE users SET role = ?, updated_at = ? WHERE id = ?", [
      role,
      now,
      userId,
    ]);
  }

  async updateCredentials(input: UpdateUserCredentialsInput): Promise<void> {
    await this.db.execute(
      "UPDATE users SET password_hash = ?, is_active = 1, role = COALESCE(?, role), updated_at = ? WHERE id = ?",
      [input.passwordHash, input.role, input.now, input.userId],
    );
  }
}

export function normalizeUsername(username: string): string {
  return username.trim().toLowerCase();
}

export function databaseUserRole(value: unknown): UserRole {
  if (value === "admin" || value === "user") return value;
  throw new Error("Stored user role is invalid");
}

function storedUser(row: UserRow): StoredUser {
  return {
    id: Number(row.id),
    username: String(row.username),
    passwordHash: String(row.password_hash),
    isActive: Number(row.is_active) === 1,
    role: databaseUserRole(row.role),
  };
}
