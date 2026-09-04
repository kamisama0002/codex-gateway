import type { GatewayConfig, GatewayNotificationSettings, GatewayPetSettings } from "./types";
import { isGatewayPetId, type GatewayPetId } from "./types/pet";

// Keep first paint bounded for item-heavy Codex 0.147 histories. Older turns are fetched only by
// explicit history navigation; do not silently prepend a background page after the Agent viewport
// mounts. A same-page cached view may retain a wider depth that the user already loaded.
export const INITIAL_TURN_PAGE_LIMIT = 2;
export const OLDER_TURN_PAGE_LIMIT = 5;
export const SERVER_TURN_CACHE_LIMIT = 50;
export const SERVER_THREAD_CACHE_LIMIT = 100;
export const CLIENT_THREAD_CACHE_LIMIT = 24;
export const DEFAULT_BARK_SERVER_URL = "https://api.day.app";
export const DEFAULT_BARK_GROUP = "Codex Gateway";
export const DEFAULT_PET_ID: GatewayPetId = "codex";

export function defaultNotificationSettings(): GatewayNotificationSettings {
  return {
    bark: {
      enabled: false,
      serverUrl: DEFAULT_BARK_SERVER_URL,
      deviceKey: "",
      group: DEFAULT_BARK_GROUP,
    },
  };
}

export function normalizeNotificationSettings(
  settings?: Partial<GatewayNotificationSettings> | null,
): GatewayNotificationSettings {
  const defaults = defaultNotificationSettings();
  const serverUrl = settings?.bark?.serverUrl?.trim();
  const deviceKey = settings?.bark?.deviceKey?.trim();
  const group = settings?.bark?.group?.trim();
  return {
    bark: {
      ...defaults.bark,
      ...settings?.bark,
      serverUrl:
        serverUrl === "" ? defaults.bark.serverUrl : (serverUrl ?? defaults.bark.serverUrl),
      deviceKey: deviceKey ?? "",
      group: group === "" ? defaults.bark.group : (group ?? defaults.bark.group),
    },
  };
}

export function defaultPetSettings(): GatewayPetSettings {
  return { enabled: true, petId: DEFAULT_PET_ID, animations: true };
}

export function normalizePetSettings(
  settings?: Partial<GatewayPetSettings> | null,
): GatewayPetSettings {
  const defaults = defaultPetSettings();
  const petId = typeof settings?.petId === "string" ? settings.petId.trim() : "";
  return {
    enabled: settings?.enabled ?? defaults.enabled,
    petId: isGatewayPetId(petId) ? petId : defaults.petId,
    animations: settings?.animations ?? defaults.animations,
  };
}

export function defaultGatewayConfig(): GatewayConfig {
  return {
    version: 1,
    hosts: [],
    projects: [],
    pinnedThreads: [],
    notifications: defaultNotificationSettings(),
    pet: defaultPetSettings(),
  };
}
