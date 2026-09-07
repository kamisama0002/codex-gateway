import type { defineWebSocketHandler } from "h3";

type BrowserPreviewWebSocketHooks = Parameters<typeof defineWebSocketHandler>[0];

export type BrowserPreviewPeer = Parameters<NonNullable<BrowserPreviewWebSocketHooks["open"]>>[0];
export type BrowserPreviewMessage = Parameters<
  NonNullable<BrowserPreviewWebSocketHooks["message"]>
>[1];
