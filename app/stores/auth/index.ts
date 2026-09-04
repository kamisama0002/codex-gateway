import { defineStore } from "pinia";
import { useLocalStorage, useSessionStorage } from "@vueuse/core";
import { authStorageKind, type AuthStorageMode } from "@/utils/dataops-embed";

export const AUTH_STORAGE_KEY = "codex-gateway-auth-token";

export const useAuthStore = defineStore("auth", () => {
  const token = ref("");
  const username = ref("");
  const initialized = ref(false);
  const sessionEpoch = ref(0);
  const storageMode = ref<AuthStorageMode>("standalone");
  const localToken = useLocalStorage<string | null>(AUTH_STORAGE_KEY, null);
  const localUsername = useLocalStorage<string | null>(`${AUTH_STORAGE_KEY}:username`, null);
  const sessionToken = useSessionStorage<string | null>(AUTH_STORAGE_KEY, null);
  const sessionUsername = useSessionStorage<string | null>(`${AUTH_STORAGE_KEY}:username`, null);

  const isAuthenticated = computed(() => token.value !== "");

  watch([localToken, localUsername], ([nextToken, nextUsername]) => {
    if (!initialized.value || authStorageKind(storageMode.value) !== "local") return;
    // VueUse synchronizes useLocalStorage across same-origin tabs. Mirror that durable state into
    // the live session so logout/account switches advance sessionEpoch and cancel stale HTTP/RAF
    // work in every open Gateway tab without waiting for a refresh.
    replaceSession(nextToken ?? "", nextUsername ?? "");
  });

  watch([sessionToken, sessionUsername], ([nextToken, nextUsername]) => {
    if (!initialized.value || authStorageKind(storageMode.value) !== "session") return;
    replaceSession(nextToken ?? "", nextUsername ?? "");
  });

  function hydrate(mode: AuthStorageMode = storageMode.value) {
    if (!import.meta.client || (initialized.value && storageMode.value === mode)) return;
    storageMode.value = mode;
    const stored = storageFor(mode);
    replaceSession(stored.token.value ?? "", stored.username.value ?? "");
    initialized.value = true;
  }

  async function login(input: { username: string; password: string }) {
    const session = await $fetch<{
      token: string;
      expiresAt: string;
      user: { id: number; username: string };
    }>("/api/auth/login", {
      method: "POST",
      body: input,
    });
    setSession(session.token, session.user.username, "standalone");
    return session;
  }

  async function loginWithDataOps(ticket: string) {
    storageMode.value = "embedded";
    clearStoredSession("embedded");
    replaceSession("", "");
    initialized.value = true;
    const session = await $fetch<{
      token: string;
      expiresAt: string;
      user: { id: number; username: string };
    }>("/api/auth/dataops", {
      method: "POST",
      body: { ticket },
    });
    setSession(session.token, session.user.username, "embedded");
    return session;
  }

  function setSession(nextToken: string, nextUsername: string, mode: AuthStorageMode) {
    storageMode.value = mode;
    replaceSession(nextToken, nextUsername);
    initialized.value = true;
    const stored = storageFor(mode);
    stored.token.value = nextToken;
    stored.username.value = nextUsername;
  }

  async function logout() {
    const currentToken = token.value;
    if (currentToken !== "") {
      try {
        await $fetch("/api/auth/logout", {
          method: "POST",
          headers: { authorization: `Bearer ${currentToken}` },
        });
      } finally {
        clearSession();
      }
      return;
    }
    clearSession();
  }

  function clearSession() {
    replaceSession("", "");
    initialized.value = true;
    clearStoredSession(storageMode.value);
  }

  function replaceSession(nextToken: string, nextUsername: string) {
    if (token.value !== nextToken) sessionEpoch.value += 1;
    token.value = nextToken;
    username.value = nextUsername;
  }

  function isCurrentSession(epoch: number) {
    return sessionEpoch.value === epoch;
  }

  function storageFor(mode: AuthStorageMode) {
    return authStorageKind(mode) === "session"
      ? { token: sessionToken, username: sessionUsername }
      : { token: localToken, username: localUsername };
  }

  function clearStoredSession(mode: AuthStorageMode) {
    const stored = storageFor(mode);
    stored.token.value = null;
    stored.username.value = null;
  }

  return {
    token,
    username,
    initialized,
    sessionEpoch,
    storageMode,
    isAuthenticated,
    hydrate,
    login,
    loginWithDataOps,
    logout,
    isCurrentSession,
  };
});
