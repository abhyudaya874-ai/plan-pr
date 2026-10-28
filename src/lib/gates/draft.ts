/**
 * Slot drafter + numeric linter (invariant I1 + I3).
 * - Templates use {{slot.path}}; filled ONLY from deterministic values.
 * - lint() fails on raw digits not present in the slot-value allowlist, and on
 *   banned return-guarantee phrases in ANY language.
 */

export interface SlotValue {
  path: string;
  text: string;
}

export const BANNED_PHRASES = [
  /guaranteed?\s+(returns?|income|profit|growth|interest|yield)/i,
  /assured\s+(returns?|income|profit)/i,
  /risk[\s-]?free\s+(returns?|investment|fund|plan)/i,
  /fixed\s+returns?\s+(of|at|guaranteed)/i,
  /\bno\s+risk\b/i,
  /\bपक्का\s+(रिटर्न|मुनाफ़ा)/,
  /\bगारंटी[\u0923-\u097F]*\s*(रिटर्न|कमाई)/,
  /\bnischit\s+return/i,
  /\bpakka\s+(return|munafa|kamai)/i,
  /\bguarantee(d)?\s+\d+%/i,
  /\b\d+%\s*(guaranteed|assured|fixed)/i,
];

export interface LintResult {
  ok: boolean;
  rawDigits: string[];
  bannedHits: string[];
}

/** Fill {{slot}} placeholders. Unfilled slots are left visibly as {{x}}. */
export function fillSlots(template: string, values: SlotValue[]): string {
  const map = new Map(values.map((v) => [v.path, v.text]));
  return template.replace(/\{\{\s*([\w.]+)\s*\}\}/g, (m, path: string) =>
    map.has(path) ? map.get(path)! : m,
  );
}

const DIGIT_RE = /\d[\d,]*(?:\.\d+)?%?/g;

/**
 * Numeric lint: every digit token in the rendered text must appear among the
 * injected slot values (so LLM can't sneak in a number). Common benign digits
 * (years 19xx/20xx dates already in slots are covered by the allowlist).
 */
export function lintNumbers(rendered: string, values: SlotValue[]): LintResult {
  const allowed = new Set<string>();
  for (const v of values) {
    for (const m of v.text.matchAll(DIGIT_RE)) allowed.add(normalizeNum(m[0]));
  }
  const rawDigits: string[] = [];
  for (const m of rendered.matchAll(DIGIT_RE)) {
    const n = normalizeNum(m[0]);
    if (!allowed.has(n)) rawDigits.push(m[0]);
  }
  const bannedHits = BANNED_PHRASES.filter((p) => p.test(rendered)).map((p) => p.source.slice(0, 40));
  return { ok: rawDigits.length === 0 && bannedHits.length === 0, rawDigits, bannedHits };
}

const normalizeNum = (s: string) => s.replace(/,/g, "").replace(/%$/, "");

/** Draft template (rule 31 draft.a shape, slots only). */
export const DRAFT_A = `Plan for {{client.name}} ({{client.age}}, {{client.city}})

This is an illustrative, adviser-reviewed plan — not a return promise. All figures come from verified fields or deterministic math.

Emergency readiness
- Target buffer: {{plan.emergency_target}} ({{plan.buffer_months}} months of essentials {{plan.essentials_monthly}})
- Current buffer: {{plan.current_buffer}} → gap {{plan.emergency_gap}}

Goals
{{goals.table}}

Suggested funds (direct plans only)
{{funds.table}}

Assumptions (editable, illustrative)
- Inflation: {{assumptions.inflation}}
- Conservative: {{assumptions.conservative}} | Balanced: {{assumptions.balanced}} | Equity: {{assumptions.equity}}

Disclosure: direct plans; AI-assisted drafting reviewed by a SEBI-registered adviser; projections are illustrative, not guaranteed.`;
