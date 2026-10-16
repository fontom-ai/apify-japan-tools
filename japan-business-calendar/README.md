# Japan Business Day & Holiday Calculator (営業日・祝日・和暦)

**Run it on Apify Store:** https://apify.com/fontom.ai.plus/japan-business-calendar

Answers the date questions every Japan-facing workflow keeps getting wrong: **is this a business day, what is the 5th business day after X, how many business days are in this period, what is this date in 和暦, which fiscal year/quarter is it.**

* **Official data.** Holidays come from the Cabinet Office's national holiday list (内閣府「国民の祝日」, 1955–), fetched on every run, so a new year appears without any update from me. For years the official list does not cover yet, holidays are computed from the statute (verified identical to the official list for every year 2000–2027).
* **Deterministic.** Same input, same output. No scraping, no AI guessing, no API keys.
* **Bulk friendly.** Hundreds of questions in one run; one result row per task.
* **AI-agent friendly.** Works through the Apify MCP server, so Claude/Cursor agents can call it instead of guessing Japanese holidays.

## Input

`tasks` is an array of objects:

| `type` | fields | result |
|---|---|---|
| `isBusinessDay` | `date` | open/closed and the reason (土曜日 / 祝日: 文化の日 / 年末年始 / 指定休業日) |
| `addBusinessDays` | `date`, `days` (negative = backwards, `0` = next open day) | the resulting date with full day info |
| `businessDaysBetween` | `from`, `to` | business days in [from, to) |
| `holidays` | `year` (1955–2099) | all national holidays of the year, `source: official | computed` |
| `info` | `date` | weekday, holiday, 和暦, fiscal year/quarter, open/closed |
| `toWareki` / `fromWareki` | `date` / `text` | 令和8年10月14日 ⇄ 2026-10-14 |

Dates: `2026-10-14`, `2026/10/14`, `20261014`, `令和8年10月14日`, `R8.10.14`, `令和元年5月1日`.

Options: `closeYearEnd` (12/29–1/3 closed, default on), `weekendDays` (default Sat+Sun), `extraHolidays` (company closures), `fiscalYearStartMonth` (default April).

```json
{ "tasks": [
  { "type": "addBusinessDays", "date": "2026-10-30", "days": 3 },
  { "type": "toWareki", "date": "2026-10-14" }
] }
```

## Output (example)

```json
{ "ok": true, "from": "2026-10-30", "days": 3,
  "result": { "date": "2026-11-05", "weekday": "木", "isBusinessDay": true, "wareki": "令和8年11月5日", "fiscalYear": 2026, "fiscalQuarter": 3 } }
```

## Pricing

Pay per event: one `result` event per successful task. Invalid tasks return an `ok: false` row and are free.

## Limits, stated plainly

* Dates before 1873-01-01 (lunar-calendar period) are not converted to 和暦 on purpose.
* Business days follow national holidays, weekends and the optional year-end closure. Bank holidays, company calendars, and regional holidays are not known; use `extraHolidays`.
* Computed holidays (years after the official list) follow current law; a future law change will only be reflected once the Cabinet Office publishes it.

Source: 内閣府「国民の祝日について」(https://www8.cao.go.jp/chosei/shukujitsu/gaiyou.html), government standard terms of use. This tool is not legal or financial advice.
