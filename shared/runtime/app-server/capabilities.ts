import { z } from "zod";

const nullableString = z.string().nullable().optional();

const skillToolDependencySchema = z
  .object({
    type: z.string(),
    value: z.string(),
    command: nullableString,
    description: nullableString,
    transport: nullableString,
    url: nullableString,
  })
  .strict();

const skillMetadataSchema = z
  .object({
    name: z.string(),
    description: z.string(),
    path: z.string(),
    scope: z.enum(["user", "repo", "system", "admin"]),
    enabled: z.boolean(),
    shortDescription: nullableString,
    pluginId: nullableString,
    interface: z
      .object({
        displayName: nullableString,
        shortDescription: nullableString,
        defaultPrompt: nullableString,
        brandColor: nullableString,
        iconSmall: nullableString,
        iconLarge: nullableString,
        iconSmallUrl: nullableString,
        iconLargeUrl: nullableString,
      })
      .strict()
      .nullable()
      .optional(),
    dependencies: z
      .object({ tools: z.array(skillToolDependencySchema) })
      .strict()
      .nullable()
      .optional(),
  })
  .strict();

export const skillsListResponseSchema = z
  .object({
    data: z.array(
      z
        .object({
          cwd: z.string(),
          skills: z.array(skillMetadataSchema),
          errors: z.array(z.object({ path: z.string(), message: z.string() }).strict()),
        })
        .strict(),
    ),
  })
  .strict();

const pluginSourceSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("local"), path: z.string() }).strict(),
  z
    .object({
      type: z.literal("git"),
      url: z.string(),
      path: nullableString,
      refName: nullableString,
      sha: nullableString,
    })
    .strict(),
  z
    .object({
      type: z.literal("npm"),
      package: z.string(),
      version: nullableString,
      registry: nullableString,
    })
    .strict(),
  z.object({ type: z.literal("remote") }).strict(),
]);

const pluginSummarySchema = z
  .object({
    id: z.string(),
    remotePluginId: nullableString,
    version: nullableString,
    localVersion: nullableString,
    name: z.string(),
    shareContext: z.unknown().nullable().optional(),
    source: pluginSourceSchema,
    installed: z.boolean(),
    installedAt: z.number().int().nullable().optional(),
    enabled: z.boolean(),
    installPolicy: z.enum(["NOT_AVAILABLE", "AVAILABLE", "INSTALLED_BY_DEFAULT"]),
    installPolicySource: z
      .enum(["WORKSPACE_SETTING", "IMPLICIT_CANONICAL_APP"])
      .nullable()
      .optional(),
    mustShowInstallationInterstitial: z.boolean().nullable().optional(),
    authPolicy: z.enum(["ON_INSTALL", "ON_USE"]),
    availability: z.enum(["DISABLED_BY_ADMIN", "AVAILABLE"]).optional(),
    disabledReason: z
      .enum(["disabled_by_admin", "plan_not_eligible", "required_app_unavailable", "unknown"])
      .nullable()
      .optional(),
    eligiblePlanTypes: z.array(z.string()).nullable().optional(),
    interface: z.unknown().nullable().optional(),
    keywords: z.array(z.string()).optional(),
  })
  .strict();

const pluginMarketplaceEntrySchema = z
  .object({
    name: z.string(),
    path: nullableString,
    interface: z.object({ displayName: nullableString }).strict().nullable().optional(),
    plugins: z.array(pluginSummarySchema),
  })
  .strict();

export const pluginListResponseSchema = z
  .object({
    marketplaces: z.array(pluginMarketplaceEntrySchema),
    marketplaceLoadErrors: z
      .array(z.object({ marketplacePath: z.string(), message: z.string() }).strict())
      .optional()
      .default([]),
    featuredPluginIds: z.array(z.string()).optional().default([]),
  })
  .strict();

const appInfoSchema = z
  .object({
    id: z.string(),
    name: z.string(),
    description: nullableString,
    installUrl: nullableString,
    logoUrl: nullableString,
    logoUrlDark: nullableString,
    distributionChannel: nullableString,
    labels: z.record(z.string(), z.string()).nullable().optional(),
    iconAssets: z.record(z.string(), z.string()).nullable().optional(),
    iconDarkAssets: z.record(z.string(), z.string()).nullable().optional(),
    appMetadata: z.unknown().nullable().optional(),
    branding: z.unknown().nullable().optional(),
    isAccessible: z.boolean().optional(),
    isEnabled: z.boolean().optional(),
    pluginDisplayNames: z.array(z.string()).optional(),
  })
  .strict();

export const appsListResponseSchema = z
  .object({ data: z.array(appInfoSchema), nextCursor: z.string().nullable().optional() })
  .strict();

export const appsInstalledResponseSchema = z
  .object({
    apps: z.array(
      z
        .object({
          id: z.string(),
          runtimeName: nullableString,
          enabled: z.boolean(),
          callable: z.boolean(),
        })
        .strict(),
    ),
  })
  .strict();

const mcpRuntimeStatusSchema = z.enum([
  "notStarted",
  "starting",
  "connected",
  "authenticationRequired",
  "failed",
  "cancelled",
  "disabled",
]);

const mcpAuthStatusSchema = z.enum([
  "unknown",
  "unsupported",
  "notLoggedIn",
  "bearerToken",
  "oAuth",
]);

export const capabilityMcpServerStatusPageSchema = z
  .object({
    data: z.array(
      z
        .object({
          name: z.string(),
          runtimeStatus: mcpRuntimeStatusSchema.nullable().optional(),
          pluginId: nullableString,
          serverInfo: z.unknown().nullable().optional(),
          tools: z.record(z.string(), z.unknown()),
          resources: z.array(z.unknown()),
          resourceTemplates: z.array(z.unknown()),
          authStatus: mcpAuthStatusSchema,
        })
        .strict(),
    ),
    nextCursor: z.string().nullable().optional(),
  })
  .strict();

export const capabilityConfigReadResponseSchema = z
  .object({
    config: z.record(z.string(), z.unknown()),
    origins: z.record(z.string(), z.unknown()),
    layers: z.array(z.unknown()).nullable().optional(),
  })
  .strict();

export const skillConfigWriteResponseSchema = z.object({ effectiveEnabled: z.boolean() }).strict();

export const marketplaceAddResponseSchema = z
  .object({
    marketplaceName: z.string(),
    installedRoot: z.string(),
    alreadyAdded: z.boolean(),
  })
  .strict();

export const marketplaceUpgradeResponseSchema = z
  .object({
    selectedMarketplaces: z.array(z.string()),
    upgradedRoots: z.array(z.string()),
    errors: z.array(z.object({ marketplaceName: z.string(), message: z.string() }).strict()),
  })
  .strict();

export const marketplaceRemoveResponseSchema = z
  .object({ marketplaceName: z.string(), installedRoot: z.string().nullable().optional() })
  .strict();

export const pluginInstallResponseSchema = z
  .object({
    authPolicy: z.enum(["ON_INSTALL", "ON_USE"]),
    appsNeedingAuth: z.array(
      z
        .object({
          id: z.string(),
          name: z.string(),
          description: nullableString,
          installUrl: nullableString,
          category: nullableString,
        })
        .strict(),
    ),
  })
  .strict();

export const configWriteResponseSchema = z
  .object({
    filePath: z.string(),
    status: z.enum(["ok", "okOverridden"]),
    version: z.string(),
    overriddenMetadata: z.unknown().nullable().optional(),
  })
  .strict();

export const emptyCapabilityResponseSchema = z.object({}).strict();

export function parseSkillsListResponse(value: unknown) {
  return skillsListResponseSchema.parse(value);
}

export function parsePluginListResponse(value: unknown) {
  return pluginListResponseSchema.parse(value);
}

export function parseAppsListResponse(value: unknown) {
  return appsListResponseSchema.parse(value);
}

export function parseAppsInstalledResponse(value: unknown) {
  return appsInstalledResponseSchema.parse(value);
}

export function parseCapabilityMcpServerStatusPage(value: unknown) {
  return capabilityMcpServerStatusPageSchema.parse(value);
}

export function parseCapabilityConfigReadResponse(value: unknown) {
  return capabilityConfigReadResponseSchema.parse(value);
}

export function parseSkillConfigWriteResponse(value: unknown) {
  return skillConfigWriteResponseSchema.parse(value);
}

export function parseMarketplaceAddResponse(value: unknown) {
  return marketplaceAddResponseSchema.parse(value);
}

export function parseMarketplaceUpgradeResponse(value: unknown) {
  return marketplaceUpgradeResponseSchema.parse(value);
}

export function parseMarketplaceRemoveResponse(value: unknown) {
  return marketplaceRemoveResponseSchema.parse(value);
}

export function parsePluginInstallResponse(value: unknown) {
  return pluginInstallResponseSchema.parse(value);
}

export function parseConfigWriteResponse(value: unknown) {
  return configWriteResponseSchema.parse(value);
}

export function parseEmptyCapabilityResponse(value: unknown) {
  return emptyCapabilityResponseSchema.parse(value);
}
