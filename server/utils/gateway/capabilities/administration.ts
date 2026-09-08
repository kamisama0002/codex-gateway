import type {
  AdminCapabilityCatalog,
  CapabilityAdminUser,
  CapabilityAssignment,
  CapabilityCreateInput,
  CapabilityDefinition,
  CapabilityDeploymentStatus,
  CapabilitySyncRecord,
  CapabilityUpdateInput,
  CredentialCreateInput,
  CredentialDescriptor,
  UserCapabilityCatalog,
} from "~~/shared/types";
import type { AuditEventInput } from "~~/shared/types/audit";
import { auditStore } from "../audit/audit-store";
import { credentialStore } from "../credentials/store";
import { gatewayDatabase } from "../storage/database";
import { runtimeService } from "../runtime-manager/runtime-service";
import { reconcileUserRuntime } from "./reconciler";
import { capabilityStore } from "./store";
import { capabilitySyncStore } from "./sync-store";
import { DINKY_MCP_CAPABILITY_ID } from "../integrations/dataops-mcp-capability";
import { DEFAULT_INFINITY_MCP_CAPABILITY_ID } from "~~/shared/types/capabilities";

interface CapabilityStorePort {
  create(input: CapabilityCreateInput): Promise<CapabilityDefinition>;
  get(id: string): Promise<CapabilityDefinition | null>;
  list(): Promise<CapabilityDefinition[]>;
  update(id: string, input: CapabilityUpdateInput): Promise<CapabilityDefinition>;
  delete(id: string): Promise<boolean>;
  assign(input: {
    capabilityId: string;
    userId: number;
    projectId: number | null;
  }): Promise<CapabilityAssignment>;
  unassign(input: {
    capabilityId: string;
    userId: number;
    projectId: number | null;
  }): Promise<boolean>;
  listAssignments(capabilityId: string): Promise<CapabilityAssignment[]>;
  listDesiredForContext(input: {
    userId: number;
    projectId: number | null;
  }): Promise<CapabilityDefinition[]>;
}

interface CredentialStorePort {
  create(input: CredentialCreateInput): Promise<CredentialDescriptor>;
  get(id: string): Promise<CredentialDescriptor | null>;
  list(userId?: number): Promise<CredentialDescriptor[]>;
  rotate(id: string, secret: Record<string, string>): Promise<CredentialDescriptor>;
  revoke(id: string): Promise<CredentialDescriptor>;
}

interface CapabilitySyncStorePort {
  get(userId: number, projectId: number | null): Promise<CapabilitySyncRecord | null>;
  list(userId?: number): Promise<CapabilitySyncRecord[]>;
}

interface CapabilityAdministrationOptions {
  capabilities: CapabilityStorePort;
  credentials: CredentialStorePort;
  syncs: CapabilitySyncStorePort;
  audit: { record(input: AuditEventInput): Promise<unknown> };
  reconcile(input: {
    userId: number;
    projectId: number | null;
    reason: "assignmentChanged";
  }): Promise<{ status: "succeeded" | "failed" }>;
  syncSecrets(userId: number, projectId: number | null, actorUserId: number): Promise<unknown>;
  listUsers(): Promise<CapabilityAdminUser[]>;
  now?: () => number;
}

export class CapabilityAdministrationService {
  private readonly now: () => number;

  constructor(private readonly options: CapabilityAdministrationOptions) {
    this.now = options.now ?? Date.now;
  }

  async listAdminCatalog(): Promise<AdminCapabilityCatalog> {
    const [definitions, credentials, syncs, users] = await Promise.all([
      this.options.capabilities.list(),
      this.options.credentials.list(),
      this.options.syncs.list(),
      this.options.listUsers(),
    ]);
    const capabilities = await Promise.all(
      definitions.filter(isVisibleCapability).map(async (definition) => {
        const assignments = await this.options.capabilities.listAssignments(definition.id);
        return {
          ...definition,
          assignments,
          credentials: credentials.filter((item) => item.capabilityId === definition.id),
          deployments: assignments.map((assignment) => deploymentForAssignment(assignment, syncs)),
        };
      }),
    );
    return { capabilities, users };
  }

  async listUserCatalog(userId: number, projectId: number | null): Promise<UserCapabilityCatalog> {
    const [definitions, credentials, sync] = await Promise.all([
      this.options.capabilities.listDesiredForContext({ userId, projectId }),
      this.options.credentials.list(userId),
      this.options.syncs.get(userId, projectId),
    ]);
    return {
      userId,
      projectId,
      capabilities: definitions.filter(isVisibleCapability).map((definition) => {
        const matchingCredentials = credentials.filter(
          (credential) =>
            credential.capabilityId === definition.id &&
            (credential.projectId === null || credential.projectId === projectId),
        );
        return {
          ...definition,
          credentials: matchingCredentials,
          credentialStatus: credentialStatus(definition, matchingCredentials, this.now()),
          deploymentStatus: deploymentStatus(sync),
          safeError: sync?.safeError ?? null,
        };
      }),
    };
  }

  async createCapability(input: CapabilityCreateInput, actorUserId: number) {
    const capability = await this.options.capabilities.create({
      ...input,
      createdByUserId: actorUserId,
    });
    await this.options.audit.record({
      actorUserId,
      action: "capability.create",
      outcome: "success",
      metadata: { capabilityId: capability.id },
    });
    return capability;
  }

  async createPersonalMcp(input: CapabilityCreateInput, actorUserId: number) {
    this.assertPersonalMcpInput(input);
    const capability = await this.options.capabilities.create({
      ...input,
      kind: "mcp",
      source: { type: "internal", locator: `personal-mcp:${actorUserId}` },
      createdByUserId: actorUserId,
    });
    let assignment: CapabilityAssignment;
    try {
      assignment = await this.options.capabilities.assign({
        capabilityId: capability.id,
        userId: actorUserId,
        projectId: null,
      });
    } catch (error) {
      await this.options.capabilities.delete(capability.id).catch(() => false);
      throw error;
    }
    await this.options.audit.record({
      actorUserId,
      userId: actorUserId,
      action: "personal_mcp.create",
      outcome: "success",
      metadata: { capabilityId: capability.id },
    });
    return {
      capability,
      assignment,
      sync: await this.tryReconcile(actorUserId, null),
    };
  }

  async updatePersonalMcp(id: string, input: CapabilityUpdateInput, actorUserId: number) {
    await this.requiredPersonalMcp(id, actorUserId);
    const { source: _source, ...safeInput } = input;
    const assignments = await this.options.capabilities.listAssignments(id);
    const capability = await this.options.capabilities.update(id, safeInput);
    await this.options.audit.record({
      actorUserId,
      userId: actorUserId,
      action: "personal_mcp.update",
      outcome: "success",
      metadata: { capabilityId: id },
    });
    return { capability, syncs: await this.reconcileAssignments(assignments) };
  }

  async deletePersonalMcp(id: string, actorUserId: number) {
    await this.requiredPersonalMcp(id, actorUserId);
    const assignments = await this.options.capabilities.listAssignments(id);
    if (!(await this.options.capabilities.delete(id))) {
      throw new CapabilityAdministrationError("Capability not found", 404);
    }
    await this.options.audit.record({
      actorUserId,
      userId: actorUserId,
      action: "personal_mcp.delete",
      outcome: "success",
      metadata: { capabilityId: id },
    });
    return { deleted: true, syncs: await this.reconcileAssignments(assignments) };
  }

  async createPersonalCredential(input: CredentialCreateInput, actorUserId: number) {
    await this.requiredPersonalMcp(input.capabilityId, actorUserId);
    const credential = await this.options.credentials.create({
      ...input,
      userId: actorUserId,
      projectId: null,
    });
    await this.auditCredential("personal_mcp.credential.create", credential, actorUserId);
    return {
      credential,
      runtimeSync: await this.trySyncSecrets(credential, actorUserId),
    };
  }

  async revokePersonalCredential(id: string, actorUserId: number) {
    const current = await this.requiredPersonalCredential(id, actorUserId);
    const credential = await this.options.credentials.revoke(id);
    await this.auditCredential("personal_mcp.credential.revoke", credential, actorUserId);
    return {
      credential,
      runtimeSync: await this.trySyncSecrets(current, actorUserId),
    };
  }

  async updateCapability(id: string, input: CapabilityUpdateInput, actorUserId: number) {
    this.assertMutable(id);
    const assignments = await this.options.capabilities.listAssignments(id);
    const capability = await this.options.capabilities.update(id, input);
    await this.options.audit.record({
      actorUserId,
      action: "capability.update",
      outcome: "success",
      metadata: { capabilityId: id },
    });
    return { capability, syncs: await this.reconcileAssignments(assignments) };
  }

  async deleteCapability(id: string, actorUserId: number) {
    this.assertMutable(id);
    const assignments = await this.options.capabilities.listAssignments(id);
    if (!(await this.options.capabilities.delete(id))) {
      throw new CapabilityAdministrationError("Capability not found", 404);
    }
    await this.options.audit.record({
      actorUserId,
      action: "capability.delete",
      outcome: "success",
      metadata: { capabilityId: id },
    });
    return { deleted: true, syncs: await this.reconcileAssignments(assignments) };
  }

  async setAssignment(
    input: {
      capabilityId: string;
      userId: number;
      projectId: number | null;
      assigned: boolean;
    },
    actorUserId: number,
  ) {
    this.assertMutable(input.capabilityId);
    const assignmentInput = {
      capabilityId: input.capabilityId,
      userId: input.userId,
      projectId: input.projectId,
    };
    const assignment = input.assigned
      ? await this.options.capabilities.assign(assignmentInput)
      : null;
    const changed = input.assigned
      ? true
      : await this.options.capabilities.unassign(assignmentInput);
    await this.options.audit.record({
      actorUserId,
      userId: input.userId,
      action: input.assigned ? "capability.assign" : "capability.unassign",
      outcome: "success",
      metadata: { capabilityId: input.capabilityId, projectId: input.projectId },
    });
    const sync = await this.tryReconcile(input.userId, input.projectId);
    return { assigned: input.assigned, changed, assignment, sync };
  }

  async createCredential(input: CredentialCreateInput, actorUserId: number) {
    this.assertMutable(input.capabilityId);
    const credential = await this.options.credentials.create(input);
    await this.auditCredential("credential.create", credential, actorUserId);
    return {
      credential,
      runtimeSync: await this.trySyncSecrets(credential, actorUserId),
    };
  }

  async rotateCredential(id: string, secret: Record<string, string>, actorUserId: number) {
    const current = await this.requiredCredential(id);
    this.assertMutable(current.capabilityId);
    const credential = await this.options.credentials.rotate(id, secret);
    await this.auditCredential("credential.rotate", credential, actorUserId);
    return {
      credential,
      runtimeSync: await this.trySyncSecrets(current, actorUserId),
    };
  }

  async revokeCredential(id: string, actorUserId: number) {
    const current = await this.requiredCredential(id);
    this.assertMutable(current.capabilityId);
    const credential = await this.options.credentials.revoke(id);
    await this.auditCredential("credential.revoke", credential, actorUserId);
    return {
      credential,
      runtimeSync: await this.trySyncSecrets(current, actorUserId),
    };
  }

  private async reconcileAssignments(assignments: CapabilityAssignment[]) {
    const unique = new Map(
      assignments.map((assignment) => [
        `${assignment.userId}:${assignment.projectId ?? "global"}`,
        assignment,
      ]),
    );
    return await Promise.all(
      [...unique.values()].map(
        async (assignment) => await this.tryReconcile(assignment.userId, assignment.projectId),
      ),
    );
  }

  private assertMutable(id: string) {
    if (id === DINKY_MCP_CAPABILITY_ID) {
      throw new CapabilityAdministrationError("system_capability_read_only", 403);
    }
  }

  private assertPersonalMcpInput(input: CapabilityCreateInput) {
    if (input.kind !== "mcp") {
      throw new CapabilityAdministrationError("personal_capability_kind_invalid", 400);
    }
    if (isManagedPlatformMcp(input.id)) {
      throw new CapabilityAdministrationError("system_capability_read_only", 403);
    }
  }

  private async requiredPersonalMcp(id: string, actorUserId: number) {
    if (isManagedPlatformMcp(id)) {
      throw new CapabilityAdministrationError("system_capability_read_only", 403);
    }
    const capability = await this.options.capabilities.get(id);
    if (capability === null) {
      throw new CapabilityAdministrationError("personal_capability_not_found", 404);
    }
    if (capability.kind !== "mcp" || capability.createdByUserId !== actorUserId) {
      throw new CapabilityAdministrationError("personal_capability_forbidden", 403);
    }
    return capability;
  }

  private async requiredPersonalCredential(id: string, actorUserId: number) {
    const credential = await this.options.credentials.get(id);
    if (credential === null) {
      throw new CapabilityAdministrationError("personal_credential_not_found", 404);
    }
    if (credential.userId !== actorUserId) {
      throw new CapabilityAdministrationError("personal_credential_forbidden", 403);
    }
    await this.requiredPersonalMcp(credential.capabilityId, actorUserId);
    return credential;
  }

  private async tryReconcile(userId: number, projectId: number | null) {
    try {
      return await this.options.reconcile({ userId, projectId, reason: "assignmentChanged" });
    } catch {
      return { status: "pending" as const, safeError: "runtime_unavailable" };
    }
  }

  private async trySyncSecrets(credential: CredentialDescriptor, actorUserId: number) {
    try {
      await this.options.syncSecrets(credential.userId, credential.projectId, actorUserId);
      return { status: "succeeded" as const, safeError: null };
    } catch {
      return { status: "pending" as const, safeError: "runtime_unavailable" };
    }
  }

  private async requiredCredential(id: string) {
    const credential = await this.options.credentials.get(id);
    if (credential === null) throw new CapabilityAdministrationError("Credential not found", 404);
    return credential;
  }

  private async auditCredential(
    action: string,
    credential: CredentialDescriptor,
    actorUserId: number,
  ) {
    await this.options.audit.record({
      actorUserId,
      userId: credential.userId,
      action,
      outcome: "success",
      metadata: {
        capabilityId: credential.capabilityId,
        projectId: credential.projectId,
      },
    });
  }
}

export class CapabilityAdministrationError extends Error {
  constructor(
    message: string,
    readonly statusCode: number,
  ) {
    super(message);
  }
}

export const capabilityAdministrationService = new CapabilityAdministrationService({
  capabilities: capabilityStore,
  credentials: credentialStore,
  syncs: capabilitySyncStore,
  audit: auditStore,
  reconcile: reconcileUserRuntime,
  syncSecrets: (userId, projectId, actorUserId) =>
    runtimeService.syncSecrets(userId, projectId, actorUserId),
  listUsers: async () => {
    const rows = await gatewayDatabase().many(
      "SELECT id, username, role FROM users WHERE is_active = 1 ORDER BY username ASC, id ASC",
    );
    return rows.map((row) => ({
      id: Number(row.id),
      username: String(row.username),
      role: row.role === "admin" ? "admin" : "user",
    }));
  },
});

function deploymentForAssignment(assignment: CapabilityAssignment, syncs: CapabilitySyncRecord[]) {
  const sync = syncs.find(
    (item) => item.userId === assignment.userId && item.projectId === assignment.projectId,
  );
  return {
    userId: assignment.userId,
    projectId: assignment.projectId,
    status: deploymentStatus(sync),
    safeError: sync?.safeError ?? null,
    updatedAt: sync?.updatedAt ?? assignment.createdAt,
  };
}

function deploymentStatus(
  sync: CapabilitySyncRecord | null | undefined,
): CapabilityDeploymentStatus {
  if (sync === null || sync === undefined) return "unknown";
  if (sync.status === "succeeded") return "ready";
  if (sync.status === "failed") return "failed";
  return "syncing";
}

function credentialStatus(
  definition: CapabilityDefinition,
  credentials: CredentialDescriptor[],
  now: number,
) {
  if (credentials.length === 0) {
    return definition.sensitiveFields.length === 0
      ? ("notRequired" as const)
      : ("missing" as const);
  }
  const active = credentials.some(
    (credential) =>
      credential.revokedAt === null &&
      (credential.notBefore === null || Date.parse(credential.notBefore) <= now) &&
      (credential.expiresAt === null || Date.parse(credential.expiresAt) > now),
  );
  return active ? ("configured" as const) : ("expired" as const);
}

function isVisibleCapability(definition: CapabilityDefinition) {
  return !isManagedPlatformMcp(definition.id);
}

function isManagedPlatformMcp(id: string) {
  return id === DINKY_MCP_CAPABILITY_ID || id === DEFAULT_INFINITY_MCP_CAPABILITY_ID;
}
