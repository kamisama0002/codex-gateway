import { runtimeNodeHealthSchema, type RuntimeNodeHealth } from "./client";
import { runtimeNodeClientRegistry } from "./runtime-node-client-registry";
import { createRuntimeNodeStore } from "./runtime-node-store";
import type { RuntimeNodeRecord } from "./runtime-node-types";
import { gatewayDatabase } from "../storage/database";

interface RuntimeNodeHealthStorePort {
  list(): Promise<RuntimeNodeRecord[]>;
  updateHealth(
    nodeId: string,
    health: Pick<RuntimeNodeRecord, "lastSeenAt" | "lastError" | "healthJson">,
  ): Promise<unknown>;
}

interface RuntimeNodeHealthClientPort {
  status(): Promise<RuntimeNodeHealth>;
}

interface RuntimeNodeHealthMonitorOptions {
  nodeStore: RuntimeNodeHealthStorePort;
  clients: { get(nodeId: string): Promise<RuntimeNodeHealthClientPort> };
  intervalMs?: number;
  now?: () => string;
}

const safeProbeErrors = new Set([
  "runtime_manager_invalid_response",
  "runtime_manager_timeout",
  "runtime_manager_unavailable",
  "runtime_node_disabled",
  "runtime_node_invalid_configuration",
  "runtime_node_not_found",
  "runtime_node_registry_unavailable",
]);

export class RuntimeNodeHealthMonitor {
  private readonly intervalMs: number;
  private readonly now: () => string;
  private timer: ReturnType<typeof setInterval> | null = null;
  private activeProbe: Promise<void> | null = null;

  constructor(private readonly options: RuntimeNodeHealthMonitorOptions) {
    this.intervalMs = options.intervalMs ?? 10_000;
    if (!Number.isInteger(this.intervalMs) || this.intervalMs <= 0) {
      throw new Error("Runtime node health interval must be positive");
    }
    this.now = options.now ?? (() => new Date().toISOString());
  }

  start() {
    if (this.timer !== null) return;
    void this.probeNow().catch(logProbeLoopFailure);
    this.timer = setInterval(() => {
      void this.probeNow().catch(logProbeLoopFailure);
    }, this.intervalMs);
    this.timer.unref?.();
  }

  stop() {
    if (this.timer === null) return;
    clearInterval(this.timer);
    this.timer = null;
  }

  probeNow(): Promise<void> {
    if (this.activeProbe !== null) return this.activeProbe;
    const probe = this.probeAll().finally(() => {
      if (this.activeProbe === probe) this.activeProbe = null;
    });
    this.activeProbe = probe;
    return probe;
  }

  private async probeAll() {
    const nodes = await this.options.nodeStore.list();
    await Promise.all(
      nodes
        .filter((node) => node.schedulingState !== "disabled")
        .map(async (node) => await this.probeNode(node)),
    );
  }

  private async probeNode(node: RuntimeNodeRecord) {
    try {
      const client = await this.options.clients.get(node.id);
      const health = runtimeNodeHealthSchema.parse(await client.status());
      await this.options.nodeStore.updateHealth(node.id, {
        lastSeenAt: new Date(this.now()).toISOString(),
        lastError: null,
        healthJson: JSON.stringify(health),
      });
    } catch (error) {
      await this.options.nodeStore.updateHealth(node.id, {
        lastSeenAt: node.lastSeenAt,
        lastError: safeProbeError(error),
        healthJson: null,
      });
    }
  }
}

export const runtimeNodeHealthMonitor = new RuntimeNodeHealthMonitor({
  nodeStore: {
    list: async () => await createRuntimeNodeStore(gatewayDatabase()).list(),
    updateHealth: async (nodeId, health) =>
      await createRuntimeNodeStore(gatewayDatabase()).updateHealth(nodeId, health),
  },
  clients: runtimeNodeClientRegistry,
});

function safeProbeError(error: unknown) {
  if (typeof error === "object" && error !== null && "code" in error) {
    const code = typeof error.code === "string" ? error.code : "";
    if (safeProbeErrors.has(code)) return code;
  }
  return "runtime_node_probe_failed";
}

function logProbeLoopFailure(error: unknown) {
  console.error("[gateway-runtime] runtime node health loop failed", {
    code: safeProbeError(error),
  });
}
