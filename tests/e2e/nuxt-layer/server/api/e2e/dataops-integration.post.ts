import { createDataOpsIntegrationRepository } from "../../../../../../server/utils/gateway/integrations/dataops-integration-repository";
import { requireLocalAdminUser } from "../../../../../../server/utils/gateway/auth/context";

export default defineEventHandler(async (event) => {
  requireLocalAdminUser(event);
  const dataOpsBaseUrl = process.env.DATAOPS_BASE_URL ?? "";
  const sharedSecret = process.env.DATAOPS_SSO_SHARED_SECRET ?? "";
  if (dataOpsBaseUrl === "" || sharedSecret.length < 32) {
    throw new Error("E2E DataOps integration settings are invalid");
  }

  const repository = createDataOpsIntegrationRepository();
  if ((await repository.active()) !== null) return { seeded: false };

  const now = new Date();
  await repository.stage({
    pairingId: "dataops-e2e-fixed",
    dataOpsBaseUrl,
    sharedSecret,
    revision: 1,
    now: now.toISOString(),
  });
  await repository.confirm(
    "dataops-e2e-fixed",
    1,
    new Date(now.getTime() + 5 * 60_000).toISOString(),
  );
  await repository.finalize("dataops-e2e-fixed", 1);
  return { seeded: true };
});
