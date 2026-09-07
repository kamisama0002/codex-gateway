import { describe, expect, it, vi } from "vitest";
import { copyMessageText } from "./message-copy";

describe("message copy", () => {
  it("writes the complete user message", async () => {
    const write = vi.fn(async () => undefined);

    await expect(copyMessageText("第一行\n第二行", true, write)).resolves.toBe(true);
    expect(write).toHaveBeenCalledWith("第一行\n第二行");
  });

  it("reports unavailable and failed clipboard writes", async () => {
    const unavailableWrite = vi.fn(async () => undefined);
    const failedWrite = vi.fn(async () => {
      throw new Error("clipboard denied");
    });

    await expect(copyMessageText("消息", false, unavailableWrite)).resolves.toBe(false);
    expect(unavailableWrite).not.toHaveBeenCalled();
    await expect(copyMessageText("消息", true, failedWrite)).resolves.toBe(false);
  });
});
