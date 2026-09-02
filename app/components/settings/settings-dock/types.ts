export type SettingsPanelKind = "appearance" | "config" | "hosts" | "notifications" | "runtime";

export interface SettingsDockPanelParams {
  kind: SettingsPanelKind;
}
