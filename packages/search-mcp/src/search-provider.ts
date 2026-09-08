import { z } from "zod";

export interface SearchResult {
  title: string;
  url: string;
  snippet: string;
}

const searxResponseSchema = z
  .object({
    results: z.array(
      z
        .object({
          title: z.string(),
          url: z.url(),
          content: z.string().optional(),
        })
        .loose(),
    ),
  })
  .loose();

export class SearxSearchProvider {
  private readonly endpoint: URL;

  constructor(
    endpoint: string,
    private readonly fetchImpl: typeof globalThis.fetch = globalThis.fetch,
  ) {
    this.endpoint = new URL(endpoint);
    if (this.endpoint.username !== "" || this.endpoint.password !== "") {
      throw new Error("SearXNG URL must not contain credentials");
    }
  }

  async search(query: string, limit: number): Promise<SearchResult[]> {
    const url = new URL("/search", this.endpoint);
    url.searchParams.set("q", query);
    url.searchParams.set("format", "json");
    const response = await this.fetchImpl(url, { signal: AbortSignal.timeout(15_000) });
    if (!response.ok) throw new Error(`SearXNG failed with status ${response.status}`);
    const data = searxResponseSchema.parse(await response.json());
    return data.results.slice(0, limit).map((result) => ({
      title: result.title,
      url: result.url,
      snippet: result.content ?? "",
    }));
  }
}
