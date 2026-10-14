import { Actor } from 'apify';
import { readFileSync } from 'node:fs';
import { Calendar, WEEKDAYS, parseDate, parseOfficialCsv, toWareki, fiscalInfo, iso } from './calendar.js';

const OFFICIAL_URL = 'https://www8.cao.go.jp/chosei/shukujitsu/syukujitsu.csv';
const SNAPSHOT = new URL('../data/syukujitsu.csv', import.meta.url);

/** Official Cabinet Office list: fetched live (so new years appear without a rebuild), bundled snapshot as fallback. */
async function loadOfficial() {
  try {
    const res = await fetch(OFFICIAL_URL, { signal: AbortSignal.timeout(15000) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const map = parseOfficialCsv(new TextDecoder('shift_jis').decode(await res.arrayBuffer()));
    if (map.size > 900) return { map, source: 'live' };
  } catch (e) { console.warn(`Cabinet Office list not reachable (${e.message}); using the bundled snapshot.`); }
  return { map: parseOfficialCsv(readFileSync(SNAPSHOT, 'utf8')), source: 'snapshot' };
}

const dayInfo = (cal, dt) => {
  const w = toWareki(dt), reason = cal.closedReason(dt);
  return { date: iso(dt), weekday: WEEKDAYS[dt.getUTCDay()], isBusinessDay: reason === null, closedReason: reason,
    holiday: cal.holidayName(dt), wareki: w?.text ?? null, ...fiscalInfo(dt, cal.fiscalStart) };
};

export function runTask(cal, task) {
  const type = String(task?.type ?? '');
  switch (type) {
    case 'info': return dayInfo(cal, parseDate(task.date));
    case 'isBusinessDay': { const d = dayInfo(cal, parseDate(task.date)); return { date: d.date, weekday: d.weekday, isBusinessDay: d.isBusinessDay, closedReason: d.closedReason }; }
    case 'addBusinessDays': {
      const from = parseDate(task.date), days = Number(task.days);
      if (!Number.isInteger(days)) throw new Error('days は整数で指定してください');
      return { from: iso(from), days, result: dayInfo(cal, cal.addBusinessDays(from, days)) };
    }
    case 'businessDaysBetween': {
      const a = parseDate(task.from), b = parseDate(task.to);
      return { from: iso(a), to: iso(b), businessDays: cal.businessDaysBetween(a, b), note: '開始日を含み、終了日を含まない' };
    }
    case 'holidays': {
      const y = Number(task.year);
      if (!Number.isInteger(y) || y < 1955 || y > 2099) throw new Error('year は 1955〜2099 で指定してください');
      return { year: y, source: cal.source(y), holidays: [...cal.holidaysOfYear(y)].map(([date, name]) => ({ date, weekday: WEEKDAYS[parseDate(date).getUTCDay()], name })) };
    }
    case 'toWareki': { const dt = parseDate(task.date); const w = toWareki(dt); if (!w) throw new Error('1873年1月1日より前（旧暦の時代）は変換しません'); return { date: iso(dt), ...w }; }
    case 'fromWareki': { const dt = parseDate(task.text); return { text: task.text, date: iso(dt), weekday: WEEKDAYS[dt.getUTCDay()] }; }
    default: throw new Error(`type が不正です: ${JSON.stringify(type)}（info / isBusinessDay / addBusinessDays / businessDaysBetween / holidays / toWareki / fromWareki）`);
  }
}

await Actor.init();
const input = (await Actor.getInput()) ?? {};
const tasks = Array.isArray(input.tasks) ? input.tasks : [];
if (!tasks.length) { await Actor.fail('tasks が空です。例: [{"type":"addBusinessDays","date":"2026-10-30","days":3}]'); }
else {
  const { map, source } = await loadOfficial();
  const cal = new Calendar(map, { closeYearEnd: input.closeYearEnd ?? true, weekendDays: input.weekendDays, extraHolidays: input.extraHolidays });
  cal.fiscalStart = Number(input.fiscalYearStartMonth ?? 4);
  console.log(`Official holiday list: ${source} (${map.size} days, ${[...cal.officialYears].sort()[0]}–${[...cal.officialYears].sort().at(-1)}). Years outside it are computed from the statute.`);
  for (const [i, task] of tasks.entries()) {
    let item;
    try { item = { ok: true, task, ...runTask(cal, task) }; }
    catch (e) { await Actor.pushData({ ok: false, task, error: e.message }); continue; } // errors are free
    const r = await Actor.pushData(item, 'result');
    if (r?.eventChargeLimitReached) { console.warn(`Spending limit reached after ${i + 1} tasks; stopping.`); break; }
  }
}
await Actor.exit();
