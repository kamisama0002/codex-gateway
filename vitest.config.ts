import { fileURLToPath, URL } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./app", import.meta.url)),
      "~~": fileURLToPath(new URL("./", import.meta.url)),
    },
  },
  test: {
    include: [
      "{server,shared,packages,scripts,tests/unit}/**/*.{test,spec}.{js,mjs,cjs,ts,mts,cts,jsx,tsx}",
    ],
    setupFiles: ["./tests/unit/setup.ts"],
  },
});
