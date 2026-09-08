import { fileURLToPath } from "node:url";

export default {
  plugins: [fileURLToPath(new URL("./plugins/e2e-test-driver.client", import.meta.url))],
};
