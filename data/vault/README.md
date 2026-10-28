# data/vault

Verified fund fields built by `pnpm vault:build` (phase 60) from `data/sources`.
Each `FundField` carries `{key, value, unit, asOf, doc, page, quote, status}`.
Fields whose quote is not a verbatim substring of the page text are
`quarantined` and never served as answers.
