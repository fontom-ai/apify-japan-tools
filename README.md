# Japan data tools for Apify (and AI agents)

Small, deterministic tools built on official Japanese public data. No scraping, no AI guessing.

| Actor | What it does |
|---|---|
| [japan-business-calendar](japan-business-calendar) | Business days, national holidays (Cabinet Office), 和暦 ⇄ 西暦, fiscal year |
| [japan-postal-address](japan-postal-address) | Postal code ⇄ address, address normalisation (Japan Post KEN_ALL, refreshed every run) |
| [egov-law-text](egov-law-text) | Exact statute article text by name (e-Gov Law API), with point-in-time versions |

Each folder is a self-contained Apify Actor (`.actor/`, `Dockerfile`, tests: `npm test`). MIT licensed.
