import { z } from "zod";
import { capabilityIdSchema } from "../capabilities/schemas";

export const credentialIdSchema = z
  .string()
  .trim()
  .min(7)
  .max(128)
  .regex(/^cred__[a-z0-9][a-z0-9_.-]*$/u);

export const credentialKindSchema = z.enum([
  "token",
  "username_password",
  "ssh_private_key",
  "oauth",
  "external_issuer",
]);

export const credentialTargetSchema = z.discriminatedUnion("type", [
  z
    .object({
      type: z.literal("env"),
      name: z.string().regex(/^[A-Z][A-Z0-9_]{0,127}$/u, "Invalid environment target"),
    })
    .strict(),
  z
    .object({
      type: z.literal("file"),
      path: z
        .string()
        .regex(/^\/run\/codex-secrets\/[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$/u, "Invalid file target"),
    })
    .strict(),
]);

export const credentialMappingSchema = z
  .object({
    field: z.string().regex(/^[A-Za-z][A-Za-z0-9_]{0,127}$/u),
    target: credentialTargetSchema,
  })
  .strict();

const timestampSchema = z
  .string()
  .refine((value) => Number.isFinite(Date.parse(value)), "Invalid timestamp");

export const credentialCreateInputSchema = z
  .object({
    id: credentialIdSchema,
    capabilityId: capabilityIdSchema,
    userId: z.number().int().positive(),
    projectId: z.number().int().positive().nullable(),
    kind: credentialKindSchema,
    secret: z.record(
      z.string(),
      z
        .string()
        .min(1)
        .max(1024 * 1024),
    ),
    mappings: z.array(credentialMappingSchema).min(1).max(32),
    notBefore: timestampSchema.nullable(),
    expiresAt: timestampSchema.nullable(),
  })
  .strict()
  .superRefine((input, context) => {
    const required = requiredSecretFields(input.kind);
    if (required.some((field) => input.secret[field] === undefined)) {
      context.addIssue({ code: "custom", message: "Credential secret fields are incomplete" });
    }
    if (input.mappings.some((mapping) => input.secret[mapping.field] === undefined)) {
      context.addIssue({ code: "custom", message: "Credential mapping field is missing" });
    }
    if (
      input.notBefore !== null &&
      input.expiresAt !== null &&
      Date.parse(input.expiresAt) <= Date.parse(input.notBefore)
    ) {
      context.addIssue({ code: "custom", message: "Credential expiry must follow notBefore" });
    }
    const targets = input.mappings.map((mapping) => JSON.stringify(mapping.target));
    if (new Set(targets).size !== targets.length) {
      context.addIssue({ code: "custom", message: "Credential targets must be unique" });
    }
  });

export function parseCredentialCreateInput(value: unknown) {
  return credentialCreateInputSchema.parse(value);
}

export function parseCredentialMappings(value: unknown) {
  return z.array(credentialMappingSchema).min(1).max(32).parse(value);
}

export function parseCredentialSecret(
  kind: z.infer<typeof credentialKindSchema>,
  value: unknown,
  mappings: z.infer<typeof credentialMappingSchema>[],
) {
  const secret = z
    .record(
      z.string(),
      z
        .string()
        .min(1)
        .max(1024 * 1024),
    )
    .parse(value);
  const required = requiredSecretFields(kind);
  if (required.some((field) => secret[field] === undefined)) {
    throw new Error("Credential secret fields are incomplete");
  }
  if (mappings.some((mapping) => secret[mapping.field] === undefined)) {
    throw new Error("Credential mapping field is missing");
  }
  return secret;
}

function requiredSecretFields(kind: z.infer<typeof credentialKindSchema>) {
  switch (kind) {
    case "token":
    case "external_issuer":
      return ["token"];
    case "username_password":
      return ["username", "password"];
    case "ssh_private_key":
      return ["privateKey"];
    case "oauth":
      return ["accessToken"];
  }
}
