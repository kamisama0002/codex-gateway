import { createServer, type Server } from "node:http";
import { afterEach, describe, expect, it, vi } from "vitest";
import { WebSocketServer, type WebSocket } from "ws";
import { ManagedTerminalChannel } from "./managed-terminal-channel";

const servers: Array<Server | WebSocketServer> = [];

afterEach(async () => {
  await Promise.all(
    servers.splice(0).map(
      (server) =>
        new Promise<void>((resolve) => {
          if (server instanceof WebSocketServer) server.close(() => resolve());
          else server.close(() => resolve());
        }),
    ),
  );
});

describe("ManagedTerminalChannel", () => {
  it("maps Manager terminal frames to the existing channel API", async () => {
    const received: unknown[] = [];
    let managerSocket: WebSocket | null = null;
    const httpServer = createServer();
    const websocketServer = new WebSocketServer({ server: httpServer });
    servers.push(websocketServer, httpServer);
    websocketServer.on("connection", (socket, request) => {
      managerSocket = socket;
      expect(request.headers["x-runtime-nonce"]).toBe("terminal-nonce");
      socket.on("message", (raw) => {
        const message = JSON.parse(raw.toString()) as unknown;
        received.push(message);
        if ((message as { type?: string }).type === "open") {
          socket.send(JSON.stringify({ type: "ready" }));
        }
      });
    });
    await new Promise<void>((resolve) => httpServer.listen(0, "127.0.0.1", resolve));
    const address = httpServer.address();
    if (address === null || typeof address === "string") throw new Error("missing server address");

    const channel = await ManagedTerminalChannel.open(
      {
        runtimeId: "runtime-a",
        websocketUrl: `ws://127.0.0.1:${address.port}`,
        headers: () => ({ "x-runtime-nonce": "terminal-nonce" }),
      },
      { type: "open", cwd: "/workspace", cols: 80, rows: 24 },
    );
    const output = new Promise<string>((resolve) =>
      channel.once("data", (chunk: Buffer) => resolve(chunk.toString("utf8"))),
    );
    managerSocket?.send(JSON.stringify({ type: "output", data: "ready\r\n" }));
    await expect(output).resolves.toBe("ready\r\n");

    channel.write("pwd\r");
    channel.setWindow(40, 120, 0, 0);
    await vi.waitFor(() => {
      expect(received).toContainEqual({ type: "input", data: "pwd\r" });
      expect(received).toContainEqual({ type: "resize", cols: 120, rows: 40 });
    });
    channel.close();
    await vi.waitFor(() => expect(received).toContainEqual({ type: "close" }));
  });
});
