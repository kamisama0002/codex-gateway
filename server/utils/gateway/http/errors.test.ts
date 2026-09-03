import { describe, expect, it } from "vitest";
import { z } from "zod";
import { publicErrorMessage } from "./errors";

describe("publicErrorMessage", () => {
  it("renders validation issues as readable text", () => {
    const result = z.object({ name: z.string().min(1, "Name is required") }).safeParse({
      name: "",
    });
    if (result.success) throw new Error("Expected validation to fail");
    expect(publicErrorMessage(result.error)).toBe("Name is required");
  });

  it("recovers issue messages serialized by an HTTP validation wrapper", () => {
    expect(
      publicErrorMessage(
        new Error(
          JSON.stringify([
            { code: "custom", path: [], message: "Workspace action is unavailable" },
          ]),
        ),
      ),
    ).toBe("Workspace action is unavailable");
  });
});
