import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { reactive } from "vue";

const auth = vi.hoisted(() => ({
  hydrate: vi.fn(),
  isAuthenticated: true,
  token: "active-session-token",
}));

vi.mock("@/stores/auth", () => ({ useAuthStore: () => auth }));

import { createRealtimeConnection } from "./connection";

class FakeWebSocket extends EventTarget {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSING = 2;
  static readonly CLOSED = 3;

  readonly sent: string[] = [];
  readyState = FakeWebSocket.CONNECTING;

  constructor(readonly url: string) {
    super();
    sockets.push(this);
  }

  send(message: string) {
    this.sent.push(message);
  }

  close() {
    this.disconnect(1000, "Client closed");
  }

  open() {
    this.readyState = FakeWebSocket.OPEN;
    this.dispatchEvent(new Event("open"));
  }

  disconnect(code = 1006, reason = "Connection lost") {
    this.readyState = FakeWebSocket.CLOSED;
    const event = new Event("close");
    Object.defineProperties(event, {
      code: { value: code },
      reason: { value: reason },
    });
    this.dispatchEvent(event);
  }
}

const sockets: FakeWebSocket[] = [];

describe("gateway realtime connection recovery", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    sockets.length = 0;
    auth.hydrate.mockClear();
    auth.isAuthenticated = true;
    auth.token = "active-session-token";
    vi.stubGlobal("reactive", reactive);
    vi.stubGlobal("WebSocket", FakeWebSocket);
    vi.stubGlobal("window", {
      location: { host: "gateway.test", protocol: "http:" },
      setTimeout: globalThis.setTimeout,
      clearTimeout: globalThis.clearTimeout,
    });
  });

  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("expires authentication and does not reconnect after an authentication close", () => {
    const authenticationExpired = vi.fn();
    const connection = createConnection(authenticationExpired);

    connection.connect();
    sockets[0]?.open();
    sockets[0]?.disconnect(4401, "Session revoked");

    expect(authenticationExpired).toHaveBeenCalledOnce();
    expect(connection.state.reconnectTimer).toBeNull();
    expect(connection.state.reconnectAttempt).toBe(0);
  });

  it("rejects readiness immediately when a connection generation closes", async () => {
    const connection = createConnection();
    const ready = connection.waitForReady(15_000);
    const rejected = vi.fn();
    void ready.catch(rejected);

    sockets[0]?.disconnect();
    await Promise.resolve();

    expect(rejected).toHaveBeenCalledOnce();
  });

  it("removes an unready waiter, timer, and listener immediately when aborted", async () => {
    const connection = createConnection();
    const controller = new AbortController();
    const removeEventListener = vi.spyOn(controller.signal, "removeEventListener");
    const ready = connection.waitForReady(15_000, controller.signal);
    const settled = ready.catch((error: unknown) => error);

    expect(vi.getTimerCount()).toBe(1);
    controller.abort(new Error("Submission cancelled"));

    expect(await settled).toBe(controller.signal.reason);
    expect(vi.getTimerCount()).toBe(0);
    expect(removeEventListener).toHaveBeenCalledWith("abort", expect.any(Function));
  });

  it("stops reconnecting after the DSH retry schedule is exhausted", async () => {
    const connection = createConnection();
    connection.connect();

    for (const delay of [500, 1_000, 2_000, 4_000, 8_000, 10_000]) {
      sockets.at(-1)?.disconnect();
      await vi.advanceTimersByTimeAsync(delay);
    }
    expect(sockets).toHaveLength(7);

    sockets.at(-1)?.disconnect();
    connection.checkConnection();
    await vi.advanceTimersByTimeAsync(30_000);

    expect(sockets).toHaveLength(7);
  });
});

function createConnection(authenticationExpired = vi.fn()) {
  return createRealtimeConnection({
    disconnectedMessage: () => "Disconnected",
    onMessage: vi.fn(),
    onDisconnected: vi.fn(),
    onAuthenticationExpired: authenticationExpired,
  });
}
