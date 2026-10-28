---
description: Phase 60 (3h). Layer B starts. Case repo (commits, hash chain), personas, evidence vault, blame.
---
# /60-case-repo-and-vault
Rules in force: 60-domain-guardrails, 31-runtime-prompts-plan, 70.
0. ASK THE HUMAN once: what is the permitted fund universe / hidden-question corpus per organisers? If unknown, pick 10-12 direct-plan funds across categories (liquid, short-duration, index, flexi/large/mid/small, hybrid, gold/debt) from the AMFI scheme master, log the choice in DECISIONS.md.
1. Case schema (zod): `Case{id,persona,facts[],goals[],assumptions[],draft?,gateResults[],status}`; `Fact{key,value,unit,confidence,source:{type:"conversation"|"adviser"|"doc",sentence?,docRef?}}`; `Assumption{key,value,owner,asOf,state:"proposed"|"approved"}`.
2. Commit log: every mutation = `Commit{id, parent, ts, actor, patch, hash}` with `hash = sha256(parent.hash + canonicalJSON(patch))`. SQLite tables. `verifyChain()` utility. Case "state at commit X" reconstructable.
3. `data/personas/*.json`: the 6 personas as SYNTHETIC conversations + facts (no real identifiers).
4. Vault: `data/sources/` originals -> `scripts/vault-build.ts` extracts page text (pdftotext per page) and renders page PNGs (pdftoppm). `data/vault/<fund>.json` holds `FundField{key,value,unit,asOf,doc,page,quote,status:"verified"|"quarantined"}`. Build-time check: quote is a verbatim substring of that page's text AND the value appears inside the quote; otherwise status=quarantined (never served as an answer).
5. `vault_lookup` tool (real): identity lock (AMC+scheme+plan+option+asOf) -> field or `unavailable`; freshness label (current/historical/possibly-superseded). Alias table for renamed schemes.
6. `GET /api/blame?caseId&slot=` -> {value,unit,asOf,doc,page,quote,pageImageUrl,status}.
7. Extractor wiring: `extractor.facts` prompt, substring check on source sentences, facts written as commits. Chat tool `case_get`, `case_add_fact` (adviser-confirmed).
8. Workbench Files in case mode shows `facts.json`, `assumptions.json`, `commits.log` (generated views).
## Verify
Chain verification passes; tampering one byte fails it. Vault build reports N verified / M quarantined. 10 hand questions answer correctly through `vault_lookup` with blame data; an unknown fund/field returns `unavailable`.
## Commit
`feat(case): commit chain, personas, evidence vault, blame`. Next: /70-planner-and-gates
