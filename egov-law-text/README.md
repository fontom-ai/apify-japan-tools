# Japanese Law Article Text (e-Gov 法令・条文取得)

**Run it on Apify Store:** https://apify.com/fontom.ai.plus/egov-law-text

**Quote the law, don't recall it.** Give a law name and an article number (`民法第709条`, `個人情報保護法第27条`, `労働基準法第36条`) and get the **exact current article text** from the government's e-Gov Law API, with the law's number, enforcement date and a link to the official page.

* **Point-in-time versions.** Set `asOf` to a date and get the text that was in force then (e.g. 民法第4条 on 2019-01-01 says 二十歳; today it says 十八歳).
* **Flexible queries.** Kanji or Arabic numerals, branch articles (`第90条の2`), paragraphs (`第415条第2項`), official abbreviations (`個人情報保護法`). A query with only a law name returns the list of articles.
* **Honest misses.** Ambiguous law names return candidates instead of a guess; missing articles say so (a miss is a result row and is charged like any other).
* **For AI agents.** Available through the Apify MCP server, so an agent can fetch the real wording before answering a legal-text question instead of hallucinating it.

## Input

* `queries`: list of strings such as `民法第709条`.
* `asOf` (optional): `YYYY-MM-DD`.

## Output (example)

```json
{ "query": "民法第709条", "found": true,
  "law": { "title": "民法", "lawNum": "明治二十九年法律第八十九号", "enforcementDate": "2026-06-24", "url": "https://laws.e-gov.go.jp/law/129AC0000000089" },
  "article": { "articleTitle": "第七百九条", "caption": "（不法行為による損害賠償）",
               "text": "第七百九条　（不法行為による損害賠償）\n故意又は過失によって他人の権利又は法律上保護される利益を侵害した者は、これによって生じた損害を賠償する責任を負う。" },
  "notice": "出典: e-Gov法令検索（デジタル庁）…" }
```

## Pricing

Pay per event: $0.01 per result row written to the dataset (`apify-default-dataset-item`). **Every row is charged, including not-found rows**, so check names before bulk runs (ambiguous names return candidates, also one row).

## Limits

* Statutes, cabinet orders and ministerial ordinances available in e-Gov only; no court decisions, no local ordinances (条例), no commentary.
* Text is flattened to plain text (items, sub-items and tables become indented lines; complex tables lose their layout). The `law.url` always points to the authoritative rendering.
* This is a text-retrieval tool, **not legal advice**. Verify anything important on e-Gov.

Source: e-Gov法令検索 / 法令API (デジタル庁), government standard terms of use (https://laws.e-gov.go.jp/apitop/).
