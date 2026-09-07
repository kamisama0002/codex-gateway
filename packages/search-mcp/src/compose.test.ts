import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("Search MCP container policy", () => {
  it("keeps search services internal, unmounted, and on only the required networks", () => {
    const compose = readCompose();
    const searxng = serviceBlock(compose, "searxng", "search-mcp");
    const searchMcp = serviceBlock(compose, "search-mcp", "agent-runtime-manager");

    expect(searxng).toContain("image: ${SEARXNG_IMAGE:?");
    expect(searxng).toContain("- agent-egress");
    expect(searxng).toContain("- search-backend");
    expect(searxng).toContain("./docker/searxng/settings.yml:/etc/searxng/settings.yml:ro");
    expect(searxng).not.toContain("/workspace");
    expect(searxng).not.toMatch(/^\s+ports:/mu);

    expect(searchMcp).toContain("dockerfile: docker/search-mcp.Dockerfile");
    expect(searchMcp).toContain("- agent-runtime");
    expect(searchMcp).toContain("- search-backend");
    expect(searchMcp).not.toMatch(/^\s+(ports|volumes):/mu);
  });

  it("ships a test-only business MCP without enabling it in the production profile", () => {
    const compose = readCompose();
    const businessMcp = serviceBlock(compose, "test-business-mcp", "agent-runtime-manager");

    expect(businessMcp).toContain('profiles: ["test-business-mcp"]');
    expect(businessMcp).toContain("dockerfile: docker/test-business-mcp.Dockerfile");
    expect(businessMcp).toContain("- agent-runtime");
    expect(businessMcp).not.toMatch(/^\s+ports:/mu);
  });
});

function readCompose() {
  return readFileSync(new URL("../../../docker-compose.yml", import.meta.url), "utf8");
}

function serviceBlock(compose: string, service: string, nextService: string) {
  const start = compose.indexOf(`  ${service}:`);
  const end = compose.indexOf(`\n  ${nextService}:`, start);
  expect(start).toBeGreaterThanOrEqual(0);
  expect(end).toBeGreaterThan(start);
  return compose.slice(start, end);
}
