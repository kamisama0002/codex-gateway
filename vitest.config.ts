import { fileURLToPath, URL } from "node:url";
import { defineConfig } from "vitest/config";

const usesMysqlHarness = process.env.MYSQL_TEST_DATABASE_URL !== undefined;

export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./app", import.meta.url)),
      "~~": fileURLToPath(new URL("./", import.meta.url)),
    },
  },
  test: {
    include: [
      "{app,server,shared,packages,scripts,tests/unit}/**/*.{test,spec}.{js,mjs,cjs,ts,mts,cts,jsx,tsx}",
    ],
    maxWorkers: usesMysqlHarness ? 2 : undefined,
    setupFiles: ["./tests/unit/setup.ts"],
    testTimeout: usesMysqlHarness ? 20_000 : undefined,
  },
});
