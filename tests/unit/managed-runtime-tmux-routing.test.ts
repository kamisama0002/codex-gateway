/// <reference types="node" />

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const managedTmuxEntrypoints = [
  "server/utils/gateway/realtime/handlers/tmux-sessions.ts",
  "server/api/hosts/[id]/tmux/panes/output.get.ts",
  "server/api/hosts/[id]/tmux/monitors.post.ts",
  "server/api/hosts/[id]/tmux/monitors/check.post.ts",
  "server/api/hosts/[id]/tmux/monitors/[monitorId].delete.ts",
  "server/api/hosts/[id]/tmux/monitors/[monitorId]/promote.post.ts",
];

describe("managed runtime tmux routing", () => {
  it.each(managedTmuxEntrypoints)("resolves the synthetic local Host in %s", (path) => {
    const source = readFileSync(resolve(path), "utf8");

    expect(source).toContain("requireWorkspaceHost");
    expect(source).toContain("await requireWorkspaceHost");
  });
});
