// PDF -> Markdown with pdf.js: lines rebuilt from glyph positions, headings from font size, CJK-aware spacing.
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { detectScript, isCjk, tidy } from './text.js';

const require = createRequire(import.meta.url);
const root = dirname(require.resolve('pdfjs-dist/package.json'));
const CMAP_URL = pathToFileURL(join(root, 'cmaps')).href + '/';
const FONT_URL = pathToFileURL(join(root, 'standard_fonts')).href + '/';

const BULLET = /^[•・◦▪●○■□◆◇‣∙·*\-–—]\s*/;
const median = (a) => { if (!a.length) return 0; const s = [...a].sort((x, y) => x - y); return s[Math.floor(s.length / 2)]; };

function toGlyphs(items) {
  return items.filter((i) => i.str !== undefined && i.str !== '' && i.transform)
    .map((i) => ({ str: i.str, x: i.transform[4], y: i.transform[5], size: Math.hypot(i.transform[2], i.transform[3]) || i.height || 0, w: i.width || 0 }));
}

/**
 * Find the x position of a vertical gutter between two text columns, or null.
 * Counted per text row (not per glyph, so character-level and line-level PDFs behave alike):
 * the gutter is an empty strip (>= 8pt) in the middle of the page, crossed by at most a few rows (title, abstract),
 * with >= 8 rows on each side, and the text on both sides must actually run up to the gutter (justified columns).
 */
export function findGutter(glyphs, pageWidth) {
  if (!pageWidth) return null;
  const items = glyphs.filter((g) => g.str.trim());
  const rows = new Map();
  for (const g of items) {
    const k = Math.round(g.y / 3);
    (rows.get(k) ?? rows.set(k, []).get(k)).push(g);
  }
  if (rows.size < 10) return null;
  const rowList = [...rows.values()];
  const bins = new Uint16Array(Math.ceil(pageWidth) + 2);
  for (const r of rowList) {
    const covered = new Set();
    for (const g of r) for (let x = Math.max(0, Math.floor(g.x)); x <= Math.min(bins.length - 1, Math.ceil(g.x + g.w)); x++) covered.add(x);
    for (const x of covered) bins[x]++;
  }
  const tolerance = Math.max(1, Math.floor(rowList.length * 0.04));
  const lo = Math.floor(pageWidth * 0.3), hi = Math.ceil(pageWidth * 0.7);
  let best = null, run = null;
  for (let x = lo; x <= hi; x++) {
    if (bins[x] <= tolerance) { run = run ? { ...run, end: x } : { start: x, end: x }; if (!best || run.end - run.start > best.end - best.start) best = run; }
    else run = null;
  }
  if (!best || best.end - best.start < 8) return null;
  const mid = (best.start + best.end) / 2;
  let leftRows = 0, rightRows = 0, leftNear = 0, rightNear = 0;
  for (const r of rowList) {
    const left = r.filter((g) => g.x + g.w / 2 < mid), right = r.filter((g) => g.x + g.w / 2 >= mid);
    const crosses = r.some((g) => g.x < best.start - 1 && g.x + g.w > best.end + 1);
    if (crosses) continue;
    if (left.length) { leftRows++; if (Math.max(...left.map((g) => g.x + g.w)) >= best.start - 30) leftNear++; }
    if (right.length) { rightRows++; if (Math.min(...right.map((g) => g.x)) <= best.end + 30) rightNear++; }
  }
  return leftRows >= 8 && rightRows >= 8 && leftNear / leftRows >= 0.3 && rightNear / rightRows >= 0.3 ? mid : null;
}

function rowsToLines(glyphs) {
  const rows = [];
  for (const g of glyphs.sort((a, b) => b.y - a.y || a.x - b.x)) {
    const row = rows.find((r) => Math.abs(r.y - g.y) <= Math.max(2, Math.min(r.size, g.size) * 0.45));
    if (row) { row.g.push(g); row.size = Math.max(row.size, g.size); } else rows.push({ y: g.y, size: g.size, g: [g] });
  }
  return rows.sort((a, b) => b.y - a.y).map((r) => {
    r.g.sort((a, b) => a.x - b.x);
    let text = '', prevEnd = null;
    for (const g of r.g) {
      if (prevEnd !== null) {
        const gap = g.x - prevEnd;
        const cjkEdge = /[\u3040-\u30ff\u3400-\u9fff\uac00-\ud7af]$/.test(text) || /^[\u3040-\u30ff\u3400-\u9fff\uac00-\ud7af]/.test(g.str);
        if (gap > r.size * (cjkEdge ? 0.9 : 0.18) && !text.endsWith(' ') && !g.str.startsWith(' ')) text += ' ';
      }
      text += g.str;
      prevEnd = g.x + g.w;
    }
    return { y: r.y, size: r.size, text: text.replace(/\s+$/g, ''), x0: r.g[0].x };
  }).filter((l) => l.text.trim());
}

/**
 * Group text items of one page into lines in reading order: [{y, size, text}].
 * Two-column pages are read left column first, then right; full-width lines (titles) split the page into bands.
 */
export function linesFromItems(items, pageWidth = 0) {
  const glyphs = toGlyphs(items);
  if (!glyphs.length) return [];
  const gutter = findGutter(glyphs, pageWidth);
  if (gutter === null) return rowsToLines(glyphs);
  const spans = glyphs.filter((g) => g.x < gutter - 6 && g.x + g.w > gutter + 6);
  const spanSet = new Set(spans);
  const colGlyphs = glyphs.filter((g) => !spanSet.has(g));
  const spanLines = rowsToLines([...spans]).sort((a, b) => b.y - a.y);
  const out = [];
  let top = Infinity;
  const band = (yHigh, yLow) => {
    const inBand = colGlyphs.filter((g) => g.y < yHigh && g.y >= yLow);
    out.push(...rowsToLines(inBand.filter((g) => g.x + g.w / 2 < gutter)), ...rowsToLines(inBand.filter((g) => g.x + g.w / 2 >= gutter)));
  };
  for (const sl of spanLines) { band(top, sl.y + 0.01); out.push(sl); top = sl.y; }
  band(top, -Infinity);
  return out;
}

/** Lines of all pages -> Markdown blocks with page numbers. Headings = clearly larger than the body font. */
export function blocksFromPages(pages) {
  const sizes = pages.flatMap((p) => p.map((l) => Math.round(l.size * 2) / 2));
  const body = median(sizes) || 10;
  const heads = [...new Set(sizes.filter((s) => s >= body * 1.25))].sort((a, b) => b - a).slice(0, 3);
  const blocks = [];
  pages.forEach((lines, pi) => {
    let para = [], last = null;
    const flush = () => { if (para.length) { blocks.push({ text: para.join('\n'), page: pi + 1, md: para.join('\n'), kind: 'p' }); para = []; } };
    for (const l of lines) {
      const sz = Math.round(l.size * 2) / 2;
      const level = heads.indexOf(sz);
      const gap = last ? last.y - l.y : 0;
      const isHead = level >= 0 && l.text.length < 120;
      if (isHead) { flush(); blocks.push({ text: l.text, page: pi + 1, md: `${'#'.repeat(level + 1)} ${l.text}`, kind: 'h' }); last = l; continue; }
      if (last && gap > Math.max(last.size, l.size) * 1.8) flush();
      const bullet = BULLET.test(l.text);
      if (bullet) { flush(); para.push(`- ${l.text.replace(BULLET, '')}`); }
      else if (para.length && !para[para.length - 1].startsWith('- ')) {
        const prev = para[para.length - 1];
        const cjk = /[぀-ヿ㐀-鿿]$/.test(prev) || /^[぀-ヿ㐀-鿿]/.test(l.text);
        para[para.length - 1] = prev + (cjk || prev.endsWith('-') ? '' : ' ') + l.text;   // re-join wrapped lines (a trailing hyphen is kept: it may be a real compound)
      } else para.push(l.text);
      last = l;
    }
    flush();
  });
  return blocks;
}

export async function convertPdf(bytes, { maxPages = 500 } = {}) {
  const task = pdfjs.getDocument({ data: new Uint8Array(bytes), cMapUrl: CMAP_URL, cMapPacked: true, standardFontDataUrl: FONT_URL,
    useSystemFonts: false, isEvalSupported: false, disableFontFace: true, verbosity: 0 });
  const doc = await task.promise;
  const warnings = [];
  const total = doc.numPages;
  const n = Math.min(total, maxPages);
  if (total > n) warnings.push(`Only the first ${n} of ${total} pages were converted (maxPages).`);
  const pages = [];
  for (let i = 1; i <= n; i++) {
    const page = await doc.getPage(i);
    const tc = await page.getTextContent();
    pages.push(linesFromItems(tc.items, page.view?.[2] - (page.view?.[0] ?? 0)));
    page.cleanup();
  }
  let meta = {};
  try { const m = await doc.getMetadata(); meta = { title: m.info?.Title || null, author: m.info?.Author || null, created: m.info?.CreationDate || null }; } catch { /* optional */ }
  await doc.destroy();
  const blocks = blocksFromPages(pages);
  const empty = pages.filter((p) => !p.length).length;
  if (empty === n) warnings.push('No text layer found: this looks like a scanned/image-only PDF. OCR is not supported.');
  else if (empty) warnings.push(`${empty} page(s) have no text layer (images/scans); they are skipped.`);
  const markdown = tidy(blocks.map((b) => b.md).join('\n\n'));
  const text = tidy(blocks.map((b) => b.text).join('\n\n'));
  const script = detectScript(text);
  const allLines = pages.flat();
  const singles = allLines.filter((l) => /^[\u3040-\u30ff\u3400-\u9fff]$/.test(l.text.trim())).length;
  if (isCjk(script) && singles >= 10 && singles / allLines.length > 0.3) {
    warnings.push('Many single-character lines: this PDF probably uses vertical (tategaki) text, whose reading order is not reconstructed.');
  }
  return { type: 'pdf', pages: total, convertedPages: n, ...meta, markdown, text, blocks: blocks.map((b) => ({ text: b.md, page: b.page })),
    pageTexts: pages.map((lines) => lines.map((l) => l.text).join('\n')), warnings };
}
