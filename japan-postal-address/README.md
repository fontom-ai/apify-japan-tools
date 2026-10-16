# Japan Postal Code & Address Normalizer (郵便番号・住所)

**Run it on Apify Store:** https://apify.com/fontom.ai.plus/japan-postal-address

Bulk **postal code → address**, **address → postal code** and **address normalisation** for Japan, built on Japan Post's official `KEN_ALL` data (124,000+ rows), **downloaded fresh on every run** (a bundled snapshot is the fallback if their site is unreachable).

* Handles `〒１００−０００１`, `100 0001`, full-width digits, kanji numerals (`大通西二十丁目`), `ー` used as a hyphen, `大字` prefixes, omitted prefectures, `ヶ/ケ` variants.
* Picks the right code when a town has several (e.g. 札幌市中央区大通西 1–19丁目 vs 20–28丁目) by reading the block number, and says so when it cannot: every address result carries a **confidence**.
* Deterministic, no scraping, no AI guessing, no API keys. Works through the Apify MCP server, so AI agents can validate addresses instead of inventing postal codes.

## Input

* `items`: postal codes and/or addresses (up to 100,000 per run).
* `mode`: `auto` (7 digits = postal code, otherwise address), `zip`, `address`, `normalize`.

## Output

Address → postal code:

```json
{ "input": "北海道札幌市中央区大通西二十丁目", "prefecture": "北海道", "city": "札幌市中央区", "town": "大通西", "block": "20丁目",
  "normalized": "北海道札幌市中央区大通西20丁目", "zip": "064-0820", "confidence": "town", "found": true }
```

`confidence`: `town` (town and block range matched one code) · `city` (only the city-level general code is known) · `ambiguous` (several codes fit: `zip` is `null`, `candidates` lists them) · `none`.

Postal code → address returns every row with that code (some codes cover several towns): prefecture, city, town, notes, JIS city code, katakana readings.

## Pricing

Pay per event: one `result` event per **found** item. Not-found items and input errors are free.

## Measured accuracy and honest limits

* Self-consistency check (Japan Post's own town names + a dummy block number, 16,580 sampled towns): 99.92% exact code, 0.08% reported as ambiguous, 0 wrong. This tests the matching logic, **not** how people actually write addresses: real-world addresses with building names, typos, or old municipality names will do worse, and the `confidence` field tells you when.
* No geocoding (latitude/longitude) and no building-level matching. Large-office codes (個別事業所) are returned for postal code lookups but not guessed from addresses.
* Municipal mergers: the data reflects Japan Post's current list, so old names (e.g. pre-merger 町村) may return `none`.

Source: 日本郵便「郵便番号データダウンロード」(https://www.post.japanpost.jp/zipcode/download.html). Japan Post states it claims no copyright on this data and it may be freely distributed.
