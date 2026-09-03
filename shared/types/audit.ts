export type AuditMetadataValue = string | number | boolean | null;

export type AuditMetadata = Record<string, AuditMetadataValue>;

export interface AuditEventInput {
  actorUserId?: number | null;
  userId?: number | null;
  action: string;
  outcome: string;
  errorCode?: string | null;
  metadata?: AuditMetadata;
  createdAt?: string;
}

export interface AuditEventRecord {
  id: number;
  actorUserId: number | null;
  userId: number | null;
  action: string;
  outcome: string;
  errorCode: string | null;
  metadata: AuditMetadata;
  createdAt: string;
}
