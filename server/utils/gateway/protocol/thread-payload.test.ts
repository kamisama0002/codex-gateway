import { describe, expect, it } from "vitest";
import {
  DEFAULT_THREAD_SANDBOX,
  buildAppServerThreadStartParams,
} from "./thread-payload";

describe("buildAppServerThreadStartParams", () => {
  it("defaults new threads to Desktop Agent workspace-write sandbox", () => {
    expect(buildAppServerThreadStartParams({ cwd: "/workspace" })).toEqual({
      cwd: "/workspace",
      sandbox: DEFAULT_THREAD_SANDBOX,
      historyMode: "paginated",
      experimentalRawEvents: true,
    });
    expect(DEFAULT_THREAD_SANDBOX).toBe("workspace-write");
  });

  it("keeps an explicit sandbox override", () => {
    expect(
      buildAppServerThreadStartParams({
        cwd: "/workspace",
        sandbox: "read-only",
      }).sandbox,
    ).toBe("read-only");
  });
});
