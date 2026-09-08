import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { basename, join } from "node:path";
import { randomUUID } from "node:crypto";

const secretDirectory = process.env.CODEX_RUNTIME_SECRET_DIR ?? "/run/codex-secrets";
const payload = parsePayload(await readStdin());
mkdirSync(secretDirectory, { recursive: true, mode: 0o700 });
chmodSync(secretDirectory, 0o700);
clearTransientFiles();

const environment = {};
for (const [index, secret] of payload.runtimeSecrets.entries()) {
  if (secret.target.type === "env") {
    const fileName = `.env-${index}`;
    environment[secret.target.name] = fileName;
    atomicWrite(fileName, secret.value);
  } else {
    atomicWrite(basename(secret.target.path), secret.value);
  }
}
atomicWrite("manifest.json", JSON.stringify({ environment }));
atomicWrite(".ready", "");

async function readStdin() {
  const chunks = [];
  let size = 0;
  for await (const chunk of process.stdin) {
    const bytes = Buffer.from(chunk);
    size += bytes.byteLength;
    if (size > 10 * 1024 * 1024) throw new Error("Runtime secret payload is too large");
    chunks.push(bytes);
  }
  const input = Buffer.concat(chunks);
  try {
    return JSON.parse(input.toString("utf8"));
  } finally {
    input.fill(0);
    chunks.forEach((chunk) => chunk.fill(0));
  }
}

function parsePayload(value) {
  if (
    !isRecord(value) ||
    !hasOnlyKeys(value, ["runtimeSecrets"]) ||
    !Array.isArray(value.runtimeSecrets)
  ) {
    throw new Error("Runtime secret payload is invalid");
  }
  const targets = new Set();
  const runtimeSecrets = value.runtimeSecrets.map((candidate) => {
    if (
      !isRecord(candidate) ||
      !hasOnlyKeys(candidate, ["credentialId", "capabilityId", "version", "target", "value"]) ||
      !/^cred__[a-z0-9][a-z0-9_.-]*$/u.test(candidate.credentialId) ||
      !/^org__[a-z0-9][a-z0-9_.-]*$/u.test(candidate.capabilityId) ||
      !Number.isInteger(candidate.version) ||
      candidate.version <= 0 ||
      typeof candidate.value !== "string" ||
      candidate.value === "" ||
      !isRecord(candidate.target)
    ) {
      throw new Error("Runtime secret entry is invalid");
    }
    const target = parseTarget(candidate.target);
    const targetId = JSON.stringify(target);
    if (targets.has(targetId)) throw new Error("Runtime secret targets must be unique");
    targets.add(targetId);
    return { ...candidate, target };
  });
  return { runtimeSecrets };
}

function parseTarget(value) {
  if (
    value.type === "env" &&
    hasOnlyKeys(value, ["type", "name"]) &&
    typeof value.name === "string" &&
    /^[A-Z][A-Z0-9_]{0,127}$/u.test(value.name)
  ) {
    return { type: "env", name: value.name };
  }
  if (
    value.type === "file" &&
    hasOnlyKeys(value, ["type", "path"]) &&
    typeof value.path === "string" &&
    /^\/run\/codex-secrets\/[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$/u.test(value.path)
  ) {
    return { type: "file", path: value.path };
  }
  throw new Error("Runtime secret target is invalid");
}

function atomicWrite(fileName, value) {
  if (!/^(?:\.?[A-Za-z0-9][A-Za-z0-9_.-]{0,127})$/u.test(fileName)) {
    throw new Error("Runtime secret file name is invalid");
  }
  const temporaryPath = join(secretDirectory, `.write-${randomUUID()}`);
  const targetPath = join(secretDirectory, fileName);
  const content = Buffer.from(value, "utf8");
  try {
    writeFileSync(temporaryPath, content, { flag: "wx", mode: 0o600 });
    renameSync(temporaryPath, targetPath);
    chmodSync(targetPath, 0o600);
  } finally {
    content.fill(0);
    rmSync(temporaryPath, { force: true });
  }
}

function clearTransientFiles() {
  if (!existsSync(secretDirectory)) return;
  for (const fileName of readdirSync(secretDirectory)) {
    if (/^(?:\.env-[0-9]+|\.ready|manifest\.json|\.write-)/u.test(fileName)) {
      rmSync(join(secretDirectory, fileName), { force: true });
    }
  }
}

function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasOnlyKeys(value, allowed) {
  return Object.keys(value).every((key) => allowed.includes(key));
}
