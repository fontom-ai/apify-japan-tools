import { Actor } from 'apify';
import { fetchDocument } from './fetchdoc.js';
import { convertBytes } from './convert.js';

const CONCURRENCY = 3;

export async function processOne(source, opts) {
  try {
    let bytes, meta = {};
    if (typeof source === 'string') {
      const f = await fetchDocument(source, { maxBytes: opts.maxBytes });
      bytes = f.bytes; meta = { name: f.finalUrl, contentType: f.contentType };
    } else {
      bytes = Buffer.from(String(source.base64 ?? ''), 'base64');
      if (!bytes.length) throw new Error('Empty document');
      if (bytes.length > opts.maxBytes) throw new Error(`File is larger than the limit (${Math.round(opts.maxBytes / 1048576)} MB)`);
      meta = { name: source.name ?? '', contentType: source.contentType ?? '' };
    }
    const r = await convertBytes(bytes, { ...opts, ...meta });
    return { ok: true, source: typeof source === 'string' ? source : (source.name ?? 'inline'), bytes: bytes.length, ...r };
  } catch (e) {
    return { ok: false, source: typeof source === 'string' ? source : (source?.name ?? 'inline'), error: String(e.message ?? e).slice(0, 300) };
  }
}

await Actor.init();
const input = (await Actor.getInput()) ?? {};
const urls = (Array.isArray(input.urls) ? input.urls : []).map((u) => String(u?.url ?? u).trim()).filter(Boolean);
const docs = Array.isArray(input.documents) ? input.documents.filter((d) => d && d.base64) : [];
const sources = [...urls, ...docs];
const opts = {
  chunkSize: Number(input.chunkSize ?? 0) || 0, chunkOverlap: Number(input.chunkOverlap ?? 150), maxPages: Number(input.maxPages ?? 500),
  includePageTexts: input.includePageTexts !== false, normalize: input.normalize === true, fixCjkVariants: input.fixCjkVariants !== false,
  maxChars: Number(input.maxChars ?? 2000000), maxBytes: Math.min(Number(input.maxFileMb ?? 50), 100) * 1024 * 1024,
};
if (!sources.length) await Actor.fail('Provide at least one document URL in "urls" (or base64 files in "documents").');
else if (sources.length > 5000) await Actor.fail('At most 5,000 documents per run.');
else {
  let next = 0, stop = false, done = 0, charged = 0;
  const worker = async () => {
    while (!stop) {
      const i = next++;
      if (i >= sources.length) return;
      const out = await processOne(sources[i], opts);
      const r = await Actor.pushData(out);   // priced as apify-default-dataset-item: every row written is charged, failures included
      done++; if (out.ok) charged++;
      if (r?.eventChargeLimitReached) { stop = true; console.warn(`Spending limit reached after ${done} documents; stopping.`); }
    }
  };
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, sources.length) }, worker));
  console.log(`Done: ${done} document(s) processed, ${charged} converted.`);
}
await Actor.exit();
