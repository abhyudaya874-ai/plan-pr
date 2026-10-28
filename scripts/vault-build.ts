/**
 * Build the evidence vault: data/vault/funds/<schemeCode>.json per universe
 * fund. AMFI-sourced fields are real; factsheet fields are `unavailable`
 * until extracted text lands in data/sources/factsheets/<amc-slug>.txt.
 * Every field carries blame {doc|url, quote, retrievedAt} or says unavailable.
 *   pnpm vault:build
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { z } from "zod";
import {
  FACTSHEET_FIELDS,
  norm,
  vaultFundSchema,
  type FieldValue,
} from "../src/lib/vault";

const universeSchema = z.object({
  source: z.object({ doc: z.string(), url: z.string(), retrievedAt: z.string() }),
  funds: z.array(
    z.object({
      schemeCode: z.string(),
      amfiName: z.string(),
      amc: z.string(),
      category: z.string(),
      personaUse: z.string(),
      nav: z.number(),
      navDate: z.string(),
    }),
  ),
});

const ROOT = process.cwd();
const UNIVERSE = path.join(ROOT, "data/vault/universe.json");
const OUT_DIR = path.join(ROOT, "data/vault/funds");
const FACTSHEET_DIR = path.join(ROOT, "data/sources/factsheets");

const amfiSrc = (retrievedAt: string, url: string, doc: string) => ({
  doc,
  url,
  retrievedAt,
});

const ok = (value: string | number, source: FieldValue["source"], unit?: string): FieldValue => ({
  status: "ok",
  value,
  ...(unit ? { unit } : {}),
  ...(source ? { source } : {}),
});

const na = (reason: string): FieldValue => ({ status: "unavailable", reason });

/** Best-effort factsheet text extraction -> blame-able fields (quote kept). */
function extractFromText(text: string, amcName: string, retrieved: string): Record<string, FieldValue> {
  const src = { doc: `factsheets/${amcName}.txt`, retrievedAt: retrieved };
  const grab = (re: RegExp, field: string, unit?: string): FieldValue => {
    const m = re.exec(text);
    if (!m) return na(`not found in ${amcName} factsheet text`);
    const raw = m[1]!.trim();
    const num = /^\d+(\.\d+)?%?$/.test(raw) ? Number(raw.replace("%", "")) : raw;
    const quote = m[0].replace(/\s+/g, " ").slice(0, 180);
    return { status: "ok", value: num, ...(unit ? { unit } : {}), source: { ...src, quote } };
  };
  void grab;
  const fields: Record<string, FieldValue> = {};
  const ter = /expense ratio[^\d%]*?(\d+(?:\.\d+)?)\s*%/i.exec(text);
  fields["expense_ratio_direct"] = ter
    ? { status: "ok", value: Number(ter[1]), unit: "%", source: { ...src, quote: ter[0].slice(0, 180) } }
    : na("expense ratio not found in factsheet text");
  const load = /exit load[^\d%]*?(\d+(?:\.\d+)?)\s*%|exit load[: ]+(nil)/i.exec(text);
  fields["exit_load"] = load
    ? { status: "ok", value: load[1] === undefined ? "nil" : Number(load[1]), source: { ...src, quote: load[0].slice(0, 180) } }
    : na("exit load not found in factsheet text");
  const aum = /(?:fund size|aum|average aum)[^\d]*?([\d,]+(?:\.\d+)?)\s*(?:cr|crore)/i.exec(text);
  fields["aum"] = aum
    ? { status: "ok", value: Number(aum[1]!.replace(/,/g, "")), unit: "INR crore", source: { ...src, quote: aum[0].slice(0, 180) } }
    : na("AUM not found in factsheet text");
  const bench = /benchmark[: ]+([^\n]{3,60})/i.exec(text);
  fields["benchmark"] = bench
    ? { status: "ok", value: bench[1]!.trim(), source: { ...src, quote: bench[0].slice(0, 180) } }
    : na("benchmark not found in factsheet text");
  const mgr = /fund manager[s]?[: ]+([^\n]{3,80})/i.exec(text);
  fields["fund_manager"] = mgr
    ? { status: "ok", value: mgr[1]!.trim(), source: { ...src, quote: mgr[0].slice(0, 180) } }
    : na("fund manager not found in factsheet text");
  const risk = /riskometer[^\n]{0,40}?(low to moderate|moderately low|moderate|moderately high|very high|high|low)/i.exec(text);
  fields["riskometer"] = risk
    ? { status: "ok", value: risk[1]!.toLowerCase(), source: { ...src, quote: risk[0].slice(0, 180) } }
    : na("riskometer not found in factsheet text");
  const inc = /inception[^\d]*(\d{1,2}[-/ ](?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*[-/ ]\d{2,4}|\d{1,2}[-/]\d{1,2}[-/]\d{2,4}|\d{4})/i.exec(text);
  fields["inception_date"] = inc
    ? { status: "ok", value: inc[1]!.trim(), source: { ...src, quote: inc[0].slice(0, 180) } }
    : na("inception date not found in factsheet text");
  return fields;
}

async function main() {
  const universe = universeSchema.parse(
    JSON.parse(readFileSync(UNIVERSE, "utf8")),
  );
  mkdirSync(OUT_DIR, { recursive: true });

  const fsTexts = new Map<string, string>();
  if (existsSync(FACTSHEET_DIR)) {
    for (const f of readdirSync(FACTSHEET_DIR)) {
      if (f.endsWith(".txt")) {
        fsTexts.set(f.replace(/\.txt$/, ""), readFileSync(path.join(FACTSHEET_DIR, f), "utf8"));
      }
    }
  }

  const retrieved = universe.source.retrievedAt;
  let written = 0;
  const missing: string[] = [];
  for (const f of universe.funds) {
    const src = amfiSrc(retrieved, universe.source.url, universe.source.doc);
    const fields: Record<string, FieldValue> = {
      scheme_code: ok(f.schemeCode, src),
      amc: ok(f.amc, src),
      scheme_name: ok(f.amfiName, src),
      plan: ok("Direct Plan", src),
      option: ok("Growth", src),
      category: ok(f.category, src),
      nav: ok(f.nav, src, "INR"),
      nav_date: ok(f.navDate, src),
      persona_use: ok(f.personaUse, src),
    };
    // factsheet-derived fields: unavailable until text exists
    const slug = norm(f.amc).split(" ").slice(0, 2).join("-");
    const fsText = fsTexts.get(slug) ?? fsTexts.get(norm(f.amc).split(" ")[0]!);
    if (fsText) {
      Object.assign(fields, extractFromText(fsText, slug, retrieved));
    }
    for (const fld of FACTSHEET_FIELDS) {
      fields[fld] ??= na("factsheet not yet ingested (drop text in data/sources/factsheets/)");
    }
    fields["returns_1y"] ??= na("factsheet not yet ingested");
    fields["returns_3y"] ??= na("factsheet not yet ingested");
    fields["returns_5y"] ??= na("factsheet not yet ingested");
    fields["returns_si"] ??= na("factsheet not yet ingested");
    fields["sid_url"] ??= na("pending");
    fields["factsheet_url"] ??= na("pending");

    const entry = vaultFundSchema.parse({
      schema: "vault_fund_v1",
      schemeCode: f.schemeCode,
      identity: {
        amc: f.amc,
        scheme: f.amfiName,
        plan: "Direct Plan",
        option: "Growth",
        amfiName: f.amfiName,
        matchedBy: "amfi_navall",
        matchedAt: retrieved,
      },
      category: f.category,
      fields,
      freshness: { builtAt: new Date().toISOString(), note: "AMFI navall + factsheet text if present" },
    });
    writeFileSync(
      path.join(OUT_DIR, `${f.schemeCode}.json`),
      JSON.stringify(entry, null, 2) + "\n",
    );
    written++;
    const missingFields = FACTSHEET_FIELDS.filter((x) => fields[x]?.status !== "ok");
    if (missingFields.length) missing.push(`${f.schemeCode} ${f.amfiName}: ${missingFields.length} fields unavailable`);
  }
  console.log(`[vault] wrote ${written} funds -> data/vault/funds/`);
  missing.forEach((m) => console.log(`[vault]   ${m}`));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
