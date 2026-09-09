import { spawn } from "node:child_process";
import { mkdir, rename, writeFile } from "node:fs/promises";
import { request } from "node:http";
import { join } from "node:path";

const codexHome = process.env.CODEX_HOME ?? "/codex-home";
const profileDir = join(codexHome, "browser-profile");
const statusPath = process.env.CODEX_BROWSER_STATUS_FILE ?? join(codexHome, "browser-status.json");
const display = process.env.DISPLAY ?? ":99";
const children = new Map();
let shuttingDown = false;
let browserRestartTimer = null;

await mkdir(profileDir, { recursive: true, mode: 0o700 });
await setStatus("starting");

const environment = {
  ...process.env,
  DISPLAY: display,
  HOME: codexHome,
  XDG_CONFIG_HOME: join(codexHome, ".config"),
  XDG_CACHE_HOME: join(codexHome, ".cache"),
};

start("xvfb", "Xvfb", [display, "-screen", "0", "1440x900x24", "-nolisten", "tcp", "-ac"]);
await wait(150);
start("openbox", "openbox", ["--sm-disable"]);
start("x11vnc", "x11vnc", [
  "-display",
  display,
  "-localhost",
  "-forever",
  "-shared",
  "-rfbport",
  "5900",
  "-nopw",
  "-quiet",
]);
start("websockify", "websockify", ["--web=/usr/share/novnc", "127.0.0.1:6081", "127.0.0.1:5900"]);
start("proxy", "node", ["/usr/local/lib/agent-runtime-browser-proxy.mjs"]);
startChromium();
start("codex", "node", [
  process.env.CODEX_RUNTIME_CONFIG_HELPER ?? "/usr/local/lib/agent-runtime-config.mjs",
]);

const ready = await waitForBrowserReady(60_000);
await setStatus(ready ? "ready" : "failed");

function start(name, command, args) {
  const child = spawn(command, args, { env: environment, stdio: "inherit" });
  children.set(name, child);
  child.once("exit", () => {
    children.delete(name);
    if (shuttingDown || name === "codex") return;
    if (name === "chromium") {
      void setStatus("failed");
      scheduleChromiumRestart();
    }
  });
  child.once("error", () => {
    children.delete(name);
    if (!shuttingDown && name !== "codex") void setStatus("failed");
  });
  return child;
}

function startChromium() {
  start("chromium", process.env.CHROMIUM_PATH ?? "/usr/bin/chromium", [
    "--no-sandbox",
    "--disable-dev-shm-usage",
    "--disable-gpu",
    "--no-first-run",
    "--no-default-browser-check",
    "--disable-session-crashed-bubble",
    "--remote-debugging-address=127.0.0.1",
    "--remote-debugging-port=9222",
    `--user-data-dir=${profileDir}`,
    "--window-size=1440,900",
    "about:blank",
  ]);
}

function scheduleChromiumRestart() {
  if (browserRestartTimer !== null) return;
  browserRestartTimer = setTimeout(() => {
    browserRestartTimer = null;
    if (!shuttingDown && !children.has("chromium")) {
      void setStatus("starting");
      startChromium();
      void waitForBrowserReady(30_000).then((ok) => setStatus(ok ? "ready" : "failed"));
    }
  }, 2_000);
}

async function waitForBrowserReady(timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (!shuttingDown && Date.now() < deadline) {
    if ((await isHttpReady(9222, "/json/version")) && (await isHttpReady(6081, "/vnc.html")))
      return true;
    await wait(250);
  }
  return false;
}

function isHttpReady(port, path) {
  return new Promise((resolve) => {
    const req = request(
      { host: "127.0.0.1", port, path, method: "GET", timeout: 500 },
      (response) => {
        response.resume();
        resolve((response.statusCode ?? 500) < 500);
      },
    );
    req.once("error", () => resolve(false));
    req.once("timeout", () => {
      req.destroy();
      resolve(false);
    });
    req.end();
  });
}

async function setStatus(browser) {
  const temporary = `${statusPath}.tmp`;
  await writeFile(temporary, JSON.stringify({ browser, updatedAt: new Date().toISOString() }), {
    mode: 0o600,
  });
  await rename(temporary, statusPath);
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  if (browserRestartTimer !== null) clearTimeout(browserRestartTimer);
  void setStatus("not_started");
  for (const child of children.values()) child.kill(signal);
  setTimeout(() => process.exit(0), 5_000).unref();
}

process.once("SIGTERM", () => shutdown("SIGTERM"));
process.once("SIGINT", () => shutdown("SIGINT"));
