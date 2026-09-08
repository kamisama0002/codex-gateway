import Redis from "ioredis";
import type { NitroApp } from "nitropack";
import {
  createDataOpsIntegrationInvalidation,
  createDataOpsIntegrationPublisher,
} from "../utils/gateway/integrations/dataops-invalidation";
import { configureDataOpsPairingPublisher } from "../utils/gateway/integrations/dataops-pairing-service";
import { dataOpsIntegrationProvider } from "../utils/gateway/integrations/dataops-integration-provider";

// oxlint-disable-next-line typescript/no-unsafe-call
export default defineNitroPlugin((nitroApp: NitroApp) => {
  const redisUrl = process.env.REDIS_URL;
  if (redisUrl === undefined || redisUrl === "") return;
  const subscriber = new Redis(redisUrl);
  const invalidation = createDataOpsIntegrationInvalidation({
    provider: dataOpsIntegrationProvider,
    subscriber,
  });
  const publisher = createDataOpsIntegrationPublisher(new Redis(redisUrl));
  configureDataOpsPairingPublisher(publisher);
  void invalidation.start();
  nitroApp.hooks.hook("close", async () => {
    await invalidation.stop();
  });
});
