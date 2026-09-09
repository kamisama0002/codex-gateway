

# Codex Gateway

[![Nuxt](https://img.shields.io/badge/Nuxt-4-00DC82?logo=nuxt&logoColor=white)](nuxt.config.ts)
[![Vue](https://img.shields.io/badge/Vue-3-4FC08D?logo=vuedotjs&logoColor=white)](package.json)
[![TypeScript](https://img.shields.io/badge/TypeScript-6-3178C6?logo=typescript&logoColor=white)](package.json)
[![Tailwind CSS](https://img.shields.io/badge/Tailwind_CSS-4-06B6D4?logo=tailwindcss&logoColor=white)](package.json)
[![Playwright](https://img.shields.io/badge/Playwright-E2E-2EAD33?logo=playwright&logoColor=white)](tests/e2e)
[![Docker](https://img.shields.io/badge/Docker-ready-2496ED?logo=docker&logoColor=white)](docker-compose.yml)
[![License](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

English | [中文](README.zh-CN.md)

Codex Gateway is a web frontend and connection gateway for the official Codex app-server.

It is not a reimplementation of Codex, and it does not run an agent runtime in the browser. The browser talks only to Codex Gateway. Gateway connects to your remote machines over SSH, manages the official `codex app-server` lifecycle, and renders official app-server threads, events, approvals, file changes, images, diffs, terminal output, and sub-agent activity in a web UI.

The goal is simple: open Codex sessions from many servers in a browser while keeping Codex app-server as the source of truth. If Codex Desktop, another client, and Codex Gateway connect to the same app-server thread, they should observe the same state stream.

<p align="center">
  <img src="docs/images/codex-gateway-workspace.png" alt="Codex Gateway showing remote hosts, projects, a Codex agent loop, and workspace tabs" width="100%">
</p>

<p align="center"><sub>A browser workspace for Codex sessions running across remote SSH hosts.</sub></p>

## Why

- Use Codex from any browser without exposing SSH credentials to the browser.
- Manage multiple SSH hosts, projects, and Codex threads from one workspace.
- Keep official Codex app-server semantics instead of inventing a parallel protocol.
- Share one gateway-side SSH/RPC lifecycle per host across browser tabs.
- Recover thread state after browser reloads, app-server restarts, or temporary SSH disconnects.
- Open a direct SSH terminal next to the agent loop when you need to inspect or fix the remote environment manually.
- Preview remote web applications in an isolated Browser panel without publishing their ports.
- Monitor long-running training or inference jobs in tmux across all hosts and get notified when a pane exits or returns to its shell.
- Watch CPU, memory, network, disk, and GPU activity without leaving the conversation workspace.

## Feature Tour

These views are captured from the real Playwright E2E environment. Select any image to open it at full resolution.

### Codex workflows

<table>
  <tr>
    <td width="50%">
      <a href="docs/images/features/en/goal-progress.png"><img src="docs/images/features/en/goal-progress.png" alt="Goal details with objective, elapsed time, token usage, and controls" width="100%"></a><br>
      <strong>Goal lifecycle</strong><br>
      <sub>Track app-server goal progress, edit the objective, pause or resume execution, and clear completed work.</sub>
    </td>
    <td width="50%">
      <a href="docs/images/features/en/plan-mode.png"><img src="docs/images/features/en/plan-mode.png" alt="Plan mode with a structured implementation plan and actions" width="100%"></a><br>
      <strong>Plan mode</strong><br>
      <sub>Review a structured plan, continue planning, or move directly into implementation.</sub>
    </td>
  </tr>
</table>

### Remote workspace

<table>
  <tr>
    <td width="50%">
      <a href="docs/images/features/en/file-workspace.png"><img src="docs/images/features/en/file-workspace.png" alt="Dockable file workspace with a remote tree and rendered Markdown preview" width="100%"></a><br>
      <strong>Files, editing, and previews</strong><br>
      <sub>Browse remote trees, edit text, and preview Markdown, LaTeX, images, PDF, and Office documents beside the agent.</sub>
    </td>
    <td width="50%">
      <a href="docs/images/features/en/browser-preview.png"><img src="docs/images/features/en/browser-preview.png" alt="Remote browser preview with HTTP, WebSocket, and resource diagnostics" width="100%"></a><br>
      <strong>Remote browser preview</strong><br>
      <sub>Open a Host's private web service through SSH with full-origin HTTP/WebSocket forwarding and visible resource errors.</sub>
    </td>
  </tr>
</table>

### Operations and notifications

<table>
  <tr>
    <td width="50%">
      <a href="docs/images/features/en/host-monitoring.png"><img src="docs/images/features/en/host-monitoring.png" alt="Live CPU, memory, network, and disk monitoring charts" width="100%"></a><br>
      <strong>Live host metrics</strong><br>
      <sub>Stream CPU, memory, network, and disk telemetry over the shared Gateway realtime connection.</sub>
    </td>
    <td width="50%">
      <a href="docs/images/features/en/gpu-process-monitoring.png"><img src="docs/images/features/en/gpu-process-monitoring.png" alt="GPU metrics and process ownership table" width="100%"></a><br>
      <strong>GPU process attribution</strong><br>
      <sub>Inspect utilization, temperature, VRAM, users, PIDs, runtimes, and commands for remote training jobs.</sub>
    </td>
  </tr>
  <tr>
    <td width="50%">
      <a href="docs/images/features/en/tmux-monitoring.png"><img src="docs/images/features/en/tmux-monitoring.png" alt="Cross-host tmux monitor with sessions, panes, and active jobs" width="100%"></a><br>
      <strong>Cross-host tmux monitoring</strong><br>
      <sub>Discover panes, inspect recent output, and monitor one run or every future run from one user-wide view.</sub>
    </td>
    <td width="50%">
      <a href="docs/images/features/en/notifications.png"><img src="docs/images/features/en/notifications.png" alt="Actionable conversation completion notification" width="100%"></a><br>
      <strong>Browser and Bark notifications</strong><br>
      <sub>Receive de-duplicated completion alerts and open the matching conversation or tmux pane directly.</sub>
    </td>
  </tr>
</table>

## Architecture

```text
Browser
  └─ HTTP + WebSocket
     └─ Codex Gateway (Nuxt server)
        ├─ MySQL encrypted config
        ├─ SSH connection pool
        ├─ one shared RPC client per host
        ├─ direct SSH PTY terminal sessions
        ├─ HTTP/WebSocket preview proxy over SSH
        ├─ MySQL-backed tmux monitor scheduler
        ├─ per-user Docker Agent runtime orchestration
        ├─ capability, assignment, and encrypted credential reconciliation
        ├─ thread/event cache
        ├─ remote official codex app-server
        └─ isolated local codex app-server containers
```

Core rules:

- Browsers never connect directly to remote app-servers or SSH hosts.
- Gateway owns SSH, remote Codex upgrade, app-server startup, RPC, and event fan-out.
- Turn start, steer, interrupt, terminal input, terminal resize, and server-request responses use the page WebSocket.
- Gateway caches recent thread state, warms pinned threads, and periodically refreshes stale running threads from app-server state.
- The frontend renders domain state from Gateway and does not maintain a second durable timeline.

## Features

- **Server-side accounts and config**: manually created users, Bearer token login, encrypted host/project/thread config in MySQL.
- **Remote hosts**: SSH password, private key, ssh-agent, and optional SSH proxy support.
- **Codex runtime management**: detects remote Codex versions, upgrades old installs, restarts stale app-server processes, and reconnects automatically.
- **Per-user managed Agents**: optionally runs one long-lived Codex 0.153.4 container per user with separate `/workspace` and `/codex-home` volumes, 8 GiB/4 CPU/1024 PID limits, read-only rootfs, dropped capabilities, and private runtime plus controlled-egress networks.
- **Full Agent toolchain**: Git/GitHub/SSH, Node/pnpm/Bun, Python/uv and data libraries, C/C++/Go/Rust/Java build tools, SQL/Redis clients, Chromium/Playwright, PDF/Office/OCR/image/audio utilities, and public HTTP access.
- **Managed capabilities**: administrators can catalog and assign Skills, Plugins, Apps, MCP servers, and Search. Desired state is reconciled into each user runtime and survives container replacement.
- **Scoped credentials**: model, MCP, Git, SSH, OAuth, and external-issued credentials can be encrypted per user/project and injected as ephemeral environment or `0600` tmpfs files without entering browser DTOs, Docker inspect output, or logs.
- **Thread discovery and restore**: discovers Codex sessions from remote state and opens threads with a small cached turn window first.
- **Realtime turns**: start new turns, steer running turns, interrupt active turns, and answer app-server dynamic requests over WebSocket.
- **Plan and goal modes**: review and execute structured plans; set, edit, pause, resume, stop, or clear app-server goals with token/time progress in the composer and details dialog.
- **Agent loop UI**: reasoning, command execution, terminal waits, file edits, streaming diffs, images, context compaction, sleep, MCP/tool calls, notifications, and sub-agent side panels.
- **Dockable IDE workspace**: split, resize, float, or pop out Agent, Files, Terminal, Browser, and Sub-agent panels with per-thread layouts persisted locally.
- **Remote file workspace**: browse the current project's file tree, edit text files, and preview Markdown, code, images, PDF, and Office files without downloading them first.
- **Remote terminal tabs**: open independent SSH PTY terminals beside the agent loop with `@xterm/xterm`; terminal sessions are isolated per user and host.
- **Remote browser tabs**: preview a Host's `localhost` HTTP/HTTPS application in Dockview through SSH, including full-origin resources and WebSocket traffic, without exposing an additional Gateway port. Per-resource failures are reported inside the preview.
- **Host and GPU observability**: stream CPU, memory, network, disk, GPU utilization, temperature, and VRAM metrics over the shared realtime connection. GPU process tables identify the remote user, PID, runtime, memory, and command behind each workload.
- **User-wide tmux monitoring**: scan tmux sessions across every configured Host, inspect recent pane output, and bind a monitor to the relevant Codex thread. One-shot monitors notify when the current job exits or returns to its shell; permanent monitors wait for later runs and notify after each completed run. Active monitors and history are persisted in MySQL.
- **Multi-client sync**: multiple browser tabs can subscribe to the same thread and receive the same gateway-side app-server event stream.
- **State repair**: after SSH/app-server reconnect, Gateway refreshes running thread state; a Nitro scheduled task also checks stale running threads.
- **Actionable notifications**: in-browser Sonner notifications and optional server-side Bark push for completed main turns and tmux jobs. Thread notifications navigate to the conversation; tmux notifications open the matching monitor and pane output. Delivery is de-duplicated per user and completion.
- **Mobile layout**: responsive sidebar, composer, long-press context actions, and sub-agent panels.
- **Real E2E coverage**: Playwright tests run against a real Nuxt server, real SSH Docker target, and real Codex app-server. The full-runtime acceptance test also provisions two isolated users, executes a real model turn, calls Search/business MCPs, installs a real local Plugin, and verifies restart persistence and secret redaction.

## Project Structure

```text
.
├── app/                       # Nuxt frontend, Pinia store, chat/thread/settings UI
├── packages/gateway-ui/       # Precompiled shadcn-vue component package
├── packages/gateway-ai-elements/ # Precompiled AI Elements component package
├── packages/gateway-browser-runtime/ # Precompiled browser runtime and rendering helpers
├── server/api/                # Browser-facing HTTP and WebSocket API
├── server/tasks/              # Nitro scheduled task entrypoints
├── server/utils/gateway/      # SSH, Codex RPC, runtime broker, storage, notifications
├── shared/                    # Shared DTOs, config, protocol helpers, thread history
├── i18n/locales/              # Chinese and English UI messages
├── tests/e2e/                 # Real SSH + app-server Playwright E2E
├── third_party/openai-codex/  # Official Codex source submodule for protocol reference
├── Dockerfile
└── docker-compose.yml
```

## Quick Start

Prerequisites: Docker with Compose, Git, and network access from Gateway to the SSH hosts you want to manage.

```bash
git clone --recurse-submodules https://github.com/yunhaoli24/codex-gateway.git
cd codex-gateway

cp .env.example .env
# Set CODEX_GATEWAY_CONFIG_SECRET, MYSQL_PASSWORD, and MYSQL_ROOT_PASSWORD in .env.
# Generate a different value for each with: openssl rand -hex 32

docker network create web-common 2>/dev/null || true
docker compose build codex-gateway
docker compose run --rm database-migrate
docker compose run --rm --no-deps codex-gateway \
  node scripts/create-user.mjs admin '<a-password-with-at-least-8-characters>'
docker compose up -d
```

Open the service through your reverse proxy, sign in with the manually created account, and add the first SSH host from Settings. The bundled Compose file intentionally exposes port `3000` only to the external `web-common` Docker network.

## Local Development

```bash
pnpm install
pnpm dev
```

Common commands:

```bash
pnpm lint
pnpm build
pnpm test:e2e
```

Environment variables:

| Variable | Required | Description |
| --- | --- | --- |
| `CODEX_GATEWAY_CONFIG_SECRET` | Yes in production | Stable secret used to encrypt stored host/project/thread config. |
| `DATAOPS_SERVICE_TOKEN` | When connecting Dinky | Long-lived service token used between Gateway and Dinky. Enter it in Dinky Agent Platform settings and reconnect when rotating it. |
| `DATABASE_URL` | External MySQL mode | MySQL 8 connection URL. Use the external database Compose overlay when setting it. |
| `MYSQL_TLS_MODE` | External MySQL mode | `required` encrypts without certificate/hostname verification; `verify-identity` verifies both and is recommended. Bundled MySQL defaults to `disabled` on its private network. |
| `MYSQL_TLS_CA_FILE` | With `verify-identity` | CA file path readable by Gateway and every database CLI container. |
| `MYSQL_DATABASE` | Self-contained Compose | Bundled MySQL database name. Defaults to `codex_gateway`. |
| `MYSQL_USER` | Self-contained Compose | Bundled MySQL application user. Defaults to `codex_gateway`. |
| `MYSQL_PASSWORD` | Self-contained Compose | Bundled MySQL application password. Use a URL-safe random value. |
| `MYSQL_ROOT_PASSWORD` | Self-contained Compose | Bundled MySQL administrative password; Gateway does not receive it. |
| `HOST` | No | Nuxt listen host. Docker uses `0.0.0.0`. |
| `PORT` | No | Nuxt listen port. Docker uses `3000`. |
| `BROWSER_PREVIEW_DOMAIN` | Browser preview | Parent domain for isolated preview origins; configure wildcard DNS for `p-*.your-domain`. |
| `BROWSER_PREVIEW_SECRET` | No | HMAC secret for stable per-user/Host/target preview origins. Defaults to `CODEX_GATEWAY_CONFIG_SECRET`. |
| `BROWSER_PREVIEW_SCHEME` | No | Public preview scheme, `https` by default. Use `http` only for local E2E/development. |
| `BROWSER_PREVIEW_PUBLIC_PORT` | No | Optional public port included in preview origins for local development. |
| `RUNTIME_MANAGER_SHARED_SECRET` | Managed Agents | HMAC/authentication secret shared only by Gateway and Runtime Manager. |
| `RUNTIME_MANAGER_IMAGE_ALIASES` | Managed Agents | JSON map of approved immutable Agent images. Keep the active Codex version and image tag pinned together. |
| `RUNTIME_PROVIDER_PROXY_BASE_URL` | Managed model access | Internal Gateway provider-proxy base URL reachable from Agent containers. Defaults to `http://codex-gateway:3000/api/internal/providers`. |
| `RUNTIME_AGENT_MEMORY` | No | Per-user Agent memory limit; the full profile defaults to `8g`. |
| `RUNTIME_AGENT_CPUS` | No | Per-user Agent CPU limit; the full profile defaults to `4`. |
| `RUNTIME_AGENT_PIDS` | No | Per-user Agent PID limit; the full profile defaults to `1024`. |
| `SEARXNG_IMAGE` | Search | Pinned SearXNG image used by the shared Search MCP. |
| `SEARXNG_SECRET` | Search | Independent SearXNG secret; do not reuse application or database secrets. |

Create an admin user:

```bash
CODEX_GATEWAY_CONFIG_SECRET="replace-with-a-long-random-secret" \
DATABASE_URL="mysql://user:password@127.0.0.1:3306/codex_gateway" \
pnpm db:migrate
CODEX_GATEWAY_CONFIG_SECRET="replace-with-a-long-random-secret" \
DATABASE_URL="mysql://user:password@127.0.0.1:3306/codex_gateway" \
pnpm user:create <username> <password>
```

`CODEX_GATEWAY_CONFIG_SECRET` encrypts stored connection config. Use a stable, sufficiently long secret in production. Changing it makes existing encrypted config unreadable.

## Security Model

- SSH credentials and Codex tokens stay on the server side.
- Browser clients authenticate to Gateway with a Bearer token.
- Stored connection config is encrypted in MySQL with `CODEX_GATEWAY_CONFIG_SECRET`.
- Direct terminal tabs, tmux inspection, and remote Browser proxy connections are server-side SSH channels; they do not expose SSH keys or remote ports to the browser.
- Public deployments should run behind a trusted reverse proxy with HTTPS.

## Docker Deployment

```bash
export CODEX_GATEWAY_CONFIG_SECRET="replace-with-a-long-random-secret"
export MYSQL_PASSWORD="$(openssl rand -hex 32)"
export MYSQL_ROOT_PASSWORD="$(openssl rand -hex 32)"
docker compose up -d --build
```

The self-contained stack keeps MySQL on an internal Docker network, persists it in the `mysql-data` named volume, runs schema migration once, and starts Gateway only after migration succeeds. Neither MySQL nor Gateway publishes a host port; put Gateway behind nginx, Caddy, Cloudflare Tunnel, or another trusted reverse proxy on `web-common`.

For a production-managed external MySQL 8 service, keep the connection and TLS settings in the uncommitted `.env`. `verify-identity` requires a CA file and verifies both the certificate chain and database hostname:

```dotenv
DATABASE_URL=mysql://user:percent-encoded-password@mysql.example.internal:3306/codex_gateway
MYSQL_TLS_MODE=verify-identity
MYSQL_TLS_CA_FILE=/run/secrets/mysql-ca.pem
```

Mount that file at the same read-only path for Gateway and the migration/CLI container in the site-local `docker-compose.override.yml`:

```yaml
services:
  database-migrate:
    volumes:
      - ./secrets/mysql-ca.pem:/run/secrets/mysql-ca.pem:ro
  codex-gateway:
    volumes:
      - ./secrets/mysql-ca.pem:/run/secrets/mysql-ca.pem:ro
```

Layer the external database override before that site-local override, and do not add a trailing service selector; the command starts Gateway, its one-shot migration gate, and Runtime Manager as the complete active stack:

```bash
docker compose \
  -f docker-compose.yml \
  -f docker-compose.external-db.yml \
  -f docker-compose.override.yml \
  up -d --build
```

External mode does not start the bundled MySQL service. Use `required` only when encryption without certificate/hostname verification is an accepted policy; `verify-identity` is the production recommendation. Gateway and all database CLIs use the same TLS variables. `DATABASE_URL` query parameters, including TLS, timezone, and multi-statement options, are rejected rather than ignored. Keep `DATABASE_URL`, CA material, and all passwords in an uncommitted environment or secret store. Follow [the MySQL cutover runbook](docs/operations/mysql-cutover.md) before changing an existing SQLite deployment, and use [the backup and restore runbook](docs/operations/mysql-backup-restore.md) for ongoing operations.

Remote Browser panels use isolated origins such as `p-<hmac>.example.com`. Configure wildcard DNS for `p-*.example.com` and route those hosts to the same Codex Gateway Nitro port (`3000`). The reverse proxy must preserve the Host header and WebSocket upgrades. No second listener or published container port is required. Upstream `Content-Security-Policy` and `X-Frame-Options` are preserved, so applications that prohibit embedding remain blocked by the browser.

## Testing

E2E tests do not mock Codex app-server:

- A production Nuxt build is started in the test runner.
- Docker provides a real SSH target.
- Gateway connects to the target over SSH and starts or resumes a real Codex app-server.
- Playwright verifies login, config, thread restore, realtime sync, mobile layout, diff rendering, dynamic requests, notifications, sub-agent UI, remote files, browser preview, and real tmux monitoring.

The full managed-Agent acceptance test additionally validates the immutable tool image, two-user container/volume/secret isolation, egress, Chromium, document conversion, OCR, Python analysis, Search and business MCP query/write, organization Skills, Plugin installation, Apps protocol availability, a real model turn, and restart persistence:

```bash
E2E_SKIP_AGENT_IMAGE_BUILD=1 E2E_EXPECT_MANAGED_RUNTIME=1 \
  tests/e2e/run-in-containers.sh -- tests/e2e/full-agent-runtime.spec.ts
```

Run:

```bash
pnpm test:e2e
```

If the host machine does not have `pnpm`, use the containerized runner directly:

```bash
tests/e2e/run-in-containers.sh
```

Run the full E2E suite for changes involving SSH, RPC, WebSocket, thread state, config, upload, diff rendering, mobile layout, or app-server protocol handling.

## Relationship With Codex

Codex Gateway targets the official Codex app-server protocol. `third_party/openai-codex/` is a submodule used only as a protocol and behavior reference. Gateway should align with official app-server behavior instead of fabricating frontend-only events or maintaining compatibility branches for old protocols.

## Contributing

Issues and pull requests are welcome. Read [CONTRIBUTING.md](CONTRIBUTING.md) before changing SSH, RPC, realtime state, or app-server protocol behavior. Please report vulnerabilities privately according to [SECURITY.md](SECURITY.md).

## License

[MIT](LICENSE)
