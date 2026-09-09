export const DEFAULT_RUNTIME_IDLE_TIMEOUT_MINUTES = 30;

export function runtimeIdleTimeoutMs(environment: NodeJS.ProcessEnv = process.env) {
  const raw = environment.RUNTIME_IDLE_TIMEOUT_MINUTES;
  if (raw === undefined || raw.trim() === "") {
    return DEFAULT_RUNTIME_IDLE_TIMEOUT_MINUTES * 60_000;
  }
  const minutes = Number(raw);
  if (!Number.isSafeInteger(minutes) || minutes < 0) {
    throw new Error("RUNTIME_IDLE_TIMEOUT_MINUTES must be a non-negative integer");
  }
  return minutes * 60_000;
}
