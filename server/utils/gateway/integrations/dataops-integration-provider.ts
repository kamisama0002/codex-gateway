import {
  createDataOpsSsoClient,
  DataOpsSsoError,
  type DataOpsSsoClient,
} from "../auth/dataops-client";
import { createDataOpsIntegrationRepository } from "./dataops-integration-repository";
import type { DataOpsClaims } from "../auth/dataops-claims";

const CACHE_TTL_MS = 5_000;
type IntegrationRepository = Pick<
  ReturnType<typeof createDataOpsIntegrationRepository>,
  "acceptedForAuthentication"
>;

export interface DataOpsIntegrationSnapshot {
  pairingId: string;
  revision: number;
  client: DataOpsSsoClient;
}

export function createDataOpsIntegrationProvider(
  options: {
    integrations?: IntegrationRepository;
    now?: () => Date;
    createClient?: typeof createDataOpsSsoClient;
  } = {},
) {
  const integrations = options.integrations ?? createDataOpsIntegrationRepository();
  const now = options.now ?? (() => new Date());
  const createClient = options.createClient ?? createDataOpsSsoClient;
  let cached: { snapshot: DataOpsIntegrationSnapshot | null; expiresAt: number } | null = null;

  return {
    async current(): Promise<DataOpsIntegrationSnapshot | null> {
      const currentNow = now();
      if (cached !== null && currentNow.getTime() < cached.expiresAt) return cached.snapshot;
      const bindings = await integrations.acceptedForAuthentication(currentNow.toISOString());
      const snapshot =
        bindings.length === 0
          ? null
          : {
              pairingId: bindings[0]!.pairingId,
              revision: bindings[0]!.revision,
              client: fallbackClient(
                bindings.map((binding) =>
                  createClient({
                    baseUrl: binding.dataOpsBaseUrl,
                    sharedSecret: binding.sharedSecret,
                    pairingId: binding.pairingId,
                    revision: binding.revision,
                  }),
                ),
              ),
            };
      const graceExpiry = bindings
        .filter((binding) => binding.status === "grace" && binding.graceExpiresAt !== null)
        .map((binding) => Date.parse(binding.graceExpiresAt ?? ""))
        .filter(Number.isFinite)
        .reduce(
          (earliest, value) => Math.min(earliest, value),
          currentNow.getTime() + CACHE_TTL_MS,
        );
      cached = { snapshot, expiresAt: Math.min(currentNow.getTime() + CACHE_TTL_MS, graceExpiry) };
      return snapshot;
    },
    invalidate(revision?: number): void {
      if (
        cached === null ||
        revision === undefined ||
        cached.snapshot === null ||
        revision >= cached.snapshot.revision
      ) {
        cached = null;
      }
    },
  };
}

function fallbackClient(clients: DataOpsSsoClient[]): DataOpsSsoClient {
  return {
    async exchange(ticket: string): Promise<DataOpsClaims> {
      let rejected: DataOpsSsoError | null = null;
      for (const client of clients) {
        try {
          return await client.exchange(ticket);
        } catch (error) {
          if (error instanceof DataOpsSsoError && error.code === "dataops_ticket_rejected") {
            rejected = error;
            continue;
          }
          throw error;
        }
      }
      throw rejected ?? new DataOpsSsoError("dataops_not_configured");
    },
    async bootstrapMcpCredential(claims: DataOpsClaims) {
      const active = clients[0];
      if (active === undefined) throw new DataOpsSsoError("dataops_not_configured");
      return await active.bootstrapMcpCredential(claims);
    },
  };
}

let defaultProvider: ReturnType<typeof createDataOpsIntegrationProvider> | null = null;

export const dataOpsIntegrationProvider = {
  current() {
    defaultProvider ??= createDataOpsIntegrationProvider();
    return defaultProvider.current();
  },
  invalidate(revision?: number) {
    defaultProvider?.invalidate(revision);
  },
};
