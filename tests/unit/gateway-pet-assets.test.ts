import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  GATEWAY_PET_OPTIONS,
  PET_ANIMATIONS,
  petSpriteStyle,
  petSpritesheetRows,
  petSpritesheetUrl,
} from "../../app/utils/pets";

describe("gateway pet assets", () => {
  it("exposes only the three custom pets", () => {
    expect(GATEWAY_PET_OPTIONS).toEqual([
      { id: "congming", name: "葱明仔" },
      { id: "jiangjiang", name: "姜将仔" },
      { id: "suanlele", name: "蒜乐乐" },
    ]);
  });

  it.each([
    ["congming", 9],
    ["jiangjiang", 11],
    ["suanlele", 11],
  ] as const)("uses the correct atlas row count for %s", (petId, rows) => {
    expect(petSpritesheetRows(petId)).toBe(rows);
    expect(petSpritesheetUrl(petId)).toBe(`/pets/${petId}/spritesheet.webp`);
  });

  it.each(["congming", "jiangjiang", "suanlele"] as const)(
    "ships the local WebP atlas for %s",
    (petId) => {
      const bytes = readFileSync(resolve("public", "pets", petId, "spritesheet.webp"));
      expect(bytes.subarray(0, 4).toString("ascii")).toBe("RIFF");
      expect(bytes.subarray(8, 12).toString("ascii")).toBe("WEBP");
    },
  );

  it("positions v1 and v2 atlas rows using their actual heights", () => {
    expect(petSpriteStyle("congming", 32)).toMatchObject({
      backgroundPosition: "0% 50%",
      backgroundSize: "800% 900%",
    });
    expect(petSpriteStyle("jiangjiang", 32)).toMatchObject({
      backgroundPosition: "0% 40%",
      backgroundSize: "800% 1100%",
    });
  });

  it("uses the jumping row when a result is ready", () => {
    expect(PET_ANIMATIONS.ready.frames).toEqual([32, 33, 34, 35, 36]);
  });
});
