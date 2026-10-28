import { z } from "zod";

export interface SearchResultItem {
  url: string;
  title: string;
  content: string;
  score?: number;
  publishedDate?: string | null;
}

const searchResponseSchema = z.object({
  results: z
    .array(
      z.object({
        url: z.string(),
        title: z.string().optional().default(""),
        content: z.string().optional().default(""),
        score: z.number().optional(),
        published_date: z.string().nullable().optional(),
      }),
    )
    .optional()
    .default([]),
});

const extractResponseSchema = z.object({
  results: z
    .array(z.object({ url: z.string(), raw_content: z.string().optional().default("") }))
    .optional()
    .default([]),
  failed_results: z.array(z.unknown()).optional().default([]),
});

export interface TavilySearchArgs {
  query: string;
  depth?: "basic" | "advanced";
  maxResults?: number;
  timeRange?: "day" | "week" | "month" | "year";
}

/** Thin Tavily client (two POSTs, Bearer auth) - no SDK dependency. */
export class TavilyClient {
  constructor(
    private readonly apiKey: string,
    private readonly fetchFn: typeof fetch = fetch,
    private readonly baseUrl = "https://api.tavily.com",
  ) {}

  private headers(): Record<string, string> {
    return {
      Authorization: `Bearer ${this.apiKey}`,
      "Content-Type": "application/json",
    };
  }

  async search(args: TavilySearchArgs, signal?: AbortSignal): Promise<SearchResultItem[]> {
    const res = await this.fetchFn(`${this.baseUrl}/search`, {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify({
        query: args.query,
        search_depth: args.depth ?? "basic",
        max_results: Math.min(args.maxResults ?? 8, 8),
        ...(args.timeRange ? { time_range: args.timeRange } : {}),
      }),
      signal,
    });
    if (!res.ok) throw new Error(`tavily search HTTP ${res.status}`);
    const parsed = searchResponseSchema.safeParse(await res.json());
    if (!parsed.success) throw new Error("tavily search: bad response shape");
    return parsed.data.results.map((r) => ({
      url: r.url,
      title: r.title || r.url,
      content: r.content,
      score: r.score,
      publishedDate: r.published_date ?? null,
    }));
  }

  async extract(url: string, signal?: AbortSignal): Promise<{ url: string; text: string } | null> {
    const res = await this.fetchFn(`${this.baseUrl}/extract`, {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify({ urls: [url], format: "text", timeout: 15 }),
      signal,
    });
    if (!res.ok) throw new Error(`tavily extract HTTP ${res.status}`);
    const parsed = extractResponseSchema.safeParse(await res.json());
    if (!parsed.success) throw new Error("tavily extract: bad response shape");
    const first = parsed.data.results[0];
    if (!first) return null;
    return { url: first.url, text: first.raw_content };
  }
}
