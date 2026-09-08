import type { AgentContainerStats } from "./contracts.js";

export function parseDockerContainerStats(
  value: unknown,
  sampledAtMs = Date.now(),
): Omit<AgentContainerStats, "cpuQuotaCpus"> {
  const stats = asRecord(value);
  const cpu = asRecord(stats.cpu_stats);
  const preCpu = asRecord(stats.precpu_stats);
  const memory = asRecord(stats.memory_stats);
  const memoryCounters = asRecord(memory.stats);
  const usage = Math.max(0, numberFromUnknown(memory.usage));
  const inactiveFile = Math.max(
    0,
    numberFromUnknown(memoryCounters.inactive_file ?? memoryCounters.total_inactive_file),
  );
  const memoryUsageBytes = Math.max(0, usage - Math.min(usage, inactiveFile));
  const memoryLimitBytes = Math.max(1, numberFromUnknown(memory.limit) || memoryUsageBytes);
  const readAt = stringFromUnknown(stats.read);
  const parsedRead = readAt === null ? Number.NaN : Date.parse(readAt);
  return {
    sampledAtMs: Number.isFinite(parsedRead) ? parsedRead : sampledAtMs,
    cpuUsage: numberFromUnknown(asRecord(cpu.cpu_usage).total_usage),
    systemCpuUsage: numberFromUnknown(cpu.system_cpu_usage),
    preCpuUsage: numberFromUnknown(asRecord(preCpu.cpu_usage).total_usage),
    preSystemCpuUsage: numberFromUnknown(preCpu.system_cpu_usage),
    onlineCpus: Math.max(1, Math.trunc(numberFromUnknown(cpu.online_cpus) || 1)),
    memoryUsageBytes,
    memoryLimitBytes,
    rxBytes: networkBytes(stats.networks, "rx_bytes"),
    txBytes: networkBytes(stats.networks, "tx_bytes"),
    diskReadBytes: blkioBytes(stats, "read"),
    diskWriteBytes: blkioBytes(stats, "write"),
    interfaces: networkInterfaces(stats.networks),
  };
}

function networkBytes(value: unknown, key: "rx_bytes" | "tx_bytes") {
  let total = 0;
  for (const iface of Object.values(asRecord(value))) {
    total += numberFromUnknown(asRecord(iface)[key]);
  }
  return total;
}

function networkInterfaces(value: unknown) {
  const names = Object.keys(asRecord(value));
  return names.length > 0 ? names : ["eth0"];
}

function blkioBytes(stats: Record<string, unknown>, op: "read" | "write") {
  const blkio = asRecord(stats.blkio_stats);
  const entries = Array.isArray(blkio.io_service_bytes_recursive)
    ? blkio.io_service_bytes_recursive
    : [];
  let total = 0;
  for (const entry of entries) {
    const row = asRecord(entry);
    if (stringFromUnknown(row.op)?.toLowerCase() === op) total += numberFromUnknown(row.value);
  }
  return total;
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function numberFromUnknown(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function stringFromUnknown(value: unknown) {
  return typeof value === "string" && value.length > 0 ? value : null;
}
