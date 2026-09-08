import Redis from "ioredis";
import { createDataOpsIntegrationInvalidation, createDataOpsIntegrationPublisher } from "../utils/gateway/integrations/dataops-invalidation";
import { configureDataOpsPairingPublisher } from "../utils/gateway/integrations/dataops-pairing-service";
import { dataOpsIntegrationProvider } from "../utils/gateway/integrations/dataops-integration-provider";

export default defineNitroPlugin((nitroApp) => {
  const redisUrl = process.env.REDIS_URL;
  if (!redisUrl) return;
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
