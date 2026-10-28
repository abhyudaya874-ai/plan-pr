# Plan PR: Devin config pack

Drop the `.devin/` folder into the repo root (empty repo is fine).

## Rules (`.devin/rules/`)
| file | trigger | what it does |
|---|---|---|
| 00-mission | always | project, judged metrics, invariants I1-I7 |
| 05-operating-protocol | always | plan-first, docs-before-code, phase gates, no fakes, failure loop |
| 10-stack-and-structure | always | stack, folders, env, scripts |
| 20-model-gateway | glob | OpenRouter/Groq/NIM, live probe, latency router, hedging, tool-call repair |
| 30-runtime-prompts-chat | glob | the app's system prompt, typo/Hinglish handling, tool + citation policy, PS bridge |
| 31-runtime-prompts-plan | glob | extractor, slot drafter, checkers, English->rule compiler |
| 40-tools-and-workspace | glob | tools, source registry, SSE event protocol, sandboxed files |
| 50-ui-perplexity-devin | glob | Perplexity-style answers + Devin-style workbench spec |
| 60-domain-guardrails | always | SEBI/RIA + suitability constraints |
| 70-quality-and-repro | always | tests, repro, security checklist |

## Workflows (run in order, each ends with a Verify gate)
`/00-bootstrap` -> `/10-model-gateway` -> `/20-chat-core` -> `/prompt-evals` -> `/30-research-and-citations` -> `/40-workbench-files` -> `/50-ui-shell` (Layer A done, tag v0-base) -> `/60-case-repo-and-vault` -> `/70-planner-and-gates` -> `/80-pr-review-and-approval` -> `/90-policy-packs-and-redteam` -> `/95-eval-and-submission`. Run `/verify` after every phase.

## Budget (solo, ~24h incl. sleep/buffer)
00 0.75h | 10 2h | 20 2h | 30 1.5h | 40 1.5h | 50 2.5h | 60 3h | 70 4h | 80 3h | 90 3h | 95 3h

## Kickoff prompt (paste into Devin once)
```
Read every file in .devin/rules/ and .devin/workflows/. You are building Plan PR for a 24-hour hackathon, solo user. Run /00-bootstrap now. After each workflow: run /verify, update PROGRESS.md with real command output, then continue to the next workflow without asking unless a rule says to ask. Never code an external API from memory; read current docs first. Stop and tell me only for: missing API keys, the fund-universe question in /60, or a blocker you cannot resolve after 3 attempts.
```

## Notes
- Frontmatter uses `trigger: always_on | glob | model_decision`. If your Devin build ignores it, the files still work as plain instructions; just keep 00, 05, 10, 60, 70 pinned.
- Model IDs are intentionally NOT hardcoded: `/10` discovers them live and probes tools/latency.
- Add keys to `.env`: OPENROUTER_API_KEY, GROQ_API_KEY, NVIDIA_API_KEY, TAVILY_API_KEY.
