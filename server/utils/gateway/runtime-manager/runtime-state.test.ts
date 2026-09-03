import { describe, expect, it } from "vitest";
import {
  RuntimeTransitionError,
  reduceRuntimeEvents,
  runtimeEvents,
  runtimeStatuses,
  runtimeTransitionMatrix,
  transitionRuntime,
} from "./runtime-state";

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

  it("represents every declared status and event pair", () => {
    const pairs = new Set<string>();

    for (const status of runtimeStatuses) {
      for (const event of runtimeEvents) {
        pairs.add(`${status}:${event}`);
        const expected = runtimeTransitionMatrix[status][event];

        if (expected === null) {
          expect(() => transitionRuntime(status, event)).toThrow(
            new RuntimeTransitionError(status, event),
          );
        } else {
          expect(transitionRuntime(status, event)).toBe(expected);
        }
      }
    }

    expect(pairs.size).toBe(runtimeStatuses.length * runtimeEvents.length);
  });
});
