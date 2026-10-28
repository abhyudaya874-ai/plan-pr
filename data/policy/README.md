# data/policy

Regulatory/policy values (SEBI, AMFI, tax, fee caps). No value is hardcoded
from memory anywhere in the codebase; each entry is
`{value, source_url, source_page, effective_date, retrieved_at}`. Unverified
paths return `unavailable` and the gate says "needs adviser check".
