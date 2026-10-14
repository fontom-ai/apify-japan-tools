import { Actor } from 'apify';
import { readFileSync } from 'node:fs';
import { unzipSync, strFromU8 } from 'fflate';
import { PostalIndex, parseKenAll, normalizeZip, formatZip } from './postal.js';

const LIVE_URL = 'https://www.post.japanpost.jp/service/search/zipcode/download/utf/zip/utf_ken_all.zip';
const SNAPSHOT = new URL('../data/utf_ken_all.zip', import.meta.url);

const readZip = (bytes) => strFromU8(Object.values(unzipSync(new Uint8Array(bytes)))[0]);

/** Japan Post's latest file, live; the bundled snapshot is the fallback if their site is unreachable or moved. */
async function loadRows() {
  try {
    const res = await fetch(LIVE_URL, { signal: AbortSignal.timeout(30000), redirect: 'follow' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const rows = parseKenAll(readZip(await res.arrayBuffer()));
    if (rows.length > 100000) return { rows, source: 'live' };
    throw new Error(`only ${rows.length} rows`);
  } catch (e) { console.warn(`Japan Post file not reachable (${e.message}); using the bundled snapshot.`); }
  return { rows: parseKenAll(readZip(readFileSync(SNAPSHOT))), source: 'snapshot' };
}

export function answer(idx, raw, mode) {
  const text = String(raw ?? '').trim();
  const zip = normalizeZip(text);
  const m = mode === 'auto' ? (zip ? 'zip' : 'address') : mode;
  if (m === 'zip') {
    if (!zip) return { input: text, mode: 'zip', found: false, error: '郵便番号は7桁の数字で指定してください（例: 100-0001）' };
    const candidates = idx.lookupZip(zip);
    return { input: text, mode: 'zip', zip: formatZip(zip), found: candidates.length > 0, candidates };
  }
  if (!text) return { input: text, mode: m, found: false, error: '空の入力です' };
  const r = idx.addressToZip(text);
  const base = { input: text, mode: m, normalized: r.normalized, prefecture: r.prefecture, city: r.city, town: r.town, block: r.block };
  if (m === 'normalize') return { ...base, found: Boolean(r.city) };
  return { ...base, zip: r.zip ? formatZip(r.zip) : null, confidence: r.confidence, found: Boolean(r.zip), candidates: r.candidates };
}

await Actor.init();
const input = (await Actor.getInput()) ?? {};
const items = (Array.isArray(input.items) ? input.items : []).map(String);
const mode = ['auto', 'zip', 'address', 'normalize'].includes(input.mode) ? input.mode : 'auto';
if (!items.length) await Actor.fail('items が空です。例: ["100-0001", "東京都千代田区飯田橋1-2-3"]');
else if (items.length > 100000) await Actor.fail('一度に処理できるのは10万件までです。');
else {
  const { rows, source } = await loadRows();
  const idx = new PostalIndex(rows);
  console.log(`Postal data: ${source} (${rows.length} rows). Processing ${items.length} item(s) in mode "${mode}".`);
  for (const [i, raw] of items.entries()) {
    const out = { ...answer(idx, raw, mode), dataSource: source };
    const r = await Actor.pushData(out, out.found ? 'result' : undefined);   // misses and input errors are free
    if (r?.eventChargeLimitReached) { console.warn(`Spending limit reached after ${i + 1} items; stopping.`); break; }
  }
}
await Actor.exit();
