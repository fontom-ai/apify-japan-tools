// Text helpers shared by all converters: script detection, Unicode normalisation, paragraph-aware chunking.

/** 'ja' | 'ko' | 'zh' | 'latin' | 'other' | 'unknown' from the characters actually present (no network, no guessing models). */
export function detectScript(text) {
  const s = String(text ?? '').slice(0, 20000);
  let kana = 0, han = 0, hangul = 0, latin = 0, other = 0;
  for (const ch of s) {
    const c = ch.codePointAt(0);
    if ((c >= 0x3040 && c <= 0x30ff) || (c >= 0xff66 && c <= 0xff9f)) kana++;
    else if ((c >= 0x4e00 && c <= 0x9fff) || (c >= 0x3400 && c <= 0x4dbf)) han++;
    else if ((c >= 0xac00 && c <= 0xd7af) || (c >= 0x1100 && c <= 0x11ff)) hangul++;
    else if ((c >= 0x41 && c <= 0x5a) || (c >= 0x61 && c <= 0x7a) || (c >= 0xc0 && c <= 0x24f)) latin++;
    else if (c > 0x2fff && !/\s/.test(ch)) other++;
  }
  const total = kana + han + hangul + latin + other;
  if (total < 5) return 'unknown';
  if (kana / total > 0.05) return 'ja';
  if (hangul / total > 0.1) return 'ko';
  if (han / total > 0.3) return 'zh';
  if (latin / total > 0.5) return 'latin';
  return 'other';
}

export const isCjk = (script) => script === 'ja' || script === 'zh' || script === 'ko';

/** Optional NFKC: full-width letters/digits -> ASCII, half-width kana -> full-width, ㈱ -> (株). Off by default. */
export function normalizeText(s) { return String(s).normalize('NFKC'); }

/**
 * Many PDFs map glyphs to Kangxi radicals / CJK compatibility forms (⽇ U+2F47 instead of 日, ⺠ instead of 民), which
 * breaks search and RAG matching. Fold exactly those code points to their normal ideographs (other text is untouched).
 */
const RADICAL_SUPPLEMENT = { '\u2e9f': '母', '\u2ea0': '民', '\u2ed1': '長', '\u2ed8': '青', '\u2ee4': '鬼', '\u2ee9': '黄', '\u2ee8': '麦',
  '\u2eef': '竜', '\u2ef2': '亀', '\u2eed': '歯', '\u2eeb': '斉', '\u2ec4': '西', '\u2ed4': '門', '\u2edd': '食', '\u2eab': '目', '\u2ed7': '雨' };

export function fixCjkVariants(s) {
  return String(s).replace(/[\u2e80-\u2eff\u2f00-\u2fdf\uf900-\ufaff\u{2f800}-\u{2fa1f}]/gu, (c) => RADICAL_SUPPLEMENT[c] ?? c.normalize('NFKC'));
}

/** Collapse runs of blank lines, trim trailing spaces. */
export function tidy(md) {
  return String(md).replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
}

const SENTENCE_END = /(?<=[。．！？!?]|[.](?=\s))/;

/**
 * Split text into chunks of at most `size` characters with `overlap` characters carried over.
 * Boundaries prefer paragraphs, then sentences, then a hard cut. `blocks` = [{text, page?}] keeps page numbers.
 * Returns [{index, text, chars, pages: [first, last] | null}].
 */
export function chunkBlocks(blocks, size = 1500, overlap = 150) {
  if (!size || size < 100) return [];
  overlap = Math.max(0, Math.min(overlap, Math.floor(size / 3)));
  const units = [];
  for (const b of blocks) {
    const t = b.text.trim();
    if (!t) continue;
    if (t.length <= size) { units.push({ text: t, page: b.page ?? null }); continue; }
    let buf = '';
    for (const sent of t.split(SENTENCE_END)) {
      if (sent.length > size) {                                    // a "sentence" longer than a chunk: hard cut
        if (buf) { units.push({ text: buf, page: b.page ?? null }); buf = ''; }
        for (let i = 0; i < sent.length; i += size) units.push({ text: sent.slice(i, i + size), page: b.page ?? null });
      } else if ((buf + sent).length > size) { units.push({ text: buf, page: b.page ?? null }); buf = sent; }
      else buf += sent;
    }
    if (buf.trim()) units.push({ text: buf, page: b.page ?? null });
  }
  const chunks = [];
  let cur = '', pages = [];
  const flush = () => {
    if (!cur.trim()) return;
    const ps = pages.filter((p) => p !== null);
    chunks.push({ index: chunks.length, text: cur.trim(), chars: cur.trim().length, pages: ps.length ? [Math.min(...ps), Math.max(...ps)] : null });
  };
  for (const u of units) {
    if (cur.trim() && (cur.length + u.text.length + 2) > size) {
      flush();
      const tail = overlap ? cur.slice(-overlap) : '';
      cur = tail && tail.length + u.text.length + 2 <= size ? `${tail}\n\n` : '';   // overlap only when it still fits
      pages = [];
    }
    cur += (cur && !cur.endsWith('\n\n') ? '\n\n' : '') + u.text;
    pages.push(u.page);
  }
  flush();
  return chunks;
}

/**
 * Bytes -> string for HTML / CSV / TXT / MD. Japanese sites and government CSV files are often Shift_JIS (Windows-31J)
 * or EUC-JP, so UTF-8 is not assumed: BOM, then the declared charset (HTTP header or <meta>), then a strict UTF-8 try,
 * then Shift_JIS. Returns {text, encoding}.
 */
export function decodeText(bytes, contentType = '') {
  const b = Buffer.from(bytes);
  const tryDecode = (label, fatal = false) => { try { return new TextDecoder(label, { fatal }).decode(b); } catch { return null; } };
  if (b[0] === 0xef && b[1] === 0xbb && b[2] === 0xbf) return { text: b.subarray(3).toString('utf8'), encoding: 'utf-8' };
  if (b[0] === 0xff && b[1] === 0xfe) return { text: tryDecode('utf-16le') ?? '', encoding: 'utf-16le' };
  if (b[0] === 0xfe && b[1] === 0xff) return { text: tryDecode('utf-16be') ?? '', encoding: 'utf-16be' };
  const head = b.subarray(0, 4096).toString('latin1');
  const declared = (/charset\s*=\s*["']?([\w-]+)/i.exec(contentType)?.[1] ?? /<meta[^>]+charset\s*=\s*["']?([\w-]+)/i.exec(head)?.[1] ?? '').toLowerCase();
  if (declared && !/^utf-?8$/.test(declared)) {
    const label = /^(x-)?sjis$|^shift[-_]?jis$|^ms_?kanji$|^windows-31j$|^cp932$/.test(declared) ? 'shift_jis' : declared;
    const t = tryDecode(label);
    if (t !== null) return { text: t, encoding: label };
  }
  const utf8 = tryDecode('utf-8', true);
  if (utf8 !== null) return { text: utf8, encoding: 'utf-8' };
  const sjis = tryDecode('shift_jis');
  if (sjis !== null && !sjis.includes('\ufffd')) return { text: sjis, encoding: 'shift_jis' };
  const euc = tryDecode('euc-jp');
  if (euc !== null && !euc.includes('\ufffd')) return { text: euc, encoding: 'euc-jp' };
  return { text: b.toString('utf8'), encoding: 'utf-8 (lossy)' };
}
