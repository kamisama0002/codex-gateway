import type { GatewayDb } from "../storage/contracts";
import { gatewayDatabase } from "../storage/database";
import {
  assignRuntimePolicy,
  assignedRuntimePolicySchema,
  type AssignedRuntimePolicy,
  type AssignRuntimePolicyInput,
} from "./runtime-policy";

export function createRuntimePolicyStore(db: GatewayDb) {
  return {
    async getByUserId(userId: number): Promise<AssignedRuntimePolicy | null> {
      const row = await db.one("SELECT * FROM user_runtime_policies WHERE user_id = ?", [
        positiveUserId(userId),
      ]);
      return row === null ? null : rowToRuntimePolicy(row);
    },

    async upsertIfNewer(
      input: AssignRuntimePolicyInput,
      transactionDb?: GatewayDb,
    ): Promise<AssignedRuntimePolicy> {
      const assigned = assignRuntimePolicy(input);
      const upsert = async (tx: GatewayDb) => {
        const currentRow = await tx.one(
          "SELECT * FROM user_runtime_policies WHERE user_id = ? FOR UPDATE",
          [assigned.userId],
        );
        const current = currentRow === null ? null : rowToRuntimePolicy(currentRow);
        if (
          current !== null &&
          Date.parse(current.sourceIssuedAt) >= Date.parse(assigned.sourceIssuedAt)
        ) {
          return current;
        }

        if (current === null) {
          await tx.execute(
            `INSERT INTO user_runtime_policies (
              user_id, tenant_id, policy_version, image_alias, memory_mib, cpu_millicores,
              pids_limit, source_issued_at, created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            policyParams(assigned),
          );
        } else {
          await tx.execute(
            `UPDATE user_runtime_policies
             SET tenant_id = ?, policy_version = ?, image_alias = ?, memory_mib = ?,
                 cpu_millicores = ?, pids_limit = ?, source_issued_at = ?, updated_at = ?
             WHERE user_id = ?`,
            [
              assigned.tenantId,
              assigned.policyVersion,
              assigned.imageAlias,
              assigned.memoryMiB,
              assigned.cpuMillicores,
              assigned.pidsLimit,
              assigned.sourceIssuedAt,
              assigned.updatedAt,
              assigned.userId,
            ],
          );
        }
        return await requiredPolicy(tx, assigned.userId);
      };

      return transactionDb === undefined
        ? await db.transaction(upsert)
        : await upsert(transactionDb);
    },
  };
}

export const runtimePolicyStore = {
  getByUserId(userId: number) {
    return createRuntimePolicyStore(gatewayDatabase()).getByUserId(userId);
  },
  upsertIfNewer(input: AssignRuntimePolicyInput, db?: GatewayDb) {
    const store = createRuntimePolicyStore(db ?? gatewayDatabase());
    return store.upsertIfNewer(input, db);
  },
};

async function requiredPolicy(db: GatewayDb, userId: number): Promise<AssignedRuntimePolicy> {
  const row = await db.one("SELECT * FROM user_runtime_policies WHERE user_id = ?", [userId]);
  if (row === null) throw new Error(`Runtime policy for user ${userId} was not recorded`);
  return rowToRuntimePolicy(row);
}

function policyParams(policy: AssignedRuntimePolicy) {
  return [
    policy.userId,
    policy.tenantId,
    policy.policyVersion,
    policy.imageAlias,
    policy.memoryMiB,
    policy.cpuMillicores,
    policy.pidsLimit,
    policy.sourceIssuedAt,
    policy.createdAt,
    policy.updatedAt,
  ] as const;
}

function rowToRuntimePolicy(row: Record<string, unknown>): AssignedRuntimePolicy {
  return assignedRuntimePolicySchema.parse({
    userId: Number(row.user_id),
    tenantId: Number(row.tenant_id),
    policyVersion: Number(row.policy_version),
    imageAlias: row.image_alias,
    memoryMiB: Number(row.memory_mib),
    cpuMillicores: Number(row.cpu_millicores),
    pidsLimit: Number(row.pids_limit),
    sourceIssuedAt: row.source_issued_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  });
}

function positiveUserId(userId: number): number {
  if (!Number.isInteger(userId) || userId <= 0) {
    throw new Error("User ID must be a positive integer");
  }
  return userId;
}
