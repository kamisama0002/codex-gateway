export const DINKY_THEME_STORAGE_KEY = "navTheme";

export type GatewayTheme = "light" | "dark";

export type DinkyThemeMessage = {
  source: "dinky";
  type: "theme-change" | "theme-response";
  theme: string;
};

/** Convert Dinky's `light`/`realDark` values and common aliases to Gateway themes. */
export function normalizeGatewayTheme(value: unknown): GatewayTheme | null {
  if (typeof value !== "string") return null;

  switch (value.trim().toLowerCase()) {
    case "light":
    case "day":
      return "light";
    case "dark":
    case "realdark":
    case "night":
      return "dark";
    default:
      return null;
  }
}

export function themeFromUrl(input: string | URL): GatewayTheme | null {
  try {
    const url = typeof input === "string" ? new URL(input) : input;
    return normalizeGatewayTheme(
      url.searchParams.get("theme") ?? url.searchParams.get(DINKY_THEME_STORAGE_KEY),
    );
  } catch {
    return null;
  }
}

export function dinkyThemeMessage(data: unknown): DinkyThemeMessage | null {
  if (!isRecord(data) || data.source !== "dinky") return null;
  if (data.type !== "theme-change" && data.type !== "theme-response") return null;
  if (typeof data.theme !== "string" || normalizeGatewayTheme(data.theme) === null) return null;
  return {
    source: "dinky",
    type: data.type,
    theme: data.theme,
  };
}

export function isAllowedDinkyMessage(
  event: { origin: string; source: object | null },
  parent: object,
  allowedOrigins: ReadonlySet<string>,
): boolean {
  if (event.source !== parent) return false;
  return allowedOrigins.has(event.origin);
}

export function createDinkyThemeController(
  options: {
    window?: Window;
    document?: Document;
  } = {},
) {
  const browserWindow = options.window ?? (typeof window === "undefined" ? null : window);
  const browserDocument = options.document ?? (typeof document === "undefined" ? null : document);
  let currentTheme: GatewayTheme = "light";
  let explicitTheme = false;
  let started = false;
  let systemMedia: MediaQueryList | null = null;
  let parentOrigin: string | null = null;
  let parentWindow: Window | null = null;

  function start() {
    if (started || browserWindow === null || browserDocument === null) return;
    started = true;
    parentWindow = browserWindow.parent === browserWindow ? null : browserWindow.parent;
    parentOrigin = resolveParentOrigin(browserWindow, browserDocument);

    const initialTheme = resolveInitialTheme(browserWindow, browserDocument);
    explicitTheme = initialTheme.explicit;
    applyTheme(initialTheme.theme, initialTheme.explicit ? "explicit" : "system");

    browserWindow.addEventListener("storage", handleStorage);
    browserWindow.addEventListener("message", handleMessage);
    systemMedia = browserWindow.matchMedia("(prefers-color-scheme: dark)");
    systemMedia.addEventListener?.("change", handleSystemThemeChange);
    if (parentWindow !== null && isSameOrigin(parentOrigin, browserWindow.location.origin)) {
      parentWindow.addEventListener("storage", handleStorage);
    }

    requestThemeFromParent();
  }

  function stop() {
    if (!started || browserWindow === null) return;
    browserWindow.removeEventListener("storage", handleStorage);
    browserWindow.removeEventListener("message", handleMessage);
    systemMedia?.removeEventListener?.("change", handleSystemThemeChange);
    if (
      parentWindow !== null &&
      browserDocument !== null &&
      isSameOrigin(parentOrigin, browserWindow.location.origin)
    ) {
      parentWindow.removeEventListener("storage", handleStorage);
    }
    systemMedia = null;
    started = false;
  }

  function applyTheme(theme: GatewayTheme, source: "explicit" | "system" = "explicit") {
    currentTheme = theme;
    explicitTheme = source === "explicit";
    const root = browserDocument?.documentElement;
    if (root === undefined || root === null) return;
    root.classList.toggle("dark", theme === "dark");
    root.classList.toggle("light", theme === "light");
    root.dataset.theme = theme;
    root.style.colorScheme = theme;
  }

  function handleStorage(event: StorageEvent) {
    if (event.key !== DINKY_THEME_STORAGE_KEY) return;
    const theme = normalizeGatewayTheme(event.newValue);
    if (theme !== null) applyTheme(theme, "explicit");
    else applyTheme(systemTheme(browserWindow), "system");
  }

  function handleMessage(event: MessageEvent<unknown>) {
    if (
      parentWindow === null ||
      !isAllowedDinkyMessage(event, parentWindow, allowedParentOrigins())
    ) {
      return;
    }
    const message = dinkyThemeMessage(event.data);
    const theme = normalizeGatewayTheme(message?.theme);
    if (theme !== null) applyTheme(theme, "explicit");
  }

  function handleSystemThemeChange(event: MediaQueryListEvent) {
    if (explicitTheme) return;
    applyTheme(event.matches ? "dark" : "light", "system");
  }

  function requestThemeFromParent() {
    if (parentWindow === null || parentOrigin === null) return;
    parentWindow.postMessage({ source: "codex-gateway", type: "theme-request" }, parentOrigin);
  }

  function allowedParentOrigins() {
    const origins = new Set<string>();
    if (parentOrigin !== null) origins.add(parentOrigin);
    if (browserWindow !== null && parentWindow === browserWindow) {
      origins.add(browserWindow.location.origin);
    }
    return origins;
  }

  return {
    start,
    stop,
    applyTheme,
    get currentTheme() {
      return currentTheme;
    },
  };
}

function resolveInitialTheme(
  browserWindow: Window,
  browserDocument: Document,
): { theme: GatewayTheme; explicit: boolean } {
  const fromUrl = themeFromUrl(browserWindow.location.href);
  if (fromUrl !== null) return { theme: fromUrl, explicit: true };

  const ownStorageTheme = normalizeGatewayTheme(readStorage(browserWindow));
  if (ownStorageTheme !== null) return { theme: ownStorageTheme, explicit: true };

  if (browserWindow.parent !== browserWindow) {
    const parentStorageTheme = normalizeGatewayTheme(readStorage(browserWindow.parent));
    if (parentStorageTheme !== null) return { theme: parentStorageTheme, explicit: true };

    try {
      const parentDocumentTheme = readDocumentTheme(browserWindow.parent.document);
      if (parentDocumentTheme !== null) return { theme: parentDocumentTheme, explicit: true };
    } catch {
      // Cross-origin parents intentionally deny DOM access. The postMessage bridge handles them.
    }
  }

  const currentDocumentTheme = readDocumentTheme(browserDocument);
  return currentDocumentTheme === null
    ? { theme: systemTheme(browserWindow), explicit: false }
    : { theme: currentDocumentTheme, explicit: true };
}

function readStorage(targetWindow: Window): string | null {
  try {
    return targetWindow.localStorage.getItem(DINKY_THEME_STORAGE_KEY);
  } catch {
    return null;
  }
}

function readDocumentTheme(targetDocument: Document): GatewayTheme | null {
  try {
    const root = targetDocument.documentElement;
    return (
      normalizeGatewayTheme(root.dataset.theme) ??
      (root.classList.contains("dark") ? "dark" : root.classList.contains("light") ? "light" : null)
    );
  } catch {
    return null;
  }
}

function systemTheme(browserWindow: Window | null): GatewayTheme {
  try {
    return browserWindow?.matchMedia("(prefers-color-scheme: dark)").matches === true
      ? "dark"
      : "light";
  } catch {
    return "light";
  }
}

function resolveParentOrigin(browserWindow: Window, browserDocument: Document): string | null {
  const referrerOrigin = originFromUrl(browserDocument.referrer);
  if (referrerOrigin !== null) return referrerOrigin;

  try {
    const ancestorOrigins = browserWindow.location.ancestorOrigins;
    if (ancestorOrigins.length > 0) return ancestorOrigins[ancestorOrigins.length - 1] ?? null;
  } catch {
    // Access can be unavailable in non-Chromium browsers.
  }

  return browserWindow.parent === browserWindow ? browserWindow.location.origin : null;
}

function originFromUrl(value: string): string | null {
  if (value === "") return null;
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:" ? url.origin : null;
  } catch {
    return null;
  }
}

function isSameOrigin(left: string | null, right: string): boolean {
  return left !== null && left === right;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
