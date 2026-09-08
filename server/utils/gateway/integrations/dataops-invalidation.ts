export const DATAOPS_INTEGRATION_REDIS_CHANNEL = "codex-gateway:dataops-integration:changed";

interface RedisSubscriber {
  on(event: "message", listener: (channel: string, payload: string) => void): unknown;
  subscribe(channel: string): Promise<unknown>;
  quit(): Promise<unknown>;
}

export function createDataOpsIntegrationInvalidation(options: {
  provider: { invalidate(revision?: number): void };
  subscriber: RedisSubscriber;
}) {
  return {
    async start(): Promise<void> {
      options.subscriber.on("message", (channel, payload) => {
        if (channel !== DATAOPS_INTEGRATION_REDIS_CHANNEL) return;
        try {
          const parsed = JSON.parse(payload) as { revision?: unknown; pairingId?: unknown };
          if (typeof parsed.revision === "number" && Number.isSafeInteger(parsed.revision) && parsed.revision > 0 && typeof parsed.pairingId === "string") {
            options.provider.invalidate(parsed.revision);
          }
        } catch {
          // Invalid cross-node notifications are ignored; MySQL TTL refresh remains authoritative.
        }
      });
      try {
        await options.subscriber.subscribe(DATAOPS_INTEGRATION_REDIS_CHANNEL);
      } catch {
        console.warn("[gateway] DataOps integration Redis refresh unavailable");
      }
    },
    async stop(): Promise<void> {
      await options.subscriber.quit().catch(() => undefined);
    },
  };
}
