import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Calendar, computeHolidays, parseOfficialCsv, parseDate, toWareki, iso, fiscalInfo } from '../src/calendar.js';

const official = parseOfficialCsv(readFileSync(new URL('../data/syukujitsu.csv', import.meta.url), 'utf8'));

test('official CSV loads', () => { assert.ok(official.size > 1000); assert.equal(official.get('2026-01-01'), '元日'); });

test('statutory computation matches the official list for 2000-2027', () => {
  const bad = [];
  for (let y = 2000; y <= 2027; y++) {
    const computed = computeHolidays(y), real = new Map([...official].filter(([k]) => k.startsWith(`${y}-`)));
    const a = [...computed.keys()].join(), b = [...real.keys()].join();
    if (a !== b) bad.push(`${y}\n computed ${a}\n official ${b}`);
  }
  assert.deepEqual(bad, []);
});

test('wareki', () => {
  assert.equal(toWareki(parseDate('2026-10-14')).text, '令和8年10月14日');
  assert.equal(toWareki(parseDate('2019-04-30')).text, '平成31年4月30日');
  assert.equal(toWareki(parseDate('2019-05-01')).text, '令和元年5月1日');
  assert.equal(toWareki(parseDate('1989-01-07')).text, '昭和64年1月7日');
  assert.equal(toWareki(parseDate('1873-01-01')).text, '明治6年1月1日');
  assert.equal(toWareki(parseDate('1872-12-31')), null);
});

test('parse', () => {
  for (const [x, want] of [['令和8年10月14日', '2026-10-14'], ['R8.10.14', '2026-10-14'], ['令和元年5月1日', '2019-05-01'],
    ['平成三十一年四月三十日'.replace(/月|日/g, (c) => c), null], ['２０２６／１０／１４', null], ['20261014', '2026-10-14'],
    ['2026/1/5', '2026-01-05'], ['昭和64年1月7日', '1989-01-07'], ['平成31年4月30日', '2019-04-30']]) {
    if (want) assert.equal(iso(parseDate(x)), want, x);
  }
  assert.throws(() => parseDate('2026-02-30'));
  assert.throws(() => parseDate('明日'));
  assert.equal(iso(parseDate('令和十年1月1日')), '2028-01-01');
});

test('business days', () => {
  const cal = new Calendar(official);
  assert.equal(cal.closedReason(parseDate('2026-10-14')), null);           // Wed
  assert.equal(cal.closedReason(parseDate('2026-10-10')), '土曜日');
  assert.equal(cal.closedReason(parseDate('2026-11-03')), '祝日: 文化の日');
  assert.equal(cal.closedReason(parseDate('2026-12-30')), '年末年始');
  assert.equal(new Calendar(official, { closeYearEnd: false }).closedReason(parseDate('2026-12-30')), null);
  assert.equal(iso(cal.addBusinessDays(parseDate('2026-10-30'), 1)), '2026-11-02');
  assert.equal(iso(cal.addBusinessDays(parseDate('2026-10-30'), 2)), '2026-11-04');   // 11/3 holiday
  assert.equal(iso(cal.addBusinessDays(parseDate('2026-11-04'), -2)), '2026-10-30');
  assert.equal(iso(cal.addBusinessDays(parseDate('2026-10-10'), 0)), '2026-10-13');   // Sat, then Mon 10/12 is スポーツの日 -> Tue
});

test('counting and years beyond the official list', () => {
  const cal = new Calendar(official);
  assert.equal(cal.businessDaysBetween(parseDate('2026-10-12'), parseDate('2026-10-19')), 4); // 10/12 is a holiday
  assert.equal(cal.businessDaysBetween(parseDate('2026-10-19'), parseDate('2026-10-12')), -4);
  assert.equal(cal.source(2026), 'official'); assert.equal(cal.source(2040), 'computed');
  assert.equal(cal.holidayName(parseDate('2040-01-01')), '元日');
  assert.deepEqual(fiscalInfo(parseDate('2026-03-31')), { fiscalYear: 2025, fiscalQuarter: 4 });
  assert.deepEqual(fiscalInfo(parseDate('2026-04-01')), { fiscalYear: 2026, fiscalQuarter: 1 });
});
