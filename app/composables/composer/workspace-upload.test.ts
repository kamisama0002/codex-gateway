import { describe, expect, it } from "vitest";
import { buildWorkspaceUploadFormData, workspaceUploadLimitViolation } from "./workspace-upload";

describe("browser workspace upload batch", () => {
  it("uses webkitRelativePath to preserve a selected folder", () => {
    const file = browserFile("revenue.csv", 2, "finance/2026/revenue.csv");
    const form = buildWorkspaceUploadFormData([file], "folder");

    const uploaded = form.getAll("files");
    expect(uploaded).toHaveLength(1);
    expect(uploaded[0]).toBeInstanceOf(File);
    expect(uploadedFilename(uploaded[0])).toBe("finance/2026/revenue.csv");
  });

  it("uploads individually selected files at the project root", () => {
    const file = browserFile("report.csv", 2, "ignored/folder/report.csv");
    const form = buildWorkspaceUploadFormData([file], "files");

    expect(uploadedFilename(form.get("files"))).toBe("report.csv");
  });

  it("reports count, individual size, and total size violations", () => {
    expect(
      workspaceUploadLimitViolation(Array.from({ length: 201 }, () => browserFile("x", 1))),
    ).toBe("count");
    expect(workspaceUploadLimitViolation([browserFile("large", 25 * 1024 * 1024 + 1)])).toBe(
      "fileSize",
    );
    expect(
      workspaceUploadLimitViolation(
        Array.from({ length: 9 }, (_, index) => browserFile(`part-${index}`, 23 * 1024 * 1024)),
      ),
    ).toBe("totalSize");
  });
});

function browserFile(name: string, size: number, relativePath = "") {
  const file = new File([], name, { type: "application/octet-stream" });
  Object.defineProperty(file, "size", { value: size });
  Object.defineProperty(file, "webkitRelativePath", { value: relativePath });
  return file;
}

function uploadedFilename(entry: FormDataEntryValue | null | undefined) {
  if (!(entry instanceof File)) throw new Error("Expected a file form entry");
  return entry.name;
}
