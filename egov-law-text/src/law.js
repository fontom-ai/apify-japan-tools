// Helpers for the e-Gov Law API v2 (https://laws.e-gov.go.jp/api/2): query parsing, article lookup, plain-text rendering.
// The statute text is the government's own; this code only locates and flattens it.

const D = { 〇: 0, 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9 };

/** 七百九 -> 709, 千二百 -> 1200, 12 -> 12, ７０９ -> 709 */
export function kanjiToInt(s) {
  const t = String(s).normalize('NFKC');
  if (/^\d+$/.test(t)) return Number(t);
  let total = 0, cur = 0;
  const unit = { 千: 1000, 百: 100, 十: 10 };
  for (const ch of t) {
    if (ch in D) cur = cur * 10 + D[ch];
    else if (ch in unit) { total += (cur || 1) * unit[ch]; cur = 0; }
    else return NaN;
  }
  return total + cur;
}

const NUM = '[0-9０-９〇一二三四五六七八九十百千]+';

/**
 * "民法第709条", "民法 第七百九条の二 第2項", "個人情報保護法27条1項", "会社法" ->
 * { lawName, article: '709' | '709_2' | null, paragraph: 2 | null }
 */
export function parseQuery(q) {
  const s = String(q ?? '').normalize('NFKC').replace(/\s+/g, '');
  const m = s.match(new RegExp(`^(.*?)第?(${NUM})条((?:の${NUM})*)(?:第?(${NUM})項)?$`));
  if (!m) {
    const name = s.replace(/第?\d+条.*$/, '');
    return { lawName: name, article: null, paragraph: null };
  }
  const main = kanjiToInt(m[2]);
  if (!Number.isFinite(main) || !m[1]) return { lawName: m[1] || s, article: null, paragraph: null };
  const subs = (m[3].match(new RegExp(`の(${NUM})`, 'g')) ?? []).map((x) => kanjiToInt(x.slice(1)));
  const para = m[4] ? kanjiToInt(m[4]) : null;
  return { lawName: m[1], article: [main, ...subs].join('_'), paragraph: para };
}

/** The in-force statute that best matches a name, from /laws results. Returns {law, ambiguous: []}. */
export function pickLaw(laws, name) {
  const n = String(name).normalize('NFKC').replace(/\s+/g, '');
  const live = laws.filter((l) => l.revision_info?.repeal_status === 'None' || l.current_revision_info?.repeal_status === 'None');
  const title = (l) => (l.revision_info?.law_title ?? l.current_revision_info?.law_title ?? '').normalize('NFKC');
  const abbrev = (l) => (l.revision_info?.abbrev ?? l.current_revision_info?.abbrev ?? '') || '';
  const rank = (l) => ({ Constitution: 0, Act: 1 }[l.law_info?.law_type] ?? 2);
  const exact = live.filter((l) => title(l) === n);
  const abbr = live.filter((l) => abbrev(l).split(/[,、]/).map((a) => a.normalize('NFKC')).includes(n));
  const pool = exact.length ? exact : abbr.length ? abbr : [];
  pool.sort((a, b) => rank(a) - rank(b));
  if (pool.length && (pool.length === 1 || rank(pool[0]) < rank(pool[1]))) return { law: pool[0], ambiguous: [] };
  if (!pool.length && live.length === 1) return { law: live[0], ambiguous: [] };
  return { law: null, ambiguous: (pool.length ? pool : live).slice(0, 8) };
}

export function findArticle(node, num) {
  if (typeof node === 'string') return null;
  if (node.tag === 'Article' && node.attr?.Num === num) return node;
  for (const c of node.children ?? []) { const r = findArticle(c, num); if (r) return r; }
  return null;
}

export function listArticles(node, out = []) {
  if (typeof node === 'string') return out;
  if (node.tag === 'Article') {
    const cap = (node.children ?? []).find((c) => c.tag === 'ArticleCaption');
    out.push({ num: node.attr?.Num, title: textOf((node.children ?? []).find((c) => c.tag === 'ArticleTitle')), caption: cap ? textOf(cap) : null });
    return out;
  }
  for (const c of node.children ?? []) listArticles(c, out);
  return out;
}

export function textOf(node) {
  if (node == null) return '';
  if (typeof node === 'string') return node;
  return (node.children ?? []).map(textOf).join('');
}

const BLOCK = new Set(['Paragraph', 'Item', 'Subitem1', 'Subitem2', 'Subitem3', 'Subitem4', 'Subitem5', 'Subitem6', 'Subitem7', 'Subitem8', 'Subitem9', 'Subitem10', 'TableStruct', 'List']);
const TITLE = /^(ParagraphNum|ItemTitle|Subitem\d+Title)$/;

/** Flatten a node to plain text: block elements on their own lines, numbers/titles followed by a space. */
export function render(node) {
  const lines = [];
  let cur = '';
  const flush = () => { if (cur.trim()) lines.push(cur.trim()); cur = ''; };
  const walk = (n, depth) => {
    if (typeof n === 'string') { cur += n; return; }
    if (n.tag === 'ArticleCaption' || n.tag === 'ArticleTitle') return;
    if (BLOCK.has(n.tag)) { flush(); cur = '  '.repeat(Math.max(0, depth - 1)); }
    const nextDepth = BLOCK.has(n.tag) && n.tag !== 'Paragraph' && n.tag !== 'TableStruct' ? depth + 1 : depth;
    for (const c of n.children ?? []) walk(c, nextDepth);
    if (TITLE.test(n.tag) && textOf(n)) cur += ' ';
  };
  walk(node, 0);
  flush();
  return lines.join('\n');
}

export function articleResult(lawJson, num, paragraph = null) {
  const art = findArticle(lawJson.law_full_text, num);
  if (!art) return null;
  const caption = (art.children ?? []).find((c) => c.tag === 'ArticleCaption');
  const title = textOf((art.children ?? []).find((c) => c.tag === 'ArticleTitle'));
  const paras = (art.children ?? []).filter((c) => c.tag === 'Paragraph');
  const paragraphs = paras.map((p) => ({ num: Number(p.attr?.Num ?? 0), text: render(p).replace(/^\s*[0-9０-９]+\s+/, '') }));
  let chosen = paragraphs;
  if (paragraph !== null) {
    chosen = paragraphs.filter((p) => p.num === paragraph);
    if (!chosen.length) return { error: `第${num.split('_')[0]}条に第${paragraph}項はありません（${paragraphs.length}項まで）` };
  }
  const body = paragraph === null && !paras.length ? render({ tag: 'Body', children: art.children.filter((c) => !['ArticleCaption', 'ArticleTitle'].includes(c.tag)) }) : null;
  const text = body ?? chosen.map((p) => (paragraphs.length > 1 ? `${p.num}　${p.text}` : p.text)).join('\n');
  return { articleNum: num, articleTitle: title, caption: caption ? textOf(caption) : null, paragraphCount: paragraphs.length,
    text: `${title}${caption ? `　${textOf(caption)}` : ''}\n${text}`, paragraphs: chosen };
}
