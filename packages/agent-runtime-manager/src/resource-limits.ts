export const DEFAULT_AGENT_MEMORY_BYTES = 2 * 1024 * 1024 * 1024;
export const DEFAULT_AGENT_NANO_CPUS = 2_000_000_000;
export const DEFAULT_AGENT_PIDS_LIMIT = 256;

const MIN_MEMORY_BYTES = 128 * 1024 * 1024;
const MAX_MEMORY_BYTES = 16 * 1024 * 1024 * 1024;
const MIN_NANO_CPUS = 250_000_000;
const MAX_NANO_CPUS = 8_000_000_000;
const MIN_PIDS = 32;
const MAX_PIDS = 4_096;

export function parseAgentMemoryBytes(value: string | undefined): number {
  if (value === undefined || value.trim() === "") return DEFAULT_AGENT_MEMORY_BYTES;
  const match = /^(\d+(?:\.\d+)?)\s*(b|k|kb|ki|m|mb|mi|g|gb|gi)?$/i.exec(value.trim());
  if (match === null) throw new Error("RUNTIME_AGENT_MEMORY must look like 512m or 2g");
  const amount = Number(match[1]);
  const unit = (match[2] ?? "b").toLowerCase();
  const multiplier =
    unit === "g" || unit === "gb" || unit === "gi"
      ? 1024 * 1024 * 1024
      : unit === "m" || unit === "mb" || unit === "mi"
        ? 1024 * 1024
        : unit === "k" || unit === "kb" || unit === "ki"
          ? 1024
          : 1;
  const bytes = Math.round(amount * multiplier);
  if (bytes < MIN_MEMORY_BYTES || bytes > MAX_MEMORY_BYTES) {
    throw new Error("RUNTIME_AGENT_MEMORY must be between 128m and 16g");
  }
  return bytes;
}

export function parseAgentNanoCpus(value: string | undefined): number {
  if (value === undefined || value.trim() === "") return DEFAULT_AGENT_NANO_CPUS;
  const cores = Number(value.trim());
  if (!Number.isFinite(cores)) throw new Error("RUNTIME_AGENT_CPUS must be a number");
  const nanoCpus = Math.round(cores * 1_000_000_000);
  if (nanoCpus < MIN_NANO_CPUS || nanoCpus > MAX_NANO_CPUS) {
    throw new Error("RUNTIME_AGENT_CPUS must be between 0.25 and 8");
  }
  return nanoCpus;
}

export function parseAgentPidsLimit(value: string | undefined): number {
  if (value === undefined || value.trim() === "") return DEFAULT_AGENT_PIDS_LIMIT;
  const pids = Number(value.trim());
  if (!Number.isInteger(pids) || pids < MIN_PIDS || pids > MAX_PIDS) {
    throw new Error("RUNTIME_AGENT_PIDS must be an integer between 32 and 4096");
  }
  return pids;
}
