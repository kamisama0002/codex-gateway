import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";

const manifestPath =
  process.env.AGENT_RUNTIME_TOOL_MANIFEST ??
  "/usr/local/share/codex-agent-runtime/tool-manifest.json";
/** @type {unknown} */
const rawManifest = JSON.parse(readFileSync(manifestPath, "utf8"));
if (!isToolManifest(rawManifest)) throw new Error("Invalid Agent runtime tool manifest");
const manifest = rawManifest;
/** @type {string[]} */
const failures = [];
const smokeEnvironment = {
  ...process.env,
  HOME: process.env.HOME ?? "/codex-home",
  LANG: "C.UTF-8",
};

for (const { acceptedExitCodes = [0], command, versionArgs } of manifest.commands) {
  const result = spawnSync(command, versionArgs, {
    encoding: "utf8",
    env: smokeEnvironment,
    timeout: 30_000,
  });
  if (
    result.error !== undefined ||
    result.status === null ||
    !acceptedExitCodes.includes(result.status)
  ) {
    failures.push(`${command}: ${commandFailure(result)}`);
  }
}

const imports = spawnSync("python3", ["-c", `import ${manifest.pythonImports.join(", ")}`], {
  encoding: "utf8",
  env: smokeEnvironment,
  timeout: 120_000,
});
if (imports.error !== undefined || imports.status !== 0) {
  failures.push(`python imports: ${commandFailure(imports)}`);
}

const browserSmoke = spawnSync(
  "node",
  [
    "-e",
    [
      'const { chromium } = require("@playwright/test");',
      "(async () => {",
      "  const browser = await chromium.launch({",
      '    executablePath: process.env.CHROMIUM_PATH || "/usr/bin/chromium",',
      '    headless: true, args: ["--no-sandbox"]',
      "  });",
      "  try {",
      "    const page = await browser.newPage();",
      '    await page.setContent("<main><h1>Agent browser ready</h1></main>");',
      '    if (await page.locator("main").innerText() !== "Agent browser ready") process.exitCode = 2;',
      "  } finally { await browser.close(); }",
      "})().catch((error) => { console.error(error); process.exit(1); });",
    ].join("\n"),
  ],
  { encoding: "utf8", env: smokeEnvironment, timeout: 60_000 },
);
if (browserSmoke.error !== undefined || browserSmoke.status !== 0) {
  failures.push(`chromium: ${commandFailure(browserSmoke)}`);
}

if (failures.length > 0) {
  console.error(failures.join("\n"));
  process.exit(1);
}

console.log(
  JSON.stringify({
    browser: "chromium",
    commands: manifest.commands.length,
    pythonImports: manifest.pythonImports.length,
    status: "ok",
  }),
);

/**
 * @param {import("node:child_process").SpawnSyncReturns<string>} result
 */
function commandFailure(result) {
  if (result.error !== undefined) return result.error.message;
  const stderr = result.stderr.trim();
  return stderr === "" ? `exit ${result.status ?? "unknown"}` : stderr;
}

/**
 * @typedef {{ acceptedExitCodes?: number[], command: string, versionArgs: string[] }} ToolCommand
 * @typedef {{ commands: ToolCommand[], pythonImports: string[] }} ToolManifest
 */

/** @param {unknown} value @returns {value is ToolManifest} */
function isToolManifest(value) {
  if (!isRecord(value)) return false;
  const { commands, pythonImports } = value;
  return (
    Array.isArray(commands) &&
    commands.every(isToolCommand) &&
    Array.isArray(pythonImports) &&
    pythonImports.every((name) => typeof name === "string" && name.length > 0)
  );
}

/** @param {unknown} value @returns {value is ToolCommand} */
function isToolCommand(value) {
  if (!isRecord(value)) return false;
  const { acceptedExitCodes, command, versionArgs } = value;
  return (
    typeof command === "string" &&
    command.length > 0 &&
    Array.isArray(versionArgs) &&
    versionArgs.every((argument) => typeof argument === "string") &&
    (acceptedExitCodes === undefined ||
      (Array.isArray(acceptedExitCodes) &&
        acceptedExitCodes.every((exitCode) => Number.isInteger(exitCode))))
  );
}

/** @param {unknown} value @returns {value is Record<string, unknown>} */
function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
