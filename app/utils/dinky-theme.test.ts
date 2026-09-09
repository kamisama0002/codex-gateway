import { describe, expect, it } from "vitest";
import {
  dinkyThemeMessage,
  isAllowedDinkyMessage,
  normalizeGatewayTheme,
  themeFromUrl,
} from "./dinky-theme";

describe("Dinky theme bridge", () => {
  it("normalizes Dinky's realDark value", () => {
    expect(normalizeGatewayTheme("realDark")).toBe("dark");
    expect(normalizeGatewayTheme("light")).toBe("light");
    expect(normalizeGatewayTheme("system")).toBeNull();
  });

  it("accepts an explicit theme URL override", () => {
    expect(themeFromUrl("https://gateway.example.com/?theme=realDark")).toBe("dark");
    expect(themeFromUrl("https://gateway.example.com/?navTheme=light")).toBe("light");
    expect(themeFromUrl("https://gateway.example.com/?theme=unknown")).toBeNull();
  });

  it("validates the Dinky message shape", () => {
    expect(dinkyThemeMessage({ source: "dinky", type: "theme-change", theme: "realDark" })).toEqual(
      { source: "dinky", type: "theme-change", theme: "realDark" },
    );
    expect(dinkyThemeMessage({ source: "other", type: "theme-change", theme: "dark" })).toBeNull();
    expect(
      dinkyThemeMessage({ source: "dinky", type: "theme-change", theme: "system" }),
    ).toBeNull();
  });

  it("only accepts messages from the parent window and its known origin", () => {
    const parent = {};
    const allowedOrigins = new Set(["https://dataops.example.com"]);

    expect(
      isAllowedDinkyMessage(
        { source: parent, origin: "https://dataops.example.com" },
        parent,
        allowedOrigins,
      ),
    ).toBe(true);
    expect(
      isAllowedDinkyMessage(
        { source: parent, origin: "https://evil.example.com" },
        parent,
        allowedOrigins,
      ),
    ).toBe(false);
    expect(
      isAllowedDinkyMessage(
        { source: {}, origin: "https://dataops.example.com" },
        parent,
        allowedOrigins,
      ),
    ).toBe(false);
  });
});
