import { describe, expect, it } from "vitest";
import {
  normalizeForRouting,
  routeByHeuristics,
} from "@/lib/agent/intent";
import { SourceRegistry, scrubCitations } from "@/lib/agent/sources";

describe("normalizeForRouting", () => {
  it("lowercases, collapses whitespace and repeated chars", () => {
    expect(normalizeForRouting("  WHTS   is 2+2 ")).toBe("whts is 2+2");
    expect(normalizeForRouting("soooo coool")).toBe("soo cool");
  });
});

describe("routeByHeuristics", () => {
  it("routes greetings and trivial maths to chat", () => {
    expect(routeByHeuristics("hi").route).toBe("chat");
    expect(routeByHeuristics("whts 2+2").route).toBe("chat");
    expect(routeByHeuristics("thank you").route).toBe("chat");
  });

  it("routes time-sensitive / regulatory queries to research", () => {
    expect(routeByHeuristics("wether in patna rn").route).toBe("research");
    expect(routeByHeuristics("sebbi ria fee limt").route).toBe("research");
    expect(routeByHeuristics("latest SEBI circular on mutual funds").route).toBe("research");
  });

  it("routes plan/explain/compare to reason", () => {
    expect(routeByHeuristics("explain direct vs regular plan").route).toBe("reason");
    expect(routeByHeuristics("compare these two goals").route).toBe("reason");
  });

  it("detects hinglish", () => {
    expect(routeByHeuristics("mutal fnd direct vs regulr diff kya hai").languageHint).toBe("hinglish");
  });
});

describe("scrubCitations", () => {
  it("keeps registered markers, drops invented ones", () => {
    const reg = new SourceRegistry();
    reg.register({
      url: "https://sebi.gov.in/x.html",
      canonicalUrl: "https://sebi.gov.in/x.html",
      title: "SEBI page",
      domain: "sebi.gov.in",
      snippet: "s",
      retrievedAt: "now",
      via: "fetch",
    });
    const r = scrubCitations("Fee is capped [1] and this [9] is fake [1].", reg);
    expect(r.text).toContain("[1]");
    expect(r.text).not.toContain("[9]");
    expect(r.cited).toEqual([1]);
    expect(r.defects).toEqual([9]);
  });

  it("strips every marker when no sources exist", () => {
    const r = scrubCitations("The cap is 1% [1]. Period [2].", new SourceRegistry());
    expect(r.text).toBe("The cap is 1%. Period.");
    expect(r.cited).toEqual([]);
    expect(r.defects).toEqual([1, 2]);
  });
});
