import { z } from "zod";
import type { GatewayConfig, GatewayPetSettings } from "~~/shared/types";
import { DEFAULT_BARK_GROUP, DEFAULT_BARK_SERVER_URL, DEFAULT_PET_ID } from "~~/shared/config";
import { GATEWAY_PET_IDS, isGatewayPetId } from "~~/shared/types/pet";
import { trimmedOrFallback, trimmedOrNull } from "~~/shared/utils/strings";
import { optionalPositiveInt } from "./common";
import { hostBaseSchema, validateHostProxy } from "./hosts-projects";
import {
  MANAGED_RUNTIME_HOST_ID,
  MANAGED_RUNTIME_PROJECT_ID,
} from "~~/shared/runtime/managed-runtime";

const LEGACY_GATEWAY_PET_IDS = new Set([
  "codex",
  "dewey",
  "fireball",
  "rocky",
  "seedy",
  "stacky",
  "bsod",
  "null-signal",
]);

export const pinnedThreadSchema = z
  .object({
    hostId: z.coerce.number().int().positive(),
    projectId: optionalPositiveInt.nullable().optional(),
    threadId: z.string().trim().min(1),
    title: z.string().trim().min(1),
    subtitle: z.string().trim().nullable().optional(),
    projectName: z.string().trim().nullable().optional(),
    updatedAt: z.coerce.number().nullable().optional(),
  })
  .strict();

export const notificationSettingsSchema = z
  .object({
    bark: z
      .object({
        enabled: z.boolean().default(false),
        serverUrl: z.url().default(DEFAULT_BARK_SERVER_URL),
        deviceKey: z.string().trim().default(""),
        group: z.string().trim().nullable().optional().default(DEFAULT_BARK_GROUP),
      })
      .strict()
      .default({
        enabled: false,
        serverUrl: DEFAULT_BARK_SERVER_URL,
        deviceKey: "",
        group: DEFAULT_BARK_GROUP,
      }),
  })
  .strict();

export const petSettingsSchema: z.ZodType<GatewayPetSettings> = z
  .object({
    enabled: z.boolean().default(true),
    petId: z
      .preprocess((value) => {
        const petId = typeof value === "string" ? value.trim() : value;
        return typeof petId === "string" && LEGACY_GATEWAY_PET_IDS.has(petId)
          ? DEFAULT_PET_ID
          : petId;
      }, z.enum(GATEWAY_PET_IDS))
      .default(DEFAULT_PET_ID),
    animations: z.boolean().default(true),
  })
  .strict()
  .default({ enabled: true, petId: DEFAULT_PET_ID, animations: true });

export const gatewayConfigSchema = z
  .object({
    version: z.literal(1).default(1),
    hosts: z
      .array(
        hostBaseSchema
          .extend({
            id: z.coerce.number().int().positive(),
            hasPassword: z.boolean().optional(),
            createdAt: z.string().optional(),
            updatedAt: z.string().optional(),
          })
          .superRefine(validateHostProxy),
      )
      .default([]),
    projects: z
      .array(
        z
          .object({
            id: z.coerce.number().int().positive(),
            hostId: z.coerce.number().int().positive(),
            name: z.string().trim().min(1),
            remotePath: z.string().trim().min(1),
            createdAt: z.string().optional(),
            updatedAt: z.string().optional(),
          })
          .strict(),
      )
      .default([]),
    pinnedThreads: z.array(pinnedThreadSchema).default([]),
    notifications: notificationSettingsSchema.default({
      bark: {
        enabled: false,
        serverUrl: DEFAULT_BARK_SERVER_URL,
        deviceKey: "",
        group: DEFAULT_BARK_GROUP,
      },
    }),
    pet: petSettingsSchema,
  })
  .strict()
  .transform((config) => ({
    ...config,
    hosts: config.hosts.filter((host) => host.id !== MANAGED_RUNTIME_HOST_ID),
    projects: config.projects.filter((project) => project.id !== MANAGED_RUNTIME_PROJECT_ID),
  }));

export function parseGatewayConfig(body: unknown): GatewayConfig {
  const input = gatewayConfigSchema.parse(body);
  const timestamp = new Date().toISOString();
  return {
    version: 1,
    hosts: input.hosts.map((host) => ({
      id: host.id,
      name: host.name.trim(),
      sshHost: host.sshHost.trim(),
      username: trimmedOrNull(host.username),
      port: host.port ?? null,
      authMode: host.authMode,
      privateKeyPath: trimmedOrNull(host.privateKeyPath),
      privateKey: host.privateKey ?? null,
      password: host.password ?? null,
      proxyUrl: trimmedOrNull(host.proxyUrl),
      hasPassword:
        typeof host.password === "string" ? host.password.length > 0 : (host.hasPassword ?? false),
      createdAt: host.createdAt ?? timestamp,
      updatedAt: host.updatedAt ?? timestamp,
    })),
    projects: input.projects.map((project) => ({
      id: project.id,
      hostId: project.hostId,
      name: project.name.trim(),
      remotePath: project.remotePath.trim(),
      createdAt: project.createdAt ?? timestamp,
      updatedAt: project.updatedAt ?? timestamp,
    })),
    pinnedThreads: input.pinnedThreads.map((thread) => ({
      hostId: thread.hostId,
      projectId: thread.projectId ?? null,
      threadId: thread.threadId.trim(),
      title: thread.title.trim(),
      subtitle: trimmedOrNull(thread.subtitle),
      projectName: trimmedOrNull(thread.projectName),
      updatedAt: thread.updatedAt ?? null,
    })),
    notifications: {
      bark: {
        enabled: input.notifications.bark.enabled,
        serverUrl: trimmedOrFallback(input.notifications.bark.serverUrl, DEFAULT_BARK_SERVER_URL),
        deviceKey: input.notifications.bark.deviceKey.trim(),
        group: trimmedOrFallback(input.notifications.bark.group, DEFAULT_BARK_GROUP),
      },
    },
    pet: {
      enabled: input.pet.enabled,
      petId: isGatewayPetId(input.pet.petId) ? input.pet.petId : DEFAULT_PET_ID,
      animations: input.pet.animations,
    },
  };
}
