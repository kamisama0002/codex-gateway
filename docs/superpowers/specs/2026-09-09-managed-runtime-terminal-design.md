# Managed Runtime Terminal Design

## Goal

Expose the existing Gateway terminal UI for the authenticated user's managed Agent Runtime while
preserving the current SSH terminal behavior for ordinary remote hosts.

## Current State

- Browser terminal messages already use the page's single authenticated realtime WebSocket.
- `TerminalManager` currently opens only `ssh2` shells.
- Managed Runtime messages explicitly reject `terminal.*` and the UI disables terminal together
  with browser preview.
- Runtime Manager already owns the Docker socket and supports bounded non-interactive exec.

## Architecture

The browser continues to send `terminal.open`, `terminal.input`, `terminal.resize`, and
`terminal.close` to Gateway. For ordinary hosts Gateway opens the existing SSH shell. For the
managed host sentinel, Gateway resolves the authenticated user's placement, opens a freshly signed
WebSocket to that placement's Runtime Manager, and adapts it to `TerminalManager`'s channel API.

Runtime Manager authenticates the WebSocket upgrade with the existing HMAC and nonce mechanism,
checks the runtime ID and placement generation, and starts a Docker Exec TTY inside that user's
container. The browser never receives a Runtime Manager URL, runtime ID, container ID, shared
secret, or Docker access.

```text
Browser xterm
  -> Gateway realtime WebSocket
  -> authenticated user placement lookup
  -> signed Runtime Manager terminal WebSocket
  -> Docker Exec TTY as 10001:10001
  -> /workspace in the user's Agent container
```

## Terminal Protocol

Runtime Manager exposes:

```text
GET /v1/runtimes/:runtimeId/generations/:placementGeneration/terminal
```

The upgrade has no query string and is signed as an empty-body `GET`. All frames are JSON and are
strictly validated.

Gateway to Manager:

- `{ "type": "open", "cwd": "/workspace", "cols": 80, "rows": 24 }`
- `{ "type": "input", "data": "..." }`
- `{ "type": "resize", "cols": 120, "rows": 40 }`
- `{ "type": "close" }`

Manager to Gateway:

- `{ "type": "ready" }`
- `{ "type": "output", "data": "..." }`
- `{ "type": "exit", "code": 0 }`
- `{ "type": "error", "code": "runtime_terminal_failed" }`

The first frame must be `open` and arrive within five seconds. Input frames are bounded to 64 KiB.
Dimensions are positive integers capped at 1,000 columns/rows.

## Docker Boundary

- `Tty`, stdin, stdout, and stderr attachment are enabled.
- The exec user is always `10001:10001`.
- `TERM=xterm-256color` is injected.
- The shell is login `bash` when available and login `sh` otherwise.
- `cwd` must normalize to `/workspace` or a descendant. The browser cannot select host paths.
- Closing the WebSocket sends terminal EOF and closes the Docker stream; sessions are ephemeral.
- Docker socket access remains exclusive to Runtime Manager.

## Gateway Session Behavior

Existing user-scoped terminal IDs, output buffering, workspace tabs, resize handling, and close
events are reused. Runtime terminal sessions are held in memory like SSH terminal sessions and are
closed when the runtime stops, restarts, is removed, or the Gateway-side session closes.

## UI Behavior

Terminal becomes available on the managed Runtime host. Browser preview and tmux remain disabled
there. Project/thread terminals start in their resolved `/workspace` path; host-scope managed
terminals start at `/workspace`.

## Errors And Security

Manager and Gateway expose stable error codes only. A missing/stopped runtime returns
`runtime_not_found` or `runtime_not_ready`; invalid cwd returns `runtime_terminal_cwd_invalid`;
transport failures return `runtime_terminal_unavailable`. Terminal output is user-visible by
definition but is never copied into audit metadata or server logs.

## Non-Goals

- Persistent terminal restoration after Gateway/Manager restart
- tmux support inside managed containers
- root shells or host-level shells
- browser-to-Manager or browser-to-container connections
