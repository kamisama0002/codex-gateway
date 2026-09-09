import { z } from "zod";

export const dataOpsRuntimePolicySchema = z
  .object({
    version: z.literal(1),
    imageAlias: z.string().regex(/^[a-z0-9][a-z0-9._-]{0,63}$/),
    memoryMiB: z.number().int().min(128).max(16_384),
    // oxlint-disable-next-line typescript/no-deprecated -- Keep the wire contract explicitly finite.
    cpuCores: z.number().finite().min(0.25).max(8).multipleOf(0.01),
    pidsLimit: z.number().int().min(32).max(4096),
    // Zero is an explicit platform-admin override that disables idle recycling.
    idleTimeoutMinutes: z.number().int().min(0).max(1440).optional(),
  })
  .strict();

export type DataOpsRuntimePolicy = z.infer<typeof dataOpsRuntimePolicySchema>;

export interface AssignedRuntimePolicy {
  userId: number;
  tenantId: number;
  policyVersion: 1;
  imageAlias: string;
  memoryMiB: number;
  cpuMillicores: number;
  pidsLimit: number;
  idleTimeoutMinutes: number | null;
  sourceIssuedAt: string;
  createdAt: string;
  updatedAt: string;
}

export interface AssignRuntimePolicyInput {
  userId: number;
  tenantId: number;
  policy: DataOpsRuntimePolicy;
  sourceIssuedAt: string;
  now: string;
}

export const assignedRuntimePolicySchema: z.ZodType<AssignedRuntimePolicy> = z
  .object({
    userId: z.number().int().positive(),
    tenantId: z.number().int().positive(),
    policyVersion: z.literal(1),
    imageAlias: z.string().regex(/^[a-z0-9][a-z0-9._-]{0,63}$/),
    memoryMiB: z.number().int().min(128).max(16_384),
    cpuMillicores: z.number().int().min(250).max(8000).multipleOf(10),
    pidsLimit: z.number().int().min(32).max(4096),
    idleTimeoutMinutes: z.number().int().min(0).max(1440).nullable(),
    sourceIssuedAt: timestampSchema(),
    createdAt: timestampSchema(),
    updatedAt: timestampSchema(),
  })
  .strict();

export function assignRuntimePolicy(input: AssignRuntimePolicyInput): AssignedRuntimePolicy {
  const policy = dataOpsRuntimePolicySchema.parse(input.policy);
  const now = new Date(input.now).toISOString();
  return assignedRuntimePolicySchema.parse({
    userId: input.userId,
    tenantId: input.tenantId,
    policyVersion: policy.version,
    imageAlias: policy.imageAlias,
    memoryMiB: policy.memoryMiB,
    cpuMillicores: Math.round(policy.cpuCores * 1000),
    pidsLimit: policy.pidsLimit,
    idleTimeoutMinutes: policy.idleTimeoutMinutes ?? null,
    sourceIssuedAt: new Date(input.sourceIssuedAt).toISOString(),
    createdAt: now,
    updatedAt: now,
  });
}

function timestampSchema() {
  return z.string().refine((value) => Number.isFinite(Date.parse(value)), "Invalid timestamp");
}
