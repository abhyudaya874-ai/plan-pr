import type { SourceRef } from "./events";

/**
 * Per-turn source registry (rule 40). Only tool results that carry web
 * evidence get registered; `n` is stable within the thread. Every URL shown
 * in the UI must come from here (invariant I2).
 */
export class SourceRegistry {
  private readonly byCanonical = new Map<string, SourceRef>();
  private counter = 0;

  register(input: Omit<SourceRef, "n">): SourceRef {
    const key = input.canonicalUrl;
    const existing = this.byCanonical.get(key);
    if (existing) return existing;
    const ref: SourceRef = { ...input, n: ++this.counter };
    this.byCanonical.set(key, ref);
    return ref;
  }

  get(n: number): SourceRef | undefined {
    return [...this.byCanonical.values()].find((s) => s.n === n);
  }

  all(): SourceRef[] {
    return [...this.byCanonical.values()].sort((a, b) => a.n - b.n);
  }
}

export interface ScrubResult {
  /** Answer text with only valid [n] markers kept (invalid stripped). */
  text: string;
  /** [n] values actually cited, in order of first use. */
  cited: number[];
  /** [n] values that had no registered source (citation defects). */
  defects: number[];
}

const CITE_RE = /\[(\d{1,2})\]/g;

/**
 * Drop every [n] that is not in the registry (invented citations get removed,
 * never rendered). Defects are counted for telemetry.
 */
export function scrubCitations(text: string, reg: SourceRegistry): ScrubResult {
  const cited: number[] = [];
  const defects: number[] = [];
  const out = text.replace(CITE_RE, (m, nStr: string) => {
    const n = Number(nStr);
    if (reg.get(n)) {
      if (!cited.includes(n)) cited.push(n);
      return m;
    }
    if (!defects.includes(n)) defects.push(n);
    return "";
  });
  return { text: out.replace(/ {2,}/g, " ").replace(/\s+([.,!?;:])/g, "$1"), cited, defects };
}
