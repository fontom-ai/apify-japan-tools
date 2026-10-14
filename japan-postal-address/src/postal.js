// Japan Post "utf_ken_all" postal code data: lookup, address -> postal code, address normalisation.
// Pure functions: the CSV text is passed in. The data is public domain ("著作権を主張しません").

export const PREFECTURES = ['北海道', '青森県', '岩手県', '宮城県', '秋田県', '山形県', '福島県', '茨城県', '栃木県', '群馬県', '埼玉県', '千葉県',
  '東京都', '神奈川県', '新潟県', '富山県', '石川県', '福井県', '山梨県', '長野県', '岐阜県', '静岡県', '愛知県', '三重県', '滋賀県', '京都府',
  '大阪府', '兵庫県', '奈良県', '和歌山県', '鳥取県', '島根県', '岡山県', '広島県', '山口県', '徳島県', '香川県', '愛媛県', '高知県', '福岡県',
  '佐賀県', '長崎県', '熊本県', '大分県', '宮崎県', '鹿児島県', '沖縄県'];

const KAN = { 〇: 0, 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9 };

function kanjiRunToNumber(run) {
  const i = run.indexOf('十');
  if (i < 0) return [...run].every((c) => c in KAN) ? Number([...run].map((c) => KAN[c]).join('')) : NaN;
  const tens = i === 0 ? 1 : KAN[run.slice(0, i)];
  const ones = i === run.length - 1 ? 0 : KAN[run.slice(i + 1)];
  return tens === undefined || ones === undefined || run.length - i > 2 ? NaN : tens * 10 + ones;
}

/** Full-width -> half-width, dash variants -> '-', kanji numerals -> digits, no spaces. Applied to both sides when matching. */
export function normalizeText(s) {
  let t = String(s ?? '').normalize('NFKC');
  t = t.replace(/[‐‑‒–—―−－─━]/g, '-').replace(/(?<=\d)ー(?=\d)/g, '-'); // 'ー' between digits is a hyphen; elsewhere it is katakana
  t = t.replace(/\s+/g, '');
  t = t.replace(/[〇一二三四五六七八九十]+/g, (run) => { const n = kanjiRunToNumber(run); return Number.isNaN(n) ? run : String(n); });
  t = t.replace(/[ヶヵ]/g, 'ケ');
  return t;
}

/** '１００−０００１' / '100 0001' / '〒100-0001' -> '1000001' or null */
export function normalizeZip(s) {
  const t = String(s ?? '').normalize('NFKC').replace(/[〒\s\-ー‐–−]/g, '');
  return /^\d{7}$/.test(t) ? t : null;
}

export const formatZip = (z) => `${z.slice(0, 3)}-${z.slice(3)}`;

function splitCsvLine(line) {
  const out = [];
  let cur = '', q = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (q) { if (ch === '"') { if (line[i + 1] === '"') { cur += '"'; i++; } else q = false; } else cur += ch; }
    else if (ch === '"') q = true;
    else if (ch === ',') { out.push(cur); cur = ''; } else cur += ch;
  }
  out.push(cur);
  return out;
}

const ZERO_TOWN = /^(以下に掲載がない場合|.*の次に番地がくる場合|.*一円)$/;

/** Annotation in （…） of a town name, e.g. '１〜１９丁目' -> {kind:'range', unit:'丁目', ranges:[[1,19]]} */
export function parseAnnotation(note) {
  if (!note) return { kind: 'general' };
  const n = note.normalize('NFKC');
  if (/^(その他|次のビルを除く|.*を除く|丁目|番地|大字)$/.test(n)) return { kind: 'general' };
  if (/階|高層棟|地階|成田国際空港内/.test(n)) return { kind: 'building' };
  const unit = n.match(/(丁目|番地|番)$/)?.[1];
  const body = unit ? n.slice(0, -unit.length) : n;
  if (unit && /^[\d〜~、,\-−]+$/.test(body)) {
    const ranges = body.split(/[、,]/).map((p) => { const [a, b] = p.split(/[〜~]|(?<=\d)[-−](?=\d)/); return [Number(a), Number(b ?? a)]; });
    if (ranges.every(([a, b]) => Number.isFinite(a) && Number.isFinite(b))) return { kind: 'range', unit, ranges };
  }
  return { kind: 'other', text: n };
}

export function parseKenAll(text) {
  const rows = [];
  for (const line of text.split(/\r?\n/)) {
    if (!line) continue;
    const f = splitCsvLine(line);
    if (f.length < 9 || !/^\d{7}$/.test(f[2])) continue;
    const townRaw = f[8], m = townRaw.match(/^(.*?)（(.*)）?$/);
    const base = (m ? m[1] : townRaw).replace(/）$/, '');
    rows.push({ jis: f[0], zip: f[2], prefecture: f[6], city: f[7], townRaw, town: ZERO_TOWN.test(base) ? '' : base.replace(/一円$/, ''),
      note: m ? m[2].replace(/）$/, '') : '', kanaPrefecture: f[3], kanaCity: f[4], kanaTown: f[5] });
  }
  return rows;
}

export class PostalIndex {
  constructor(rows) {
    this.rows = rows;
    this.byZip = new Map();
    this.cities = new Map();   // prefecture -> Map(normalized city key -> city)
    this.towns = new Map();    // `${pref}${city}` -> Map(normalized town -> rows[])
    this.cityZip = new Map();  // `${pref}${city}` -> zip of the "以下に掲載がない場合" row
    this.cityByName = new Map();// normalized city key (without prefecture) -> Set of `${pref}\t${city}`
    for (const r of rows) {
      (this.byZip.get(r.zip) ?? this.byZip.set(r.zip, []).get(r.zip)).push(r);
      const cm = this.cities.get(r.prefecture) ?? this.cities.set(r.prefecture, new Map()).get(r.prefecture);
      const ck = normalizeText(r.city);
      cm.set(ck, r.city);
      const gun = r.city.match(/^.+?郡(.+)$/);
      if (gun) cm.set(normalizeText(gun[1]), r.city);               // 足柄上郡中井町 is often written 中井町
      const ckey = `${r.prefecture}${r.city}`;
      if (!r.town) { if (!this.cityZip.has(ckey)) this.cityZip.set(ckey, r); continue; }
      const tm = this.towns.get(ckey) ?? this.towns.set(ckey, new Map()).get(ckey);
      const tk = normalizeText(r.town);
      (tm.get(tk) ?? tm.set(tk, []).get(tk)).push(r);
    }
  }

  lookupZip(zip) {
    return (this.byZip.get(zip) ?? []).map(cleanRow);
  }

  /** Split an address into prefecture / city / town / rest and pick a postal code when it is unambiguous. */
  addressToZip(address) {
    const norm = normalizeText(address);
    const out = { input: address, normalized: norm, prefecture: null, city: null, town: null, block: null, zip: null, confidence: 'none', candidates: [] };
    let rest = norm.replace(/^〒?\d{3}-?\d{4}/, '');
    const pn = PREFECTURES.map((p) => [normalizeText(p), p]).find(([k]) => rest.startsWith(k));
    let pref = pn ? pn[1] : null;
    let cityHits = [];
    if (pn) rest = rest.slice(pn[0].length);
    const prefs = pref ? [pref] : PREFECTURES;
    for (const p of prefs) {
      const cm = this.cities.get(p);
      if (!cm) continue;
      let best = null;
      for (const [k, city] of cm) if (rest.startsWith(k) && (!best || k.length > best.k.length)) best = { k, city };
      if (best) cityHits.push({ p, ...best });
    }
    if (!pref) { // no prefecture written: only accept when exactly one prefecture has this city
      const uniq = new Set(cityHits.map((h) => `${h.p}${h.city}`));
      if (uniq.size !== 1) return out;
    }
    if (cityHits.length === 0) { out.prefecture = pref; return out; }
    cityHits.sort((a, b) => b.k.length - a.k.length);
    const hit = cityHits[0];
    out.prefecture = hit.p; out.city = hit.city;
    rest = rest.slice(hit.k.length);
    const ckey = `${hit.p}${hit.city}`;
    const tm = this.towns.get(ckey) ?? new Map();
    const tryMatch = (s) => { let best = null; for (const [k, rows] of tm) if (s.startsWith(k) && (!best || k.length > best.k.length)) best = { k, rows }; return best; };
    let town = tryMatch(rest), stripped = rest;
    if (!town) { stripped = rest.replace(/^(大字|字)/, ''); if (stripped !== rest) town = tryMatch(stripped); }
    const cityRow = this.cityZip.get(ckey);
    if (!town) {
      out.block = rest || null;
      if (cityRow) { out.zip = cityRow.zip; out.confidence = 'city'; out.candidates = [cleanRow(cityRow)]; }
      return out;
    }
    out.town = town.rows[0].town;
    const after = stripped.slice(town.k.length);
    out.block = after || null;
    const num = after.match(/^(\d+)/)?.[1];
    const n = num === undefined ? null : Number(num);
    const parsed = town.rows.map((r) => ({ r, a: parseAnnotation(r.note) }));
    const general = parsed.filter((x) => x.a.kind === 'general' || x.a.kind === 'other');
    const inRange = n === null ? [] : parsed.filter((x) => x.a.kind === 'range' && x.a.ranges.some(([lo, hi]) => n >= lo && n <= hi));
    const pick = inRange.length ? inRange : general.length ? general : parsed.filter((x) => x.a.kind === 'range');
    const zips = [...new Set(pick.map((x) => x.r.zip))];
    out.candidates = pick.map((x) => cleanRow(x.r));
    if (zips.length === 1) { out.zip = zips[0]; out.confidence = 'town'; }
    else { out.confidence = 'ambiguous'; }
    return out;
  }
}

export function cleanRow(r) {
  return { zip: formatZip(r.zip), prefecture: r.prefecture, city: r.city, town: r.town, townNote: r.note || null, jisCode: r.jis,
    kana: { prefecture: r.kanaPrefecture, city: r.kanaCity, town: r.town ? r.kanaTown.replace(/（.*$/, '') : '' } };
}
