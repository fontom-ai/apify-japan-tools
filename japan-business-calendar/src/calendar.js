// Pure date logic for Japanese business calendars. No I/O: the official holiday list is passed in.
// Dates are handled as UTC midnights so the machine's time zone can never shift a result.

export const WEEKDAYS = ['日', '月', '火', '水', '木', '金', '土'];

const ERAS = [ // first day (Gregorian) of each era; the Gregorian calendar has been official since 1873-01-01
  { name: '令和', romaji: 'R', start: [2019, 5, 1] },
  { name: '平成', romaji: 'H', start: [1989, 1, 8] },
  { name: '昭和', romaji: 'S', start: [1926, 12, 25] },
  { name: '大正', romaji: 'T', start: [1912, 7, 30] },
  { name: '明治', romaji: 'M', start: [1873, 1, 1], firstYear: 6 },
];

const utc = (y, m, d) => new Date(Date.UTC(y, m - 1, d));
export const iso = (dt) => dt.toISOString().slice(0, 10);
export const addDays = (dt, n) => new Date(dt.getTime() + n * 86400000);

const toHalf = (s) => s.replace(/[０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0));
const KAN = { 元: 1, 〇: 0, 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9 };
function kanjiNumber(s) { // 二十三 -> 23, 十 -> 10, 元 -> 1, 8 -> 8
  if (/^[0-9]+$/.test(s)) return Number(s);
  const i = s.indexOf('十');
  if (i < 0) return s.length === 1 && s in KAN ? KAN[s] : NaN;
  const tens = i === 0 ? 1 : KAN[s.slice(0, i)];
  const ones = i === s.length - 1 ? 0 : KAN[s.slice(i + 1)];
  return tens === undefined || ones === undefined || s.length - i > 2 ? NaN : tens * 10 + ones;
}

/** "2026-10-14", "2026/10/4", "20261014", "令和8年10月14日", "R8.10.14", "令和元年5月1日" -> Date (UTC) or throws. */
export function parseDate(input) {
  if (input instanceof Date) return input;
  const s = toHalf(String(input ?? '').trim());
  let m = s.match(/^(\d{4})[-/.年](\d{1,2})[-/.月](\d{1,2})日?$/) || s.match(/^(\d{4})(\d{2})(\d{2})$/);
  let y, mo, d;
  if (m) [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  else {
    m = s.match(/^(明治|大正|昭和|平成|令和|[MTSHR])\s*(元|[0-9一二三四五六七八九十〇]+)[年.\-/]\s*(\d{1,2})[月.\-/]\s*(\d{1,2})日?$/i);
    if (!m) throw new Error(`日付を解釈できません: ${JSON.stringify(input)}`);
    const era = ERAS.find((e) => e.name === m[1] || e.romaji === m[1].toUpperCase());
    const ey = kanjiNumber(m[2]);
    if (!Number.isFinite(ey) || ey < 1) throw new Error(`年を解釈できません: ${JSON.stringify(input)}`);
    [y, mo, d] = [era.start[0] + ey - 1 - (era.firstYear ? era.firstYear - 1 : 0), Number(m[3]), Number(m[4])];
  }
  const dt = utc(y, mo, d);
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== mo - 1 || dt.getUTCDate() !== d) {
    throw new Error(`存在しない日付です: ${JSON.stringify(input)}`);
  }
  return dt;
}

export function toWareki(dt) {
  const y = dt.getUTCFullYear(), key = y * 10000 + (dt.getUTCMonth() + 1) * 100 + dt.getUTCDate();
  for (const e of ERAS) {
    if (key >= e.start[0] * 10000 + e.start[1] * 100 + e.start[2]) {
      const n = y - e.start[0] + 1 + (e.firstYear ? e.firstYear - 1 : 0);
      return { era: e.name, eraRomaji: e.romaji, year: n,
        text: `${e.name}${n === 1 ? '元' : n}年${dt.getUTCMonth() + 1}月${dt.getUTCDate()}日`,
        short: `${e.romaji}${n}.${dt.getUTCMonth() + 1}.${dt.getUTCDate()}` };
    }
  }
  return null; // before 1873-01-01 (lunar calendar period): not converted on purpose
}

/** Fiscal year starting in `startMonth` (Japan's default is April). */
export function fiscalInfo(dt, startMonth = 4) {
  const y = dt.getUTCFullYear(), m = dt.getUTCMonth() + 1;
  const fy = m >= startMonth ? y : y - 1;
  const quarter = Math.floor((((m - startMonth) % 12) + 12) % 12 / 3) + 1;
  return { fiscalYear: fy, fiscalQuarter: quarter };
}

// ---- holidays by statute (used where the official Cabinet Office list does not reach)

const nthMonday = (y, m, n) => { const first = utc(y, m, 1).getUTCDay(); return 1 + ((8 - first) % 7) + (n - 1) * 7; };
const spring = (y) => Math.floor(20.8431 + 0.242194 * (y - 1980) - Math.floor((y - 1980) / 4));
const autumn = (y) => Math.floor(23.2488 + 0.242194 * (y - 1980) - Math.floor((y - 1980) / 4));

/** National holidays of one year per the current statute (accurate 1980-2099). Returns Map<'YYYY-MM-DD', name>. */
export function computeHolidays(y) {
  const h = new Map();
  const add = (m, d, name) => h.set(iso(utc(y, m, d)), name);
  add(1, 1, '元日');
  if (y >= 2000) add(1, nthMonday(y, 1, 2), '成人の日'); else add(1, 15, '成人の日');
  if (y >= 1967) add(2, 11, '建国記念の日');
  if (y >= 2020) add(2, 23, '天皇誕生日');
  if (y >= 1989 && y <= 2018) add(12, 23, '天皇誕生日');
  if (y < 1989) add(4, 29, '天皇誕生日');
  add(3, spring(y), '春分の日');
  if (y >= 2007) add(4, 29, '昭和の日'); else if (y >= 1989) add(4, 29, 'みどりの日');
  add(5, 3, '憲法記念日');
  if (y >= 2007) add(5, 4, 'みどりの日');
  add(5, 5, 'こどもの日');
  if (y === 2020) add(7, 23, '海の日'); else if (y === 2021) add(7, 22, '海の日');
  else if (y >= 2003) add(7, nthMonday(y, 7, 3), '海の日'); else if (y >= 1996) add(7, 20, '海の日');
  if (y === 2020) add(8, 10, '山の日'); else if (y === 2021) add(8, 8, '山の日'); else if (y >= 2016) add(8, 11, '山の日');
  if (y >= 2003) add(9, nthMonday(y, 9, 3), '敬老の日'); else add(9, 15, '敬老の日');
  add(9, autumn(y), '秋分の日');
  if (y === 2020) add(7, 24, 'スポーツの日'); else if (y === 2021) add(7, 23, 'スポーツの日');
  else if (y >= 2022) add(10, nthMonday(y, 10, 2), 'スポーツの日');
  else if (y >= 2000) add(10, nthMonday(y, 10, 2), '体育の日'); else add(10, 10, '体育の日');
  add(11, 3, '文化の日');
  add(11, 23, '勤労感謝の日');
  if (y === 2019) { add(5, 1, '休日（天皇の即位の日）'); add(10, 22, '即位礼正殿の儀の行われる日'); }
  // 国民の休日: a day between two holidays (1985-). 振替休日: the next non-holiday after a Sunday holiday (1973-).
  const base = [...h.keys()].sort();
  for (const k of base) {
    const dt = parseDate(k);
    const next = addDays(dt, 2);
    if (y >= 1985 && h.has(iso(next)) && !h.has(iso(addDays(dt, 1))) && addDays(dt, 1).getUTCDay() !== 0 &&
        addDays(dt, 1).getUTCFullYear() === y) h.set(iso(addDays(dt, 1)), '休日（国民の休日）');
  }
  for (const k of [...h.keys()].sort()) {
    const dt = parseDate(k);
    if (y >= 1973 && dt.getUTCDay() === 0 && !h.get(k).startsWith('休日')) {
      let t = addDays(dt, 1);
      while (h.has(iso(t))) t = addDays(t, 1);
      if (t.getUTCFullYear() === y) h.set(iso(t), '休日（振替休日）');
    }
  }
  return new Map([...h.entries()].sort());
}

/** Parse the Cabinet Office CSV text ("YYYY/M/D,name" lines) into Map<iso, name>. */
export function parseOfficialCsv(text) {
  const out = new Map();
  for (const line of text.split(/\r?\n/)) {
    const m = line.trim().match(/^(\d{4})\/(\d{1,2})\/(\d{1,2}),(.+)$/);
    if (m) out.set(iso(utc(+m[1], +m[2], +m[3])), m[4].trim());
  }
  return out;
}

export class Calendar {
  /**
   * @param official Map<iso,name> from the Cabinet Office CSV (authoritative where present)
   * @param opts {closeYearEnd: boolean (12/29-1/3 closed, default true), weekendDays: number[] (0=Sun), extraHolidays: string[]}
   */
  constructor(official = new Map(), opts = {}) {
    this.official = official;
    this.officialYears = new Set([...official.keys()].map((k) => Number(k.slice(0, 4))));
    this.closeYearEnd = opts.closeYearEnd ?? true;
    this.weekend = new Set(opts.weekendDays ?? [0, 6]);
    this.extra = new Map((opts.extraHolidays ?? []).map((x) => [iso(parseDate(x)), '指定休業日']));
    this.cache = new Map();
  }

  holidaysOfYear(y) {
    if (!this.cache.has(y)) {
      if (this.officialYears.has(y)) {
        this.cache.set(y, new Map([...this.official].filter(([k]) => k.startsWith(`${y}-`))));
      } else this.cache.set(y, computeHolidays(y));
    }
    return this.cache.get(y);
  }

  source(y) { return this.officialYears.has(y) ? 'official' : 'computed'; }

  holidayName(dt) { return this.holidaysOfYear(dt.getUTCFullYear()).get(iso(dt)) ?? null; }

  isYearEnd(dt) { const m = dt.getUTCMonth() + 1, d = dt.getUTCDate(); return (m === 12 && d >= 29) || (m === 1 && d <= 3); }

  /** Why a day is closed ('土曜日', '祝日: 元日', '年末年始', '指定休業日') or null for a business day. */
  closedReason(dt) {
    const hn = this.holidayName(dt);
    if (hn) return `祝日: ${hn}`;
    if (this.weekend.has(dt.getUTCDay())) return `${WEEKDAYS[dt.getUTCDay()]}曜日`;
    if (this.extra.has(iso(dt))) return '指定休業日';
    if (this.closeYearEnd && this.isYearEnd(dt)) return '年末年始';
    return null;
  }

  isBusinessDay(dt) { return this.closedReason(dt) === null; }

  /** n > 0: the n-th business day after dt; n < 0: before; n = 0: dt itself if open, else the next open day. */
  addBusinessDays(dt, n) {
    if (Math.abs(n) > 100000) throw new Error('days が大きすぎます');
    let cur = dt, left = Math.abs(n);
    const step = n < 0 ? -1 : 1;
    if (n === 0) { while (!this.isBusinessDay(cur)) cur = addDays(cur, 1); return cur; }
    while (left > 0) { cur = addDays(cur, step); if (this.isBusinessDay(cur)) left--; }
    return cur;
  }

  /** Business days in [from, to) — start included, end excluded (negative if to < from). */
  businessDaysBetween(from, to) {
    const sign = to >= from ? 1 : -1;
    const [a, b] = sign > 0 ? [from, to] : [to, from];
    if ((b - a) / 86400000 > 366 * 200) throw new Error('期間が長すぎます');
    let n = 0;
    for (let c = a; c < b; c = addDays(c, 1)) if (this.isBusinessDay(c)) n++;
    return sign * n;
  }
}
