import { unzipSync } from 'fflate';
import { convertPdf } from './pdf.js';
import { convertDocx, convertXlsx, convertPptx, convertHtml, convertText } from './office.js';
import { chunkBlocks, decodeText, detectScript, fixCjkVariants, normalizeText } from './text.js';

/** Detect the file type from magic bytes first, then content-type / extension. */
export function detectType(bytes, { contentType = '', name = '' } = {}) {
  const head = Buffer.from(bytes.subarray(0, 8)).toString('latin1');
  if (head.startsWith('%PDF')) return 'pdf';
  if (head.startsWith('PK')) {
    try {
      const names = Object.keys(unzipSync(new Uint8Array(bytes), { filter: (f) => /^(word\/document|xl\/workbook|ppt\/presentation)\.xml$/.test(f.name) }));
      if (names.includes('word/document.xml')) return 'docx';
      if (names.includes('xl/workbook.xml')) return 'xlsx';
      if (names.includes('ppt/presentation.xml')) return 'pptx';
    } catch { /* fall through */ }
    return 'unknown';
  }
  if (head.startsWith('\xd0\xcf\x11\xe0')) return 'legacy-office';
  const ext = (name.match(/\.([a-z0-9]+)(?:$|\?)/i)?.[1] ?? '').toLowerCase();
  const ct = contentType.toLowerCase();
  const sample = Buffer.from(bytes.subarray(0, 2048)).toString('utf8').trimStart().toLowerCase();
  if (/html/.test(ct) || ['html', 'htm', 'xhtml'].includes(ext) || sample.startsWith('<!doctype html') || sample.startsWith('<html')) return 'html';
  if (['md', 'markdown'].includes(ext) || /markdown/.test(ct)) return 'md';
  if (ext === 'csv' || /csv/.test(ct)) return 'csv';
  if (/^text\//.test(ct) || ['txt', 'text', 'log', 'json', 'xml'].includes(ext)) return 'txt';
  return 'unknown';
}

const csvToMarkdown = (text) => {
  const rows = text.trim().split(/\r?\n/).slice(0, 5000).map((l) => l.split(/,(?=(?:[^"]*"[^"]*")*[^"]*$)/).map((c) => c.replace(/^"|"$/g, '').replace(/""/g, '"').replace(/\|/g, '\\|')));
  if (!rows.length) return '';
  const w = Math.max(...rows.map((r) => r.length));
  const pad = (r) => Array.from({ length: w }, (_, i) => r[i] ?? '');
  return [`| ${pad(rows[0]).join(' | ')} |`, `| ${pad(rows[0]).map(() => '---').join(' | ')} |`, ...rows.slice(1).map((r) => `| ${pad(r).join(' | ')} |`)].join('\n');
};

/**
 * Convert one document. options: {chunkSize, chunkOverlap, maxPages, normalize, includePageTexts, maxChars, name, contentType}
 * Returns the result object (ok:true) or throws with a user-readable message.
 */
export async function convertBytes(bytes, opts = {}) {
  const type = detectType(bytes, opts);
  let r;
  switch (type) {
    case 'pdf': r = await convertPdf(bytes, { maxPages: opts.maxPages ?? 500, detectTables: opts.detectTables !== false }); break;
    case 'docx': r = await convertDocx(bytes); break;
    case 'xlsx': r = await convertXlsx(bytes); break;
    case 'pptx': r = convertPptx(bytes); break;
    case 'html': { const d = decodeText(bytes, opts.contentType); r = convertHtml(d.text); r.encoding = d.encoding; break; }
    case 'csv': { const d = decodeText(bytes, opts.contentType); r = convertText(d.text, 'csv'); r.markdown = csvToMarkdown(d.text); r.encoding = d.encoding; break; }
    case 'md': case 'txt': { const d = decodeText(bytes, opts.contentType); r = convertText(d.text, type); r.encoding = d.encoding; break; }
    case 'legacy-office': throw new Error('Legacy .doc/.xls/.ppt files are not supported. Save them as .docx/.xlsx/.pptx first.');
    default: throw new Error('Unsupported or unrecognised file type (supported: PDF, DOCX, XLSX, PPTX, HTML, CSV, TXT, MD).');
  }
  const maxChars = opts.maxChars ?? 2_000_000;
  const fix = (s) => { const t = opts.fixCjkVariants === false ? s : fixCjkVariants(s); return opts.normalize ? normalizeText(t) : t; };
  let markdown = fix(r.markdown), text = fix(r.text);
  if (markdown.length > maxChars) { markdown = markdown.slice(0, maxChars); text = text.slice(0, maxChars); r.warnings.push(`Output was truncated to ${maxChars} characters (maxChars).`); }
  if (!text.trim() && !r.warnings.length) r.warnings.push('The document contains no extractable text.');
  const out = {
    type: r.type, title: r.title ?? null, author: r.author ?? null, pages: r.pages ?? null, script: detectScript(text),
    chars: markdown.length, markdown, text, warnings: r.warnings,
  };
  if (r.sheets) out.sheets = r.sheets;
  if (r.tables !== undefined) out.tables = r.tables;
  if (r.encoding && r.encoding !== 'utf-8') out.encoding = r.encoding;
  if (r.scanned) out.scanned = true;
  if (r.emptyPages?.length) out.emptyPages = r.emptyPages;
  if (opts.includePageTexts !== false && r.pageTexts) out.pageTexts = r.pageTexts.map(fix);
  if (opts.chunkSize) out.chunks = chunkBlocks(r.blocks.map((b) => ({ ...b, text: fix(b.text) })), opts.chunkSize, opts.chunkOverlap ?? 150);
  return out;
}
