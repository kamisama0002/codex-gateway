import { tmpdir } from "node:os";
import { join } from "node:path";

// Unit tests must never open the shared production-style database. A worker-local path prevents
// Nuxt dev servers and parallel Vitest workers from contending on SQLite's WAL file.
process.env.CODEX_GATEWAY_DB_PATH = join(tmpdir(), `codex-gateway-vitest-${process.pid}.db`);
