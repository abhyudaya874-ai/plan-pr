import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { PlanCase } from "./index";
import type { ApprovalReceipt } from "./approval";

/**
 * Decision-receipt artifacts written on approval:
 * - receipt.json (machine, written by approve())
 * - receipt.md   (human: facts used, gates, fingerprint, disclosure)
 * - evidence.csv (fact -> value/as-of/blame)
 */

export function writeReceiptArtifacts(caseId: string, c: PlanCase, receipt: ApprovalReceipt): void {
  const dir = path.join(process.cwd(), "data", "cases", caseId);
  const gates: { id: string; name: string; status: string; why?: string[] }[] = existsSync(
    path.join(dir, "gates.json"),
  )
    ? JSON.parse(readFileSync(path.join(dir, "gates.json"), "utf8"))
    : [];
  const draft = existsSync(path.join(dir, "draft.md")) ? readFileSync(path.join(dir, "draft.md"), "utf8") : "";

  // ---- evidence.csv --------------------------------------------------------
  const esc = (s: string) => `"${s.replace(/"/g, '""')}"`;
  const rows = ["fact_key,value,unit,as_of,blame"];
  for (const [k, f] of Object.entries(c.facts).sort()) {
    rows.push(
      [k, esc(String((f as { value?: unknown }).value ?? "")),
        String((f as { unit?: string }).unit ?? ""),
        String((f as { asOf?: string }).asOf ?? ""),
        esc(JSON.stringify((f as { blame?: unknown }).blame ?? null)),
      ].join(","),
    );
  }
  writeFileSync(path.join(dir, "evidence.csv"), rows.join("\n") + "\n");

  // ---- receipt.md ----------------------------------------------------------
  const factLines = Object.entries(c.facts)
    .sort()
    .map(([k, f]) => `- \`${k}\` = **${String((f as { value?: unknown }).value ?? "?")}**`)
    .join("\n");
  const gateLines = gates
    .map((g) => `| ${g.id} | ${g.name} | ${g.status.toUpperCase()} | ${(g.why ?? []).join("; ").slice(0, 120)} |`)
    .join("\n");
  writeFileSync(
    path.join(dir, "receipt.md"),
    `# Decision receipt — ${c.name} (${caseId.slice(0, 8)})

**Approved by:** ${receipt.approvedBy} · **at** ${receipt.at}
**Content fingerprint (sha256):** \`${receipt.contentHash}\`
**Head commit:** #${receipt.headCommit} · **Gates:** ${receipt.gateSummary.green} green / ${receipt.gateSummary.amber} amber / ${receipt.gateSummary.red} red

## Facts used
${factLines || "_none_"}

## Gate results at approval
| id | gate | status | why |
|----|------|--------|-----|
${gateLines}

## Draft (approved version)
\`\`\`
${draft.slice(0, 4000)}
\`\`\`

## Disclosure
${receipt.disclosure}

_Generated at ${receipt.at}; deterministic artifact of data/cases/${caseId}._
`,
  );
}
