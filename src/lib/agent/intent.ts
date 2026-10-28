import { distance } from "fastest-levenshtein";
import { z } from "zod";

export type ChatRoute = "chat" | "research" | "reason";
export type LanguageHint = "en" | "hinglish" | "hi";

export interface IntentResult {
  route: ChatRoute;
  /** Heuristic confidence 0-1; <0.6 triggers the LLM classifier fallback. */
  confidence: number;
  needsTools: boolean;
  languageHint: LanguageHint;
  signals: string[];
  normalized: string;
  source: "heuristic" | "classifier";
}

/** Lowercase, collapse whitespace, strip repeated chars (>2). Original kept for the model. */
export function normalizeForRouting(text: string): string {
  return text
    .toLowerCase()
    .replace(/(\S)\1{2,}/g, "$1$1") // "soooo" -> "soo"
    .replace(/\s+/g, " ")
    .trim();
}

const LEXICON = [
  "sebi", "amfi", "sip", "nav", "ter", "elss", "swp", "ria", "rta", "nfo",
  "expense ratio", "exit load", "direct plan", "regular plan", "small cap",
  "f&o", "fno", "circular", "factsheet", "sid", "mutual fund", "mutual",
  "equity", "debt fund", "liquid fund", "index fund", "flexi cap",
  "corpus", "retirement", "inflation", "emi", "kyc", "adviser", "aadhaar",
];

function fuzzyHit(token: string, term: string): boolean {
  if (!term.includes(" ")) {
    const d = distance(token, term);
    if (term.length <= 3) return d === 0;
    if (term.length <= 5) return d <= 1;
    return d <= 2;
  }
  return false;
}

const TIME_WORDS =
  /\b(today|latest|current|currently|now|right now|rn|abhi|aaj|kal|recent|recently|news|update|this (week|month|year))\b/;
const RESEARCH_TERMS =
  /\b(circular|regulation|regulations|rule|rules|fee|fees|tax|taxes|weather|price|rate|rates|limit|limits|deadline|rbi|guideline|guidelines|notification)\b/;
const REASON_TERMS =
  /\b(plan|planning|draft|explain|compare|comparison|difference|diff|vs|versus|batao|samjha|kaise|portfolio|goal|goals|suitab|suitable|strategy|allocate|allocation|review)\b/;
const FILE_WORDS =
  /\b(save|export|download|write|file|csv|zip|notes|report|json|table)\b/;
const GREETING =
  /^(hi+|hello+|hey+|yo|namaste|namaskar|wass?up|sup|good (morning|evening|afternoon|night)|thanks|thank you|thx|ok+|okay|bye+|gn)\b[\s!.,?]*$/;
const TRIVIAL_MATH =
  /^[\s\d+\-*/().,%^=x?]*(?:what|whts|whats|kitna|batao|is|=|\?)?[\s\d+\-*/().,%^=x?]*$/;

function detectLanguage(original: string, normalized: string): LanguageHint {
  if (/[\u0900-\u097F]/.test(original)) return "hi";
  const hinglish =
    /\b(kya|hai|hain|mein|ka|ki|ke|nahi|nahin|batao|chahiye|matlab|bolo|dono|paisa|paise|saal|kitna|kitne|lagega|hota|karna|karo|lena|dunga|dunga|karein|aapka|mera|tera|wala|vala|bhi|aur|yaar|accha|theek)\b/;
  return hinglish.test(normalized) ? "hinglish" : "en";
}

/**
 * Code-first routing (rule 30): normalize, lexicon, heuristics.
 * The classifier fallback is applied by the caller when confidence < 0.6.
 */
export function routeByHeuristics(text: string): IntentResult {
  const normalized = normalizeForRouting(text);
  const tokens = normalized.split(" ");
  const signals: string[] = [];
  const languageHint = detectLanguage(text, normalized);

  const domainHits = LEXICON.filter(
    (t) =>
      (t.includes(" ") && normalized.includes(t)) ||
      tokens.some((tok) => fuzzyHit(tok, t)),
  );
  if (domainHits.length) signals.push(`domain:${domainHits.slice(0, 4).join("|")}`);

  const isTime = TIME_WORDS.test(normalized);
  const isResearchTerm = RESEARCH_TERMS.test(normalized);
  const isReasonTerm = REASON_TERMS.test(normalized);
  const wantsFile = FILE_WORDS.test(normalized);
  const isGreeting = GREETING.test(normalized);
  const isTrivialMath = TRIVIAL_MATH.test(normalized) && /\d\s*[+\-*/x^=]/.test(normalized);

  const scores: Record<ChatRoute, number> = { chat: 0, research: 0, reason: 0 };

  if (isGreeting) {
    scores.chat += 1.0;
    signals.push("greeting");
  }
  if (isTrivialMath) {
    scores.chat += 0.85;
    signals.push("trivial-math");
  }
  if (isTime) {
    scores.research += 0.45;
    signals.push("time-words");
  }
  if (isResearchTerm) {
    scores.research += 0.4;
    signals.push("research-terms");
  }
  if (domainHits.length) {
    scores.research += Math.min(0.3, domainHits.length * 0.1);
    scores.reason += 0.15;
  }
  if (isReasonTerm) {
    scores.reason += 0.5;
    signals.push("reason-terms");
  }
  if (wantsFile) {
    scores.research += 0.15;
    signals.push("file-words");
  }
  scores.chat += normalized.length < 12 ? 0.2 : 0; // very short msgs lean chat

  const ordered = (Object.entries(scores) as [ChatRoute, number][]).sort(
    (a, b) => b[1] - a[1],
  );
  const [route, top] = ordered[0]!;
  const second = ordered[1]![1];
  const confidence =
    top <= 0 ? 0.1 : Math.min(0.95, 0.45 + top * 0.5 + (top - second) * 0.3);

  return {
    route,
    confidence,
    needsTools: route === "research" || wantsFile,
    languageHint,
    signals,
    normalized,
    source: "heuristic",
  };
}

export const classifierOutSchema = z.object({
  route: z.enum(["chat", "research", "reason"]),
  needs_tools: z.boolean(),
  language: z.enum(["en", "hinglish", "hi"]),
  confidence: z.number().min(0).max(1),
});

/** Runner signature: send a classifier prompt, return raw text. Injected. */
export type ClassifierRunner = (prompt: string) => Promise<string>;

/** LLM fallback — only when heuristic confidence < 0.6. */
export async function classifyWithLlm(
  text: string,
  run: ClassifierRunner,
): Promise<IntentResult | null> {
  const prompt = `Classify the user's message. Users make typos and mix English/Hindi; infer intent anyway.
Return ONLY JSON: {"route":"chat"|"research"|"reason","needs_tools":boolean,"language":"en"|"hinglish"|"hi","confidence":0-1}
chat = greetings, trivial maths, small talk. research = needs fresh or sourced facts. reason = planning, drafting, comparing, explaining.
Message: <<<${text}>>>`;
  try {
    const raw = (await run(prompt)).trim();
    const m = /\{[\s\S]*\}/.exec(raw);
    if (!m) return null;
    const parsed = classifierOutSchema.safeParse(JSON.parse(m[0]));
    if (!parsed.success) return null;
    const d = parsed.data;
    return {
      route: d.route,
      confidence: d.confidence,
      needsTools: d.needs_tools,
      languageHint: d.language,
      signals: ["llm-classifier"],
      normalized: normalizeForRouting(text),
      source: "classifier",
    };
  } catch {
    return null;
  }
}
