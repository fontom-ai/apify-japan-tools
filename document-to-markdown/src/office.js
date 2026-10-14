// Word / Excel / PowerPoint / HTML / plain text -> Markdown. Pure JS, no external services.
import mammoth from 'mammoth';
import ExcelJS from 'exceljs';
import { unzipSync, strFromU8 } from 'fflate';
import { NodeHtmlMarkdown } from 'node-html-markdown';
import { tidy } from './text.js';

const nhm = new NodeHtmlMarkdown({ useInlineLinks: true, maxConsecutiveNewlines: 2, ignore: ['script', 'style', 'noscript', 'svg', 'iframe', 'nav', 'header', 'footer', 'aside', 'form', 'button', 'img', 'picture', 'video', 'audio', 'canvas'] });

const DROP = ['script', 'style', 'noscript', 'svg', 'iframe', 'nav', 'header', 'footer', 'aside', 'form', 'button', 'picture', 'video', 'audio', 'canvas', 'select', 'template'];
/** Remove page furniture (navigation, headers/footers, forms, media) including its text; images are dropped too. */
export function stripBoilerplate(html) {
  let h = String(html).replace(/<!--[\s\S]*?-->/g, '');
  for (const t of DROP) { const re = new RegExp(`<${t}\\b[^>]*>[\\s\\S]*?<\\/${t}\\s*>`, 'gi'); let prev; do { prev = h; h = h.replace(re, ''); } while (h !== prev); }
  return h.replace(/<img\b[^>]*>/gi, '');
}

export function htmlToMarkdown(html) { return tidy(nhm.translate(stripBoilerplate(html))); }

const blocksFromMarkdown = (md) => md.split(/\n{2,}/).map((t) => ({ text: t, page: null })).filter((b) => b.text.trim());

export async function convertDocx(bytes) {
  const warnings = [];
  const r = await mammoth.convertToHtml({ buffer: Buffer.from(bytes) });
  for (const m of r.messages.filter((m) => !/Unrecognised (paragraph|run) style/.test(m.message)).slice(0, 5)) warnings.push(`docx: ${m.message}`);
  const markdown = htmlToMarkdown(r.value);
  const plain = (await mammoth.extractRawText({ buffer: Buffer.from(bytes) })).value;
  return { type: 'docx', markdown, text: tidy(plain), blocks: blocksFromMarkdown(markdown), warnings };
}

const cell = (v) => {
  if (v === null || v === undefined) return '';
  if (typeof v === 'object') {
    if (v.richText) return v.richText.map((t) => t.text).join('');
    if (v.result !== undefined) return String(v.result ?? '');
    if (v.text) return String(v.text);
    if (v instanceof Date) return v.toISOString().slice(0, 10);
    return String(v);
  }
  return String(v);
};
const esc = (s) => cell(s).replace(/\|/g, '\\|').replace(/\r?\n/g, ' ');

export async function convertXlsx(bytes, { maxRows = 5000 } = {}) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(bytes);
  const warnings = [], parts = [], texts = [], sheets = [];
  wb.eachSheet((ws) => {
    const rows = [];
    ws.eachRow({ includeEmpty: false }, (row) => { rows.push(row.values.slice(1).map(cell)); });
    if (!rows.length) return;
    const width = Math.max(...rows.map((r) => r.length));
    if (rows.length > maxRows) warnings.push(`Sheet "${ws.name}": only the first ${maxRows} of ${rows.length} rows were converted.`);
    const use = rows.slice(0, maxRows).map((r) => Array.from({ length: width }, (_, i) => r[i] ?? ''));
    const md = [`## ${ws.name}`, '', `| ${use[0].map(esc).join(' | ')} |`, `| ${use[0].map(() => '---').join(' | ')} |`, ...use.slice(1).map((r) => `| ${r.map(esc).join(' | ')} |`)].join('\n');
    parts.push(md);
    texts.push(`${ws.name}\n${use.map((r) => r.join('\t')).join('\n')}`);
    sheets.push({ name: ws.name, rows: rows.length, columns: width });
  });
  return { type: 'xlsx', markdown: tidy(parts.join('\n\n')), text: tidy(texts.join('\n\n')), blocks: parts.map((t, i) => ({ text: t, page: i + 1 })), sheets, pages: sheets.length, warnings };
}

const xmlText = (xml) => xml.replace(/<a:br\s*\/>/g, '\n').replace(/<\/a:p>/g, '\n').replace(/<[^>]+>/g, '').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');

export function convertPptx(bytes) {
  const files = unzipSync(new Uint8Array(bytes));
  const slideNames = Object.keys(files).filter((n) => /^ppt\/slides\/slide\d+\.xml$/.test(n)).sort((a, b) => Number(a.match(/(\d+)\.xml/)[1]) - Number(b.match(/(\d+)\.xml/)[1]));
  const md = [], texts = [], blocks = [];
  slideNames.forEach((name, i) => {
    const xml = strFromU8(files[name]);
    const paras = [];
    for (const sp of xml.split('</p:sp>')) {
      const isTitle = /<p:ph[^>]*type="(title|ctrTitle)"/.test(sp);
      const body = (sp.match(/<a:p>[\s\S]*?<\/a:p>|<a:p [\s\S]*?<\/a:p>/g) ?? []).map((p) => xmlText(p).trim()).filter(Boolean);
      for (const t of body) paras.push(isTitle ? `# ${t}` : /<a:buChar|<a:buAutoNum/.test(sp) ? `- ${t}` : t);
    }
    const notesName = `ppt/notesSlides/notesSlide${name.match(/(\d+)\.xml/)[1]}.xml`;
    const notes = files[notesName] ? xmlText(strFromU8(files[notesName])).trim() : '';
    const slide = [`<!-- slide ${i + 1} -->`, ...paras, ...(notes ? ['', `> Notes: ${notes.replace(/\n+/g, ' ')}`] : [])].join('\n\n');
    md.push(slide); texts.push(paras.map((p) => p.replace(/^(#|-)\s+/, '')).join('\n'));
    blocks.push({ text: paras.join('\n\n'), page: i + 1 });
  });
  return { type: 'pptx', markdown: tidy(md.join('\n\n')), text: tidy(texts.join('\n\n')), blocks, pages: slideNames.length, warnings: slideNames.length ? [] : ['No slides found.'] };
}

export function convertHtml(html) {
  const title = String(html).match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]?.replace(/\s+/g, ' ').trim() || null;
  const main = String(html).match(/<main[\s\S]*?<\/main>|<article[\s\S]*?<\/article>/i)?.[0] ?? String(html).match(/<body[\s\S]*<\/body>/i)?.[0] ?? html;
  const markdown = htmlToMarkdown(main);
  return { type: 'html', title, markdown, text: tidy(markdown.replace(/[#>*_`|-]+\s?/g, '')), blocks: blocksFromMarkdown(markdown), warnings: [] };
}

export function convertText(text, type = 'txt') {
  const t = tidy(text);
  return { type, markdown: t, text: t, blocks: blocksFromMarkdown(t), warnings: [] };
}
