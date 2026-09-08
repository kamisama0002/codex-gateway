import Redis from "ioredis";
import { createDataOpsIntegrationInvalidation } from "../utils/gateway/integrations/dataops-invalidation";
import { dataOpsIntegrationProvider } from "../utils/gateway/integrations/dataops-integration-provider";

export default defineNitroPlugin((nitroApp) => {
  const redisUrl = process.env.REDIS_URL;
  if (!redisUrl) return;
  const invalidation = createDataOpsIntegrationInvalidation({
    provider: dataOpsIntegrationProvider,
    subscriber: new Redis(redisUrl),
  });
  void invalidation.start();
  nitroApp.hooks.hook("close", async () => {
    await invalidation.stop();
  });
});
