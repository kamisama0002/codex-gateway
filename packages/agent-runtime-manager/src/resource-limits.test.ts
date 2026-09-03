import { describe, expect, it } from "vitest";

import {
  DEFAULT_AGENT_MEMORY_BYTES,
  DEFAULT_AGENT_NANO_CPUS,
  DEFAULT_AGENT_PIDS_LIMIT,
  parseAgentMemoryBytes,
  parseAgentNanoCpus,
  parseAgentPidsLimit,
} from "./resource-limits.js";

describe("agent resource limit parsing", () => {
  it("defaults to 2g / 2 CPUs / 256 pids", () => {
    expect(parseAgentMemoryBytes(undefined)).toBe(DEFAULT_AGENT_MEMORY_BYTES);
    expect(parseAgentNanoCpus("")).toBe(DEFAULT_AGENT_NANO_CPUS);
    expect(parseAgentPidsLimit(undefined)).toBe(DEFAULT_AGENT_PIDS_LIMIT);
  });

  it("parses compose-style memory and CPU values", () => {
    expect(parseAgentMemoryBytes("512m")).toBe(512 * 1024 * 1024);
    expect(parseAgentMemoryBytes("4g")).toBe(4 * 1024 * 1024 * 1024);
    expect(parseAgentNanoCpus("1")).toBe(1_000_000_000);
    expect(parseAgentNanoCpus("0.5")).toBe(500_000_000);
    expect(parseAgentPidsLimit("512")).toBe(512);
  });

  it("rejects out-of-range values", () => {
    expect(() => parseAgentMemoryBytes("64m")).toThrow(/128m and 16g/);
    expect(() => parseAgentNanoCpus("16")).toThrow(/0.25 and 8/);
    expect(() => parseAgentPidsLimit("8")).toThrow(/32 and 4096/);
  });
});
