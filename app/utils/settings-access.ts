import type { AuthenticatedUser } from "~~/server/utils/gateway/auth/users";

export const ALL_SETTINGS_PANELS = [
  "appearance",
  "pet",
  "providers",
  "capabilities",
  "runtime",
  "hosts",
  "notifications",
  "config",
  "integrations",
] as const;

export type SettingsPanelKind = (typeof ALL_SETTINGS_PANELS)[number];

const PERSONAL_SETTINGS_PANELS: SettingsPanelKind[] = [
  "appearance",
  "pet",
  "capabilities",
  "runtime",
  "notifications",
];

export function settingsPanelsForUser(
  user: AuthenticatedUser | null | undefined,
): SettingsPanelKind[] {
  if (user === null || user === undefined || (user.dataOps && user.role !== "admin")) {
    return [...PERSONAL_SETTINGS_PANELS];
  }
  return user.role === "admin"
    ? [...ALL_SETTINGS_PANELS]
    : ALL_SETTINGS_PANELS.filter((panel) => panel !== "integrations");
}
