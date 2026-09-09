import { readFile } from "node:fs/promises";

const statusPath = process.env.CODEX_BROWSER_STATUS_FILE ?? "/codex-home/browser-status.json";
try {
  const value = JSON.parse(await readFile(statusPath, "utf8"));
  if (!isStatus(value)) throw new Error("invalid browser status");
  process.stdout.write(JSON.stringify({ browser: value.browser }));
} catch {
  process.stdout.write(JSON.stringify({ browser: "not_started" }));
}

function isStatus(value) {
  return (
    value !== null &&
    typeof value === "object" &&
    "browser" in value &&
    ["not_started", "starting", "ready", "failed"].includes(value.browser)
  );
}
