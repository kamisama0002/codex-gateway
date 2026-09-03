import type {
  DockviewApi,
  DockviewGroupPanel,
  DockviewPanelApi,
  IDockviewPanel,
} from "dockview-vue";
import { toast } from "@codex-gateway/ui/sonner";

export function floatDockItem(api: DockviewApi, item: IDockviewPanel | DockviewGroupPanel) {
  api.addFloatingGroup(item, floatingBounds());
}

export function splitDockPanelRight(api: DockviewPanelApi) {
  api.moveTo({ group: api.group, position: "right" });
}

export async function popoutDockItem(
  api: DockviewApi,
  item: IDockviewPanel | DockviewGroupPanel,
  blockedMessage: { title: string; description: string },
) {
  const opened = await api.addPopoutGroup(item, { popoutUrl: "/popout.html" });
  if (!opened) notifyPopoutBlocked(blockedMessage);
}

export function notifyPopoutBlocked(message: { title: string; description: string }) {
  toast.error(message.title, { description: message.description });
}

function floatingBounds() {
  return {
    width: Math.min(window.innerWidth * 0.72, 880),
    height: Math.min(window.innerHeight * 0.72, 640),
    x: window.innerWidth * 0.08,
    y: window.innerHeight * 0.08,
  };
}
