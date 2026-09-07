import { defineNuxtPlugin } from "nuxt/app";
import { useGatewayBootstrapStore } from "@/stores/gateway-bootstrap";
import { useGatewayCatalogStore } from "@/stores/gateway-catalog";
import { useGatewayComposerStore } from "@/stores/gateway-composer";
import { useGatewayConfigStore } from "@/stores/gateway-config";
import { useGatewayBrowserStore } from "@/stores/gateway-browser";
import { useGatewayNavigationStore } from "@/stores/gateway-navigation";
import { useGatewayRealtimeStore } from "@/stores/gateway-realtime";
import { useGatewayThreadActivityStore } from "@/stores/gateway-thread-activity";
import { useGatewayThreadRuntimeStore } from "@/stores/gateway-thread-runtime";
import { useGatewayThreadTurnsStore } from "@/stores/gateway-thread-turns";
import { useGatewayThreadViewStore } from "@/stores/gateway-thread-view";
import { useGatewayTmuxStore } from "@/stores/gateway-tmux";
import { useGatewayWorkspaceLayoutStore } from "@/stores/gateway-workspace-layout";
import { openTerminalSession } from "@/stores/gateway-terminal/transport";
import { browserWorkspacePanelId } from "@/stores/gateway/workspace-panels";
import { errorMessageLabels } from "@/stores/gateway/thread-utils/identity";
import { createUuid } from "@/lib/uuid";
import type { TerminalOpenInput } from "@/stores/gateway/types";
import type { TerminalSessionSnapshot, ThreadGoalStatus } from "~~/shared/types";

export type GoalControlCapture = { type: "status"; status: ThreadGoalStatus } | { type: "clear" };

export interface GatewayE2eCaptures {
  goalObjective: string | null;
  goalControls: GoalControlCapture[];
}

export interface GatewayE2eTestDriver {
  captures: GatewayE2eCaptures;
  bootstrap: ReturnType<typeof useGatewayBootstrapStore>;
  catalog: ReturnType<typeof useGatewayCatalogStore>;
  composer: ReturnType<typeof useGatewayComposerStore>;
  config: ReturnType<typeof useGatewayConfigStore>;
  navigation: ReturnType<typeof useGatewayNavigationStore>;
  realtime: ReturnType<typeof useGatewayRealtimeStore>;
  runtime: ReturnType<typeof useGatewayThreadRuntimeStore>;
  activity: ReturnType<typeof useGatewayThreadActivityStore>;
  turns: ReturnType<typeof useGatewayThreadTurnsStore>;
  views: ReturnType<typeof useGatewayThreadViewStore>;
  workspace: {
    openBrowser: (targetUrl: string) => void;
    openTerminal: (input: TerminalOpenInput) => Promise<TerminalSessionSnapshot>;
    openTmux: () => void;
  };
}

function createGatewayE2eTestDriver(): GatewayE2eTestDriver {
  const bootstrap = useGatewayBootstrapStore();
  const browser = useGatewayBrowserStore();
  const layout = useGatewayWorkspaceLayoutStore();
  const navigation = useGatewayNavigationStore();
  const tmux = useGatewayTmuxStore();
  return {
    captures: {
      goalObjective: null,
      goalControls: [],
    },
    bootstrap,
    catalog: useGatewayCatalogStore(),
    composer: useGatewayComposerStore(),
    config: useGatewayConfigStore(),
    navigation,
    realtime: useGatewayRealtimeStore(),
    runtime: useGatewayThreadRuntimeStore(),
    activity: useGatewayThreadActivityStore(),
    turns: useGatewayThreadTurnsStore(),
    views: useGatewayThreadViewStore(),
    workspace: {
      openBrowser(targetUrl) {
        if (navigation.selectedHostId === null)
          throw new Error("Select a Host before opening Browser");
        const panelId = createUuid();
        browser.addPanel({
          panelId,
          title: new URL(targetUrl).host,
          targetUrl,
          hostId: navigation.selectedHostId,
          projectId: navigation.selectedProjectId,
          threadId: navigation.selectedThreadId,
        });
        layout.requestPanelActivation(browserWorkspacePanelId(panelId));
      },
      openTerminal(input) {
        return openTerminalSession(
          {
            t: bootstrap.t,
            errorLabels: errorMessageLabels(bootstrap.t),
            setError: bootstrap.setError,
          },
          input,
        );
      },
      openTmux() {
        tmux.openPanel();
      },
    },
  };
}

export default defineNuxtPlugin((nuxtApp) => {
  nuxtApp.hook("app:mounted", () => {
    // Several setup stores consume Vue injections such as i18n. Creating them while Nuxt is still
    // installing plugins runs outside a component setup scope and Vue I18n rejects that lifecycle.
    // The root workspace has initialized these public stores by app:mounted, so the test driver can
    // bind typed store APIs without reaching into Pinia's private registry.
    window.__codexGatewayE2e = createGatewayE2eTestDriver();
  });
});

declare global {
  interface Window {
    __codexGatewayE2e?: GatewayE2eTestDriver;
  }
}
