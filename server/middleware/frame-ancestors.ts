import {
  defineEventHandler,
  getRequestHeader,
  getRequestURL,
  setResponseHeader,
  type H3Event,
} from "h3";

export function frameAncestorsPolicy(value: string): string {
  const origins: string[] = [];
  for (const candidate of value.split(/[\s,]+/u).filter(Boolean)) {
    const origin = normalizedHttpOrigin(candidate);
    if (!origins.includes(origin)) origins.push(origin);
  }
  return `frame-ancestors 'self'${origins.length === 0 ? "" : ` ${origins.join(" ")}`}`;
}

export function applyFrameAncestorsHeader(event: H3Event, allowedOrigins: string): void {
  if (!isHtmlNavigation(event)) return;
  setResponseHeader(event, "Content-Security-Policy", frameAncestorsPolicy(allowedOrigins));
}

export default defineEventHandler((event) => {
  applyFrameAncestorsHeader(event, process.env.DATAOPS_ALLOWED_ORIGINS ?? "");
});

function normalizedHttpOrigin(value: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error("Invalid DataOps allowed origin");
  }
  if (
    (url.protocol !== "http:" && url.protocol !== "https:") ||
    url.username !== "" ||
    url.password !== "" ||
    url.hostname.includes("*") ||
    url.pathname !== "/" ||
    url.search !== "" ||
    url.hash !== ""
  ) {
    throw new Error("Invalid DataOps allowed origin");
  }
  return url.origin;
}

function isHtmlNavigation(event: H3Event): boolean {
  const method = event.method.toUpperCase();
  if (method !== "GET" && method !== "HEAD") return false;
  if (getRequestURL(event).pathname.startsWith("/api/")) return false;
  return (getRequestHeader(event, "accept") ?? "").toLowerCase().includes("text/html");
}
