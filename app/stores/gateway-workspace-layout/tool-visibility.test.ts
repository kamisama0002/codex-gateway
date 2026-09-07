import { createPinia, setActivePinia } from "pinia";
import type { Ref } from "vue";
import { beforeEach, describe, expect, it, vi } from "vitest";

const storage = vi.hoisted(() => new Map<string, Ref<unknown>>());

vi.mock("@/composables/storage/useAccountLocalStorage", async () => {
  const { ref } = await import("vue");
  return {
    useAccountLocalStorage(suffix: string, initialValue: unknown) {
      const existing = storage.get(suffix);
      if (existing !== undefined) return existing;
      const value = ref(initialValue);
      storage.set(suffix, value);
      return value;
    },
  };
});

import { useGatewayWorkspaceLayoutStore } from "./index";

describe("workspace tool visibility", () => {
  beforeEach(() => {
    storage.clear();
    setActivePinia(createPinia());
  });

  it("opens the tool sidebar by default and isolates explicit visibility by scope", () => {
    const layout = useGatewayWorkspaceLayoutStore();

    expect(layout.isToolSidebarOpen("host:project:one")).toBe(true);
    layout.setToolSidebarOpen("host:project:one", false);

    expect(layout.isToolSidebarOpen("host:project:one")).toBe(false);
    expect(layout.isToolSidebarOpen("host:project:two")).toBe(true);
  });

  it("keeps Files closed until the current scope opens it", () => {
    const layout = useGatewayWorkspaceLayoutStore();

    expect(layout.isFilesPanelOpen("host:project:one")).toBe(false);
    expect(layout.hasFilesPanelPreference("host:project:one")).toBe(false);
    layout.setFilesPanelOpen("host:project:one", true);

    expect(layout.isFilesPanelOpen("host:project:one")).toBe(true);
    expect(layout.hasFilesPanelPreference("host:project:one")).toBe(true);
    expect(layout.isFilesPanelOpen("host:project:two")).toBe(false);
    layout.setFilesPanelOpen("host:project:one", false);
    expect(layout.hasFilesPanelPreference("host:project:one")).toBe(true);
  });
});
