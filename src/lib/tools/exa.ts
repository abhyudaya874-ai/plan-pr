import { z } from "zod";
import type { SearchResultItem } from "./tavily";

/**
 * Thin Exa client — POST https://api.exa.ai/search with x-api-key auth.
 * Contract from https://docs.exa.ai/reference/search (read before coding):
 * {query, type: "auto"|"lite"|"deep"|"instant", numResults, contents: {highlights, text}}
 * Response: {results: [{url,title,score,publishedDate,highlights[],text}]}
 */
const exaResponseSchema = z.object({
  results: z
    .array(
      z.object({
        url: z.string(),
        title: z.string().optional().default(""),
        score: z.number().optional(),
        publishedDate: z.string().nullable().optional(),
        highlights: z.array(z.string()).optional().default([]),
        text: z.string().optional().default(""),
      }),
    )
    .optional()
    .default([]),
});

export class ExaClient {
  constructor(
    private readonly apiKey: string,
    private readonly fetchFn: typeof fetch = fetch,
    private readonly baseUrl = "https://api.exa.ai",
  ) {}

  async search(
    args: { query: string; maxResults?: number; timeRange?: "day" | "week" | "month" | "year" },
    signal?: AbortSignal,
  ): Promise<SearchResultItem[]> {
    const since: Record<string, number> = {
      day: 1,
      week: 7,
      month: 30,
      year: 365,
    };
    const body: Record<string, unknown> = {
      query: args.query,
      type: "auto",
      numResults: args.maxResults ?? 6,
      contents: { highlights: true, text: { maxCharacters: 1200 } },
    };
    if (args.timeRange) {
      body["startPublishedDate"] = new Date(
        Date.now() - (since[args.timeRange] ?? 30) * 86400_000,
      ).toISOString();
    }
    const res = await this.fetchFn(`${this.baseUrl}/search`, {
      method: "POST",
      headers: {
        "x-api-key": this.apiKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
      signal,
    });
    if (!res.ok) {
      const t = await res.text().catch(() => "");
      throw new Error(`exa HTTP ${res.status}: ${t.slice(0, 160)}`);
    }
    const data = exaResponseSchema.parse(await res.json());
    return (data.results ?? []).map((r) => ({
      url: r.url,
      title: r.title,
      content: r.highlights?.[0] ?? r.text.slice(0, 400),
      score: r.score,
      publishedDate: r.publishedDate ?? null,
    }));
  }
}
