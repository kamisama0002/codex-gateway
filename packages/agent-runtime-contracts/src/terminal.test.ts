import { describe, expect, it } from "vitest";
import {
  runtimeTerminalClientMessageSchema,
  runtimeTerminalOpenSchema,
  runtimeTerminalServerMessageSchema,
} from "./index";

describe("managed Runtime terminal contract", () => {
  it("accepts the strict client and server frame contract", () => {
    expect(
      runtimeTerminalOpenSchema.parse({
        type: "open",
        cwd: "/workspace/project-a",
        cols: 120,
        rows: 40,
      }),
    ).toEqual({ type: "open", cwd: "/workspace/project-a", cols: 120, rows: 40 });
    expect(runtimeTerminalClientMessageSchema.parse({ type: "input", data: "pwd\r" })).toEqual({
      type: "input",
      data: "pwd\r",
    });
    expect(
      runtimeTerminalServerMessageSchema.parse({ type: "exit", code: 0 }),
    ).toEqual({ type: "exit", code: 0 });
  });

  it.each([
    { type: "open", cwd: "/etc", cols: 80, rows: 24 },
    { type: "open", cwd: "/workspace/../etc", cols: 80, rows: 24 },
    { type: "open", cwd: "/workspace", cols: 0, rows: 24 },
    { type: "open", cwd: "/workspace", cols: 80, rows: 1_001 },
    { type: "open", cwd: "/workspace", cols: 80, rows: 24, containerId: "private" },
  ])("rejects an unsafe open frame %#", (frame) => {
    expect(runtimeTerminalOpenSchema.safeParse(frame).success).toBe(false);
  });

  it("rejects input larger than 64 KiB and unknown fields", () => {
    expect(
      runtimeTerminalClientMessageSchema.safeParse({ type: "input", data: "x".repeat(65_537) })
        .success,
    ).toBe(false);
    expect(
      runtimeTerminalClientMessageSchema.safeParse({ type: "close", reason: "hidden" }).success,
    ).toBe(false);
  });
});
