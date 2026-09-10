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

/** In-memory Dinky URL registry: keyed by DataOps service token. Populated by connect calls. */
const dinkyRegistry = new Map<string, { baseUrl: string; sharedSecret: string }>();
export function registerDinkyUrl(token: string, baseUrl: string, sharedSecret: string): void {
  dinkyRegistry.set(token, { baseUrl, sharedSecret });
}

/** Fallback SSO client — tries in-memory registry first, then env vars. */
function fallbackClientFromRegistry(createClient: typeof createDataOpsSsoClient, serviceToken: string): DataOpsSsoClient | null {
  const entry = dinkyRegistry.get(serviceToken);
  if (entry) return createClient({ baseUrl: entry.baseUrl, sharedSecret: entry.sharedSecret });
  const baseUrl = process.env.DATAOPS_BASE_URL?.trim();
  const sharedSecret = process.env.DATAOPS_SSO_SHARED_SECRET?.trim();
  if (!baseUrl || !sharedSecret) return null;
  return createClient({ baseUrl, sharedSecret });
}

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
      let snapshot: DataOpsIntegrationSnapshot | null;
      if (bindings.length > 0) {
        snapshot = {
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
      } else {
        const serviceToken = (await import("./dataops-service-token")).dataOpsServiceToken();
        const fallback = fallbackClientFromRegistry(createClient, serviceToken);
        snapshot = fallback
          ? { pairingId: "__env_fallback__", revision: 0, client: fallback }
          : null;
      }
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
