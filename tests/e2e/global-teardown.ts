import { stopDockerEnvironment } from "./docker-environment";

export default async function globalTeardown() {
  const managedLabelValue = process.env.E2E_MANAGED_LABEL_VALUE;
  if (
    process.env.E2E_MANAGED_RUNTIME_ENABLED === "1" &&
    (managedLabelValue === undefined || managedLabelValue === "")
  ) {
    throw new Error("Managed Runtime E2E cleanup requires an exact managed label value");
  }
  // Docker resources deliberately remain until the host runner has inspected their effective
  // security policy, then the runner removes only the exact E2E-labeled containers/volumes.
  await stopDockerEnvironment();
}
