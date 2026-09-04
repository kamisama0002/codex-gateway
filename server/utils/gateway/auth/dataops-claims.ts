import { z } from "zod";

export const dataOpsClaimsSchema = z
  .object({
    audience: z.literal("codex-gateway"),
    tenantId: z.number().int().positive(),
    userId: z.number().int().positive(),
    username: z.string().trim().min(1).max(256),
    externalSubject: z
      .string()
      .trim()
      .regex(/^dataops:\d+:\d+$/),
    contextType: z.literal("PROJECT"),
    projectId: z.number().int().positive(),
    runtimeProfile: z.string().trim().min(1).max(64),
    platformAdmin: z.boolean(),
    canDevelopAgents: z.boolean(),
    canManageAgentStatus: z.boolean(),
    canManageAgentRuntimeConfig: z.boolean(),
    permissions: z.array(z.string().trim().min(1).max(256)).default([]),
    authzVersion: z.number().int().positive(),
    issuedAt: z.string().refine((value) => Number.isFinite(Date.parse(value)), "Invalid issuedAt"),
    ticket: z.null().optional(),
  })
  .strict();

export type DataOpsClaims = z.infer<typeof dataOpsClaimsSchema>;

export interface DataOpsSessionContext {
  provider: "dataops";
  externalSubject: string;
  tenantId: number;
  dataOpsUserId: number;
  projectId: number;
  authzVersion: number;
}
