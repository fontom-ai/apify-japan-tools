import { Actor } from 'apify';
import { parseQuery, pickLaw, articleResult, listArticles } from './law.js';

const API = 'https://laws.e-gov.go.jp/api/2';
const NOTICE = '出典: e-Gov法令検索（デジタル庁）。法的助言ではありません。正式な内容は必ずe-Gov法令検索で確認してください。';

async function getJson(url, tries = 3) {
  let last;
  for (let i = 0; i < tries; i++) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(60000) });
      if (res.status === 404) return null;
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.json();
    } catch (e) { last = e; await new Promise((r) => setTimeout(r, 1000 * (i + 1))); }
  }
  throw new Error(`e-Gov API に接続できません: ${last.message}`);
}

const lawCache = new Map(), searchCache = new Map();

async function search(name) {
  if (!searchCache.has(name)) searchCache.set(name, (await getJson(`${API}/laws?law_title=${encodeURIComponent(name)}&limit=30`))?.laws ?? []);
  return searchCache.get(name);
}

async function lawData(lawId, asOf) {
  const key = `${lawId}|${asOf ?? ''}`;
  if (!lawCache.has(key)) {
    const q = `law_full_text_format=json&response_format=json${asOf ? `&asof=${asOf}` : ''}`;
    lawCache.set(key, await getJson(`${API}/law_data/${lawId}?${q}`));
  }
  return lawCache.get(key);
}

const lawSummary = (j) => ({
  title: j.revision_info.law_title, lawId: j.law_info.law_id, lawNum: j.law_info.law_num, revisionId: j.revision_info.law_revision_id,
  enforcementDate: j.revision_info.amendment_enforcement_date ?? null,
  url: `https://laws.e-gov.go.jp/law/${j.law_info.law_id}`,
});

export async function answer(query, asOf) {
  const q = parseQuery(query);
  if (!q.lawName) return { query, found: false, error: '法令名を指定してください（例: 民法第709条）' };
  const { law, ambiguous } = pickLaw(await search(q.lawName), q.lawName);
  if (!law) {
    return { query, found: false, error: ambiguous.length ? '法令名が複数の法令に一致します。正式名称で指定してください。' : '該当する現行法令が見つかりません。',
      candidates: ambiguous.map((l) => ({ title: l.revision_info?.law_title, lawId: l.law_info?.law_id, type: l.law_info?.law_type })) };
  }
  const j = await lawData(law.law_info.law_id, asOf);
  if (!j) return { query, found: false, error: asOf ? `${asOf}時点の法令データがありません（施行前または廃止後の可能性）。` : '法令データを取得できません。' };
  const base = { query, asOf: asOf ?? null, law: lawSummary(j), notice: NOTICE };
  if (!q.article) return { ...base, found: true, articles: listArticles(j.law_full_text) };
  const art = articleResult(j, q.article, q.paragraph);
  if (!art) return { ...base, found: false, error: `第${q.article.replace(/_/g, '条の')}${q.article.includes('_') ? '' : '条'}が見つかりません（この時点で未施行、または削除された条文の可能性）。` };
  if (art.error) return { ...base, found: false, error: art.error };
  return { ...base, found: true, article: art };
}

await Actor.init();
const input = (await Actor.getInput()) ?? {};
const queries = (Array.isArray(input.queries) ? input.queries : []).map(String).filter((s) => s.trim());
const asOf = input.asOf ? String(input.asOf).trim() : null;
if (!queries.length) await Actor.fail('queries が空です。例: ["民法第709条", "会社法第2条"]');
else if (asOf && !/^\d{4}-\d{2}-\d{2}$/.test(asOf)) await Actor.fail('asOf は YYYY-MM-DD で指定してください。');
else {
  for (const [i, query] of queries.entries()) {
    let out;
    try { out = await answer(query, asOf); } catch (e) { out = { query, found: false, error: e.message }; }
    const r = await Actor.pushData(out);   // priced as apify-default-dataset-item: every row written is charged, misses included
    if (r?.eventChargeLimitReached) { console.warn(`Spending limit reached after ${i + 1} queries; stopping.`); break; }
  }
}
await Actor.exit();
