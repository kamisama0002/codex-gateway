import Redis from "ioredis";
import type { NitroApp } from "nitropack";
import {
  createDataOpsIntegrationInvalidation,
  createDataOpsIntegrationPublisher,
} from "../utils/gateway/integrations/dataops-invalidation";
import { configureDataOpsPairingPublisher } from "../utils/gateway/integrations/dataops-pairing-service";
import { dataOpsIntegrationProvider } from "../utils/gateway/integrations/dataops-integration-provider";

export default defineNitroPlugin((nitroApp: NitroApp) => {
  const redisUrl = process.env.REDIS_URL;
  if (redisUrl === undefined || redisUrl === "") return;
  const lifecycle = createDataOpsIntegrationRefreshLifecycle({
    provider: dataOpsIntegrationProvider,
    subscriber: new Redis(redisUrl),
    publisher: new Redis(redisUrl),
    configurePublisher: configureDataOpsPairingPublisher,
  });
  void lifecycle.start();
  nitroApp.hooks.hook("close", async () => {
    await lifecycle.stop();
  });
});

export function createDataOpsIntegrationRefreshLifecycle(options: {
  provider: { invalidate(revision?: number): void };
  subscriber: {
    on(event: "message", listener: (channel: string, payload: string) => void): unknown;
    subscribe(channel: string): Promise<unknown>;
    quit(): Promise<unknown>;
  };
  publisher: {
    publish(channel: string, payload: string): Promise<unknown>;
    quit(): Promise<unknown>;
  };
  configurePublisher: (
    publisher: (payload: { revision: number; pairingId: string }) => Promise<void>,
  ) => void;
}) {
  const invalidation = createDataOpsIntegrationInvalidation({
    provider: options.provider,
    subscriber: options.subscriber,
  });
  options.configurePublisher(createDataOpsIntegrationPublisher(options.publisher));
  let startPromise: Promise<void> | null = null;
  let stopPromise: Promise<void> | null = null;
  return {
    start() {
      startPromise ??= invalidation.start();
      return startPromise;
    },
    stop() {
      stopPromise ??= Promise.allSettled([invalidation.stop(), options.publisher.quit()]).then(
        (results) => {
          if (results.some((result) => result.status === "rejected")) {
            console.warn("[gateway] DataOps integration Redis shutdown unavailable");
          }
        },
      );
      return stopPromise;
    },
  };
}
