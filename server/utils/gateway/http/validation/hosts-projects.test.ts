import { describe, expect, it } from "vitest";
import { MANAGED_RUNTIME_HOST_ID } from "~~/shared/runtime/managed-runtime";
import type { ProjectRecord } from "~~/shared/types";
import { constrainProjectUpdate } from "./hosts-projects";

const managedProject: ProjectRecord = {
  id: 10,
  hostId: MANAGED_RUNTIME_HOST_ID,
  name: "reports",
  remotePath: "/workspace/reports",
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
};

describe("constrainProjectUpdate", () => {
  it("allows a managed workspace rename without moving its directory", () => {
    expect(
      constrainProjectUpdate(managedProject, {
        hostId: MANAGED_RUNTIME_HOST_ID,
        name: "financial reports",
        remotePath: "/workspace/reports",
      }),
    ).toEqual({
      hostId: MANAGED_RUNTIME_HOST_ID,
      name: "financial reports",
      remotePath: "/workspace/reports",
    });
  });

  it("rejects managed workspace directory and host changes", () => {
    expect(() =>
      constrainProjectUpdate(managedProject, {
        hostId: MANAGED_RUNTIME_HOST_ID,
        name: "reports",
        remotePath: "/workspace/other",
      }),
    ).toThrow("Managed workspace path cannot be changed");
    expect(() =>
      constrainProjectUpdate(managedProject, {
        hostId: 99,
        name: "reports",
        remotePath: "/workspace/reports",
      }),
    ).toThrow("Project host cannot be changed");
  });
});
