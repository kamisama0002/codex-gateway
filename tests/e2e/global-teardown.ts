import { stopDockerEnvironment } from "./docker-environment";

export default async function globalTeardown() {
  const managedLabelValue = process.env.E2E_MANAGED_LABEL_VALUE;
  if (
    process.env.E2E_MANAGED_RUNTIME_ENABLED === "1" &&
    (managedLabelValue === undefined || managedLabelValue === "")
  ) {
    throw new Error("Managed Runtime E2E cleanup requires an exact managed label value");
  }
  // Compose resources, including the isolated MySQL volume, deliberately remain until the host
  // runner has inspected them. The runner then removes only its exact project and labels.
  await stopDockerEnvironment();
}
