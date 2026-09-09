export const DEFAULT_RUNTIME_IDLE_TIMEOUT_MINUTES = 30;

export function runtimeIdleTimeoutMinutes(environment: NodeJS.ProcessEnv = process.env) {
  const raw = environment.RUNTIME_IDLE_TIMEOUT_MINUTES;
  if (raw === undefined || raw.trim() === "") {
    return DEFAULT_RUNTIME_IDLE_TIMEOUT_MINUTES;
  }
  const minutes = Number(raw);
  if (!Number.isSafeInteger(minutes) || minutes < 0) {
    throw new Error("RUNTIME_IDLE_TIMEOUT_MINUTES must be a non-negative integer");
  }
  return minutes;
}

export function runtimeIdleTimeoutMs(environment: NodeJS.ProcessEnv = process.env) {
  return runtimeIdleTimeoutMinutes(environment) * 60_000;
}
