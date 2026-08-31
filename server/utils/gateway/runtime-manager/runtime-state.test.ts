import { describe, expect, it } from "vitest";
import { RuntimeTransitionError, reduceRuntimeEvents, transitionRuntime } from "./runtime-state";

describe("runtime state transitions", () => {
  it("allows a provisioned runtime to become ready through schema and capability checks", () => {
    expect(
      reduceRuntimeEvents("absent", ["provision", "start", "schemaOk", "capabilitiesOk"]),
    ).toBe("ready");
  });

  it("rejects ready when the schema is incompatible", () => {
    expect(transitionRuntime("schema_checking", "schemaMismatch")).toBe("incompatible");
  });

  it("rejects events that are invalid for the current runtime status", () => {
    expect(() => transitionRuntime("ready", "schemaOk")).toThrow(
      new RuntimeTransitionError("ready", "schemaOk"),
    );
  });
});
