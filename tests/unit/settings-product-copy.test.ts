import { describe, expect, it } from "vitest";
import en from "../../i18n/locales/en.json";
import zh from "../../i18n/locales/zh.json";
import { defaultNotificationSettings, normalizeNotificationSettings } from "../../shared/config";

const SETTINGS_COPY_KEYS = [
  "petSettingsDescription",
  "enablePetDescription",
  "interfaceLanguageDescription",
  "barkNotificationsDescription",
  "barkGroupPlaceholder",
  "runtimeSettingsDescription",
] as const;

describe("product-neutral settings copy", () => {
  it.each([
    ["English", en.app],
    ["Chinese", zh.app],
  ] as const)("does not expose the engine brand in %s settings copy", (_locale, messages) => {
    for (const key of SETTINGS_COPY_KEYS) {
      expect(messages[key]).not.toMatch(/codex/i);
    }
  });

  it("uses the product group for new Bark settings", () => {
    expect(defaultNotificationSettings().bark.group).toBe("Agent Platform");
  });

  it("migrates only the previous default Bark group", () => {
    expect(
      normalizeNotificationSettings({
        bark: {
          enabled: true,
          serverUrl: "https://api.day.app",
          deviceKey: "device",
          group: "Codex Gateway",
        },
      }).bark.group,
    ).toBe("Agent Platform");
    expect(
      normalizeNotificationSettings({
        bark: {
          enabled: true,
          serverUrl: "https://api.day.app",
          deviceKey: "device",
          group: "Operations",
        },
      }).bark.group,
    ).toBe("Operations");
  });
});
