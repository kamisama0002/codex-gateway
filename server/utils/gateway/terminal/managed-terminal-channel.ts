import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import {
  runtimeTerminalOpenSchema,
  runtimeTerminalServerMessageSchema,
  type RuntimeTerminalOpen,
} from "@codex-gateway/agent-runtime-contracts";
import WebSocket, { type RawData } from "ws";
import type { RuntimeTerminalTarget } from "../runtime-manager/client";
import type { TerminalChannel } from "./terminal-manager";

const OPEN_TIMEOUT_MS = 30_000;

export class ManagedTerminalChannel extends EventEmitter implements TerminalChannel {
  readonly stderr = new PassThrough();
  private exited = false;

  private constructor(private readonly socket: WebSocket) {
    super();
  }

  static open(
    target: RuntimeTerminalTarget,
    input: RuntimeTerminalOpen,
  ): Promise<ManagedTerminalChannel> {
    const open = runtimeTerminalOpenSchema.parse(input);
    return new Promise((resolve, reject) => {
      const socket = new WebSocket(target.websocketUrl, {
        headers: target.headers(),
        perMessageDeflate: false,
      });
      const channel = new ManagedTerminalChannel(socket);
      let ready = false;
      const timer = setTimeout(() => {
        socket.terminate();
        reject(new Error("runtime_terminal_open_timeout"));
      }, OPEN_TIMEOUT_MS);
      const failOpen = (code: string) => {
        if (ready) return;
        clearTimeout(timer);
        socket.terminate();
        reject(new Error(code));
      };
      socket.once("open", () => socket.send(JSON.stringify(open)));
      socket.on("message", (raw: RawData, isBinary: boolean) => {
        try {
          if (isBinary) throw new Error("runtime_terminal_message_invalid");
          const message = runtimeTerminalServerMessageSchema.parse(JSON.parse(raw.toString()));
          if (!ready) {
            if (message.type === "error") return failOpen(message.code);
            if (message.type !== "ready") return failOpen("runtime_terminal_ready_required");
            ready = true;
            clearTimeout(timer);
            resolve(channel);
            return;
          }
          channel.receive(message);
        } catch {
          if (!ready) failOpen("runtime_terminal_message_invalid");
          else channel.emitError("runtime_terminal_message_invalid");
        }
      });
      socket.once("error", () => {
        if (!ready) failOpen("runtime_terminal_unavailable");
        else channel.emitError("runtime_terminal_unavailable");
      });
      socket.once("close", () => {
        clearTimeout(timer);
        if (!ready) reject(new Error("runtime_terminal_unavailable"));
        else channel.emitClose(null);
      });
    });
  }

  write(data: string) {
    if (this.socket.readyState !== WebSocket.OPEN) return false;
    this.socket.send(JSON.stringify({ type: "input", data }));
    return true;
  }

  setWindow(rows: number, cols: number, _height: number, _width: number) {
    if (this.socket.readyState !== WebSocket.OPEN) return;
    this.socket.send(JSON.stringify({ type: "resize", cols, rows }));
  }

  close() {
    if (this.socket.readyState === WebSocket.OPEN) {
      this.socket.send(JSON.stringify({ type: "close" }));
      this.socket.close(1000);
    } else if (this.socket.readyState < WebSocket.CLOSED) {
      this.socket.terminate();
    }
    this.stderr.destroy();
  }

  private receive(message: ReturnType<typeof runtimeTerminalServerMessageSchema.parse>) {
    if (message.type === "output") this.emit("data", Buffer.from(message.data, "utf8"));
    else if (message.type === "error") this.emitError(message.code);
    else if (message.type === "exit") this.emitClose(message.code);
  }

  private emitError(code: string) {
    if (this.listenerCount("error") > 0) this.emit("error", new Error(code));
    this.emitClose(null);
  }

  private emitClose(code: number | null) {
    if (this.exited) return;
    this.exited = true;
    this.emit("close", code, null);
  }
}
