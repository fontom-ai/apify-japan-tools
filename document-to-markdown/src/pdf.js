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

const CELL_GAP = 1.2;   // em: an empty strip this wide inside a row starts a new table cell
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
    let text = '', prevEnd = null, prevInk = null;
    const cells = [];
    let cell = null;
    for (const g of r.g) {
      const gap = prevEnd === null ? 0 : g.x - prevEnd;
      if (prevEnd !== null) {
        const cjkEdge = /[\u3040-\u30ff\u3400-\u9fff\uac00-\ud7af]$/.test(text) || /^[\u3040-\u30ff\u3400-\u9fff\uac00-\ud7af]/.test(g.str);
        if (gap > r.size * (cjkEdge ? 0.9 : 0.18) && !text.endsWith(' ') && !g.str.startsWith(' ')) text += ' ';
      }
      // Cells: a wide empty strip between two inked items starts a new cell. Whitespace-only items (some PDFs emit one
      // very wide space between columns) must not hide the strip, so the gap is measured between inked items only.
      const ink = g.str.trim() !== '';
      if (ink) {
        const inkGap = prevInk === null ? 0 : g.x - prevInk;
        if (cell && inkGap > r.size * CELL_GAP) { cells.push(cell); cell = null; }
        if (!cell) cell = { x0: g.x, x1: g.x + g.w, text: '' };
        else if (g.x - prevEnd > r.size * 0.18 && !cell.text.endsWith(' ') && !g.str.startsWith(' ')) cell.text += ' ';
        cell.x1 = g.x + g.w;
        prevInk = g.x + g.w;
      }
      if (cell) cell.text += g.str;
      text += g.str;
      prevEnd = g.x + g.w;
    }
    if (cell) cells.push(cell);
    return { y: r.y, size: r.size, text: text.replace(/\s+$/g, ''), x0: r.g[0].x, cells: cells.map((c) => ({ ...c, text: c.text.trim() })).filter((c) => c.text) };
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


const cellMd = (t) => String(t ?? '').replace(/\|/g, '\\|').replace(/\s+/g, ' ').trim();

/**
 * Column ranges of a run of table rows, found as vertical strips that (almost) no row crosses.
 * Returns [{x0, x1}, ...] or null when the rows do not form >= 2 columns.
 */
function columnRanges(rows, size) {
  const x0 = Math.floor(Math.min(...rows.flatMap((r) => r.cells.map((c) => c.x0))));
  const x1 = Math.ceil(Math.max(...rows.flatMap((r) => r.cells.map((c) => c.x1))));
  const bins = new Uint16Array(x1 - x0 + 2);
  for (const r of rows) {
    const covered = new Set();
    for (const c of r.cells) for (let x = Math.floor(c.x0) - x0; x <= Math.ceil(c.x1) - x0; x++) covered.add(x);
    for (const x of covered) bins[x]++;
  }
  const tolerance = Math.floor(rows.length * 0.12);
  const minGap = Math.max(5, size * 0.8);
  const cols = [];
  let start = null, lastOcc = null;
  for (let x = 0; x < bins.length; x++) {
    if (bins[x] > tolerance) {
      if (start === null) start = x;
      else if (x - lastOcc > minGap) { cols.push({ x0: start + x0, x1: lastOcc + x0 }); start = x; }
      lastOcc = x;
    }
  }
  if (start !== null) cols.push({ x0: start + x0, x1: lastOcc + x0 });
  return cols.length >= 2 ? cols : null;
}

const colOf = (cols, c) => {
  const mid = (c.x0 + c.x1) / 2;
  let best = 0, bestD = Infinity;
  cols.forEach((col, i) => { const d = mid < col.x0 ? col.x0 - mid : mid > col.x1 ? mid - col.x1 : 0; if (d < bestD) { bestD = d; best = i; } });
  return best;
};

/** Try to read lines[start..] as a table. Returns {end, rows, cols} (end exclusive) or null. */
function tableAt(lines, start) {
  const run = [lines[start]];
  let i = start + 1;
  while (i < lines.length) {
    const l = lines[i], prev = lines[i - 1];
    const gap = prev.y - l.y;
    const size = Math.max(prev.size, l.size);
    if (gap > size * 3) break;
    if (l.cells.length >= 2) run.push(l);
    else if (l.cells.length === 1 && gap <= size * 1.7 && l.x0 >= Math.min(...run.map((r) => r.x0)) - 2) run.push(l);   // wrapped cell text
    else break;
    i++;
  }
  while (run.length && run[run.length - 1].cells.length < 2) run.pop();
  const tab = run.filter((r) => r.cells.length >= 2);
  if (tab.length < 3) return null;
  const size = median(tab.map((r) => r.size)) || 10;
  const cols = columnRanges(tab, size);
  if (!cols) return null;
  const used = cols.map((col, ci) => tab.filter((r) => r.cells.some((c) => colOf(cols, c) === ci)).length / tab.length);
  if (used.filter((u) => u >= 0.6).length < 2) return null;                     // at least two columns filled in most rows
  const colLens = cols.map((col, ci) => median(tab.flatMap((r) => r.cells.filter((c) => colOf(cols, c) === ci).map((c) => c.text.length))));
  // Two wide columns a few points apart are the page's text columns (even when a table sits in one of them);
  // columns that are all running text are text columns too. Either way: read column by column, no table.
  const wide = cols.length === 2 && cols.every((c) => c.x1 - c.x0 >= 120) && cols[1].x0 - cols[0].x1 <= 24;
  const prose = tab.length >= 6 && (colLens.every((n) => n >= 24) || (wide && colLens.some((n) => n >= 24)));
  if (!prose) {
    const cells = tab.flatMap((r) => r.cells);
    if (cells.filter((c) => c.text.length >= 2).length / cells.length < 0.6) return { rejected: true, end: start + run.length };   // figure labels, lone letters and digits
    if (cells.length / (tab.length * cols.length) < 0.5) return { rejected: true, end: start + run.length };                     // mostly empty grid: a drawing, not a table
  }
  const rows = [];
  for (const l of run) {
    if (l.cells.length >= 2 || !rows.length) {
      const r = Array.from({ length: cols.length }, () => '');
      for (const c of l.cells) { const ci = colOf(cols, c); r[ci] = r[ci] ? `${r[ci]} ${c.text}` : c.text; }
      rows.push(r);
    } else {                                                                    // wrapped text continues the cell above
      const c = l.cells[0], ci = colOf(cols, c);
      const last = rows[rows.length - 1];
      const cjk = /[\u3040-\u30ff\u3400-\u9fff]$/.test(last[ci]) || /^[\u3040-\u30ff\u3400-\u9fff]/.test(c.text);
      last[ci] = last[ci] ? last[ci] + (cjk ? '' : ' ') + c.text : c.text;
    }
  }
  return { end: start + run.length, rows, cols, y: run[0].y, size, prose, run };
}

export const tableToMarkdown = (rows) => {
  const w = rows[0].length;
  const line = (r) => `| ${r.map(cellMd).join(' | ')} |`;
  return [line(rows[0]), `| ${Array(w).fill('---').join(' | ')} |`, ...rows.slice(1).map(line)].join('\n');
};

/**
 * Split a page's lines into plain lines and tables: [{line} | {table: {rows, y, size}}].
 * Text laid out in columns that the page-level gutter search missed comes back as plain lines, left column first.
 * With detect=false nothing is turned into a table.
 */
export function groupTables(lines, detect = true) {
  const out = [];
  for (let i = 0; i < lines.length;) {
    const t = detect && lines[i].cells?.length >= 2 ? tableAt(lines, i) : null;
    if (!t || t.rejected) {
      const to = t ? t.end : i + 1;
      for (; i < to; i++) out.push({ line: lines[i] });                     // a rejected run is kept as plain lines (its tail must not be re-read as a smaller table)
      continue;
    }
    if (t.prose) {
      for (let ci = 0; ci < t.cols.length; ci++) {
        for (const l of t.run) {
          const cs = l.cells.filter((c) => colOf(t.cols, c) === ci);
          if (cs.length) out.push({ line: { y: l.y, size: l.size, x0: cs[0].x0, cells: [], text: cs.map((c) => c.text).join(' ') } });
        }
      }
    } else out.push({ table: t });
    i = t.end;
  }
  return out;
}

/** Lines of all pages -> Markdown blocks with page numbers. Headings = clearly larger than the body font. */
export function blocksFromPages(pages, { detectTables = true } = {}) {
  const sizes = pages.flatMap((p) => p.map((l) => Math.round(l.size * 2) / 2));
  const body = median(sizes) || 10;
  const heads = [...new Set(sizes.filter((s) => s >= body * 1.25))].sort((a, b) => b - a).slice(0, 3);
  const blocks = [];
  pages.forEach((lines, pi) => {
    let para = [], last = null;
    const flush = () => { if (para.length) { blocks.push({ text: para.join('\n'), page: pi + 1, md: para.join('\n'), kind: 'p' }); para = []; } };
    for (const item of groupTables(lines, detectTables)) {
      if (item.table) {
        flush();
        const t = item.table;
        blocks.push({ text: t.rows.map((r) => r.join('\t')).join('\n'), page: pi + 1, md: tableToMarkdown(t.rows), kind: 't' });
        last = null;
        continue;
      }
      const l = item.line;
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

export async function convertPdf(bytes, { maxPages = 500, detectTables = true } = {}) {
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
  const blocks = blocksFromPages(pages, { detectTables });
  const emptyPages = pages.map((p, i) => (p.length ? 0 : i + 1)).filter(Boolean);
  const empty = emptyPages.length;
  if (empty === n) warnings.push('No text layer found on any page: this looks like a scanned/image-only PDF. OCR is not supported; run OCR first (for example ocrmypdf) and send the result.');
  else if (empty) warnings.push(`${empty} page(s) have no text layer (images/scans) and are skipped: ${emptyPages.slice(0, 20).join(', ')}${empty > 20 ? ', ...' : ''}.`);
  const markdown = tidy(blocks.map((b) => b.md).join('\n\n'));
  const text = tidy(blocks.map((b) => b.text).join('\n\n'));
  const script = detectScript(text);
  const allLines = pages.flat();
  const singles = allLines.filter((l) => /^[\u3040-\u30ff\u3400-\u9fff]$/.test(l.text.trim())).length;
  if (isCjk(script) && singles >= 10 && singles / allLines.length > 0.3) {
    warnings.push('Many single-character lines: this PDF probably uses vertical (tategaki) text, whose reading order is not reconstructed.');
  }
  return { type: 'pdf', pages: total, convertedPages: n, ...meta, tables: blocks.filter((b) => b.kind === 't').length, scanned: empty === n, emptyPages: emptyPages.slice(0, 200), markdown, text, blocks: blocks.map((b) => ({ text: b.md, page: b.page })),
    pageTexts: pages.map((lines) => lines.map((l) => l.text).join('\n')), warnings };
}
