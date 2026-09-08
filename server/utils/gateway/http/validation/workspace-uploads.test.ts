import { describe, expect, it } from "vitest";
import * as uploadValidation from "./workspace-uploads";

describe("workspace upload paths", () => {
  it("preserves a safe folder hierarchy below the project root", () => {
    expect(normalize("reports/2026/revenue.csv")).toBe("reports/2026/revenue.csv");
    expect(resolve("/workspace/finance", "reports/2026/revenue.csv")).toBe(
      "/workspace/finance/reports/2026/revenue.csv",
    );
  });

  it.each(["", "/etc/passwd", "../secret", "safe/../../secret", "safe\\secret.txt", "C:/x"])(
    "rejects unsafe relative path %j",
    (path) => {
      expect(() => normalize(path)).toThrow();
    },
  );
});

function normalize(path: string) {
  const implementation = Reflect.get(uploadValidation, "normalizeWorkspaceUploadPath") as
    | ((value: string) => string)
    | undefined;
  if (implementation === undefined) throw new Error("normalizeWorkspaceUploadPath is missing");
  return implementation(path);
}

function resolve(root: string, path: string) {
  const implementation = Reflect.get(uploadValidation, "workspaceUploadRemotePath") as
    | ((root: string, relativePath: string) => string)
    | undefined;
  if (implementation === undefined) throw new Error("workspaceUploadRemotePath is missing");
  return implementation(root, path);
}
