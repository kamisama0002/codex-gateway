import { defineEventHandler, getRequestURL } from "h3";
import { authenticateEvent } from "../utils/gateway/auth/context";

const PUBLIC_API_PATHS = new Set(["/api/auth/login", "/api/auth/dataops", "/api/realtime"]);

export default defineEventHandler((event) => {
  const path = getRequestURL(event).pathname;
  if (!path.startsWith("/api/") || PUBLIC_API_PATHS.has(path) || path.startsWith("/api/internal/providers/")) {
    return;
  }
  authenticateEvent(event);
});
