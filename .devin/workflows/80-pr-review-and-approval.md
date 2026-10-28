---
description: Phase 80 (3h). PR page, blame popovers, version-bound approval, domino re-run, client view, receipt/export.
---
# /80-pr-review-and-approval
Rules in force: 50-ui-perplexity-devin, 60-domain-guardrails.
1. `/case/[id]` PR page: header (persona, status, current commit hash short), left = facts diff vs previous commit + assumption panel (owner/date/state), center = draft with number chips + gate results (grouped block/warn/pass, with fix suggestions), right = Workbench (case files).
2. Number chips: click -> blame popover (value, unit, as-of, doc, page, quote, freshness light, page-image crop with quote highlighted). `quarantined` or missing -> chip shows "unavailable" in amber.
3. Domino: editing any fact/assumption creates a commit -> server re-runs gates and re-drafts affected parts -> UI highlights which gates changed -> approval is revoked automatically.
4. Approval: `POST /api/approve` server-side only. `fingerprint = sha256(facts+assumptions+draft+sources+gateResults+policyPack)`. Approval record stores fingerprint, adviser id, time, edits. Client view renders ONLY the approved fingerprint; any later commit makes the client view show "being updated".
5. Client view `/client/[id]`: plain English/Hindi toggle (numbers locked via slots, language only changes prose), disclosures (AI use, plan type, conflicts), 3 teach-back questions (informational, not consent).
6. Decision receipt: generated `receipt.md` + `receipt.json` + `evidence.csv` in the workspace (facts used, assumptions, rejected alternatives with reasons, caveats, gate history, approval fingerprint, AI-use disclosure). One-click export bundle (zip) for the audit trail.
7. Adviser time duel page: stopwatch from persona drop to approved plan, with counters (facts confirmed, gates resolved, edits). Honest: log failures too.
## Verify
Change one fact -> approval revoked, affected gates change colour, client view reverts. Tamper with a stored draft -> fingerprint mismatch blocks release. Blame works for every chip in all 6 personas. Receipt exports and opens.
## Commit
`feat(pr): review page, blame, approval fingerprint, client view, receipts`. Next: /90-policy-packs-and-redteam
