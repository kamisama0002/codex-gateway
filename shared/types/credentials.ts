export type CredentialKind =
  | "token"
  | "username_password"
  | "ssh_private_key"
  | "oauth"
  | "external_issuer";

export type CredentialTarget = { type: "env"; name: string } | { type: "file"; path: string };

export interface CredentialMapping {
  field: string;
  target: CredentialTarget;
}

export interface CredentialCreateInput {
  id: string;
  capabilityId: string;
  userId: number;
  projectId: number | null;
  kind: CredentialKind;
  secret: Record<string, string>;
  mappings: CredentialMapping[];
  notBefore: string | null;
  expiresAt: string | null;
}

export interface CredentialDescriptor {
  id: string;
  capabilityId: string;
  userId: number;
  projectId: number | null;
  kind: CredentialKind;
  mappings: CredentialMapping[];
  notBefore: string | null;
  expiresAt: string | null;
  revokedAt: string | null;
  version: number;
  createdAt: string;
  updatedAt: string;
}

export interface DecryptedCredential extends CredentialDescriptor {
  secret: Record<string, string>;
}

export interface ResolvedRuntimeSecret {
  credentialId: string;
  capabilityId: string;
  version: number;
  target: CredentialTarget;
  value: string;
}
