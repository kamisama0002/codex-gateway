<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { storeToRefs } from "pinia";
import { Toaster } from "@codex-gateway/ui/sonner";
import DataOpsAuthState from "@/components/auth/DataOpsAuthState.vue";
import LoginScreen from "@/components/auth/LoginScreen.vue";
import { useAuthStore } from "@/stores/auth";
import { useGatewayBootstrapStore } from "@/stores/gateway-bootstrap";
import { refreshGatewayClient } from "@/stores/gateway-bootstrap/refresh";
import { resetGatewayClientSession } from "@/stores/gateway-bootstrap/session-reset";
import { useGatewayNavigationStore } from "@/stores/gateway-navigation";
import { useGatewayThreadViewStore } from "@/stores/gateway-thread-view";
import { useGatewayRealtimeStore } from "@/stores/gateway-realtime";
import { threadTitleFallbacks, titleForThread } from "@/stores/gateway/thread-utils/identity";
import {
  createDataOpsParentMessage,
  dataOpsParentOrigin,
  parseDataOpsEmbedUrl,
  postDataOpsParentMessage,
  type DataOpsParentMessageType,
} from "@/utils/dataops-embed";

const bootstrap = useGatewayBootstrapStore();
const navigation = useGatewayNavigationStore();
const threadView = useGatewayThreadViewStore();
const realtime = useGatewayRealtimeStore();
const auth = useAuthStore();
const device = useDevice();
const route = useRoute();
const { t } = useI18n();
const { initializing } = storeToRefs(bootstrap);
const { selectedThreadId } = storeToRefs(navigation);
const { currentThread, history } = storeToRefs(threadView);
const { initialized, isAuthenticated, token } = storeToRefs(auth);
const mounted = ref(false);
const embeddedAuthPhase = ref<"connecting" | "authenticated" | "error">("connecting");
const embeddedAuthMessage = ref("");
const embeddedParentOrigin = ref<string | null>(null);
let activeSessionToken = "";
const embedded = computed(() => route.query.embedded === "1");
const layoutName = computed(() => (device.isMobileOrTablet ? "mobile" : "default"));
const pageTitle = computed(() => {
  if (!selectedThreadId.value || !currentThread.value) {
    return "Codex Gateway";
  }
  return `${titleForThread(currentThread.value, threadTitleFallbacks(t), history.value)} - Codex Gateway`;
});

useHead({
  title: pageTitle,
  link: [
    { rel: "apple-touch-icon", sizes: "180x180", href: "/apple-touch-icon.png" },
    { rel: "icon", type: "image/png", sizes: "32x32", href: "/favicon-32x32.png" },
    { rel: "icon", type: "image/png", sizes: "16x16", href: "/favicon-16x16.png" },
    { rel: "manifest", href: "/site.webmanifest" },
    { rel: "shortcut icon", href: "/favicon.ico" },
  ],
  meta: [
    { name: "theme-color", content: "#ffffff" },
    { name: "mobile-web-app-capable", content: "yes" },
    { name: "apple-mobile-web-app-capable", content: "yes" },
    { name: "apple-mobile-web-app-title", content: "Codex Gateway" },
  ],
});

onMounted(() => {
  mounted.value = true;
  void initializeAuthentication();
});

async function initializeAuthentication() {
  if (!embedded.value) {
    auth.hydrate("standalone");
    return;
  }
  const parsed = parseDataOpsEmbedUrl(window.location.href);
  if (parsed.cleanUrl !== window.location.href) {
    window.history.replaceState(window.history.state, "", parsed.cleanUrl);
  }
  embeddedParentOrigin.value = dataOpsParentOrigin(document.referrer);
  reportEmbeddedStatus("ready");
  if (parsed.ticket === null) {
    auth.hydrate("embedded");
    if (auth.isAuthenticated) {
      embeddedAuthPhase.value = "authenticated";
      reportEmbeddedStatus("authenticated");
    } else {
      failEmbeddedAuthentication();
    }
    return;
  }
  try {
    await auth.loginWithDataOps(parsed.ticket);
    embeddedAuthPhase.value = "authenticated";
    embeddedAuthMessage.value = "";
    reportEmbeddedStatus("authenticated");
  } catch {
    failEmbeddedAuthentication();
  }
}

function failEmbeddedAuthentication() {
  embeddedAuthPhase.value = "error";
  embeddedAuthMessage.value = t("app.dataOpsAuthFailedDescription");
  reportEmbeddedStatus("auth-error");
}

function reportEmbeddedStatus(type: DataOpsParentMessageType, message?: string) {
  if (!import.meta.client || window.parent === window) return;
  postDataOpsParentMessage(
    window.parent,
    embeddedParentOrigin.value,
    createDataOpsParentMessage(type, message),
  );
}

watch([embedded, initialized, isAuthenticated], ([isEmbedded, isInitialized, authenticated]) => {
  if (
    isEmbedded &&
    mounted.value &&
    isInitialized &&
    !authenticated &&
    embeddedAuthPhase.value === "authenticated"
  ) {
    failEmbeddedAuthentication();
  }
});

watch(
  [initialized, token],
  ([authInitialized, currentToken]) => {
    if (!authInitialized || currentToken === activeSessionToken) {
      return;
    }
    activeSessionToken = currentToken;
    // Reset on every token transition, including logged-out -> logged-in. A request rejected by
    // logout can still finish its catch/finally after the first reset; clearing again before the
    // next account hydrates prevents that stale projection from crossing the session boundary.
    resetGatewayClientSession();
    if (!currentToken) {
      return;
    }
    realtime.installHealthCheck();
    void refreshGatewayClient().catch((error) => {
      console.error("[gateway] failed to refresh app", error);
    });
  },
  { immediate: true },
);
</script>

<template>
  <NuxtRouteAnnouncer />
  <span
    v-if="mounted && (!isAuthenticated || !initializing)"
    data-testid="app-ready"
    class="sr-only"
    >ready</span
  >
  <Toaster
    rich-colors
    position="top-right"
    :mobile-offset="{ top: '4.5rem', right: '1rem', left: '1rem' }"
  />
  <DataOpsAuthState
    v-if="embedded && (!mounted || !isAuthenticated)"
    :phase="embeddedAuthPhase === 'error' ? 'error' : 'connecting'"
    :message="embeddedAuthMessage"
  />
  <LoginScreen v-else-if="mounted && !isAuthenticated" />
  <NuxtLayout v-else :name="layoutName" />
</template>
