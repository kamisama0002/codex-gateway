import type { AuthenticatedUser } from "~~/server/utils/gateway/auth/users";

export const ALL_SETTINGS_PANELS = [
  "appearance",
  "pet",
  "providers",
  "runtime",
  "hosts",
  "notifications",
  "config",
] as const;

export type SettingsPanelKind = (typeof ALL_SETTINGS_PANELS)[number];

const PERSONAL_SETTINGS_PANELS: SettingsPanelKind[] = [
  "appearance",
  "pet",
  "runtime",
  "notifications",
];

export function settingsPanelsForUser(
  user: AuthenticatedUser | null | undefined,
): SettingsPanelKind[] {
  if (user === null || user === undefined || (user.dataOps && user.role !== "admin")) {
    return [...PERSONAL_SETTINGS_PANELS];
  }
  return [...ALL_SETTINGS_PANELS];
}
