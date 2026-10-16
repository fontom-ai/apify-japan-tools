import { Actor } from 'apify';
import { fetchDocument } from './fetchimage.js';
import { loadModel } from './model.js';
import { upscaleOne } from './upscale.js';

const FORMATS = { png: 'image/png', jpg: 'image/jpeg', webp: 'image/webp' };

await Actor.init();
const input = (await Actor.getInput()) ?? {};
const urls = (Array.isArray(input.urls) ? input.urls : []).map((u) => String(u?.url ?? u).trim()).filter(Boolean);
const files = Array.isArray(input.images) ? input.images.filter((d) => d && d.base64) : [];
const sources = [...urls, ...files];
const opts = {
  scale: Number(input.scale) === 2 ? 2 : 4,
  format: ['png', 'jpg', 'webp'].includes(input.outputFormat) ? input.outputFormat : 'png',
  quality: Math.min(100, Math.max(40, Number(input.quality ?? 92))),
  maxInputMegapixels: Math.min(8, Math.max(0.1, Number(input.maxInputMegapixels ?? 4))),
};
if (!sources.length) await Actor.fail('Provide at least one image URL in "urls" (or base64 images in "images").');
else if (sources.length > 500) await Actor.fail('At most 500 images per run.');
else {
  const model = await loadModel();
  const store = await Actor.openKeyValueStore();
  let n = 0;
  for (const src of sources) {
    n++;
    const name = typeof src === 'string' ? src : (src.name ?? `inline-${n}`);
    let row;
    try {
      let bytes;
      if (typeof src === 'string') bytes = (await fetchDocument(src, { maxBytes: 30 * 1024 * 1024 })).bytes;
      else { bytes = Buffer.from(String(src.base64), 'base64'); if (!bytes.length) throw new Error('Empty image'); }
      const r = await upscaleOne(model, bytes, opts);
      const key = `upscaled-${String(n).padStart(4, '0')}.${r.format}`;
      await store.setValue(key, r.buffer, { contentType: FORMATS[r.format] });
      row = { ok: true, source: name, outputUrl: store.getPublicUrl(key), key, format: r.format, inputWidth: r.inputWidth, inputHeight: r.inputHeight,
        outputWidth: r.outputWidth, outputHeight: r.outputHeight, scale: opts.scale, bytes: r.buffer.length, seconds: r.seconds, warnings: r.warnings };
    } catch (e) { row = { ok: false, source: name, error: String(e.message ?? e).slice(0, 300) }; }
    const res = await Actor.pushData(row, row.ok ? 'result' : undefined);                          // failures are free
    if (res?.eventChargeLimitReached) { console.warn('Spending limit reached; stopping.'); break; }
  }
}
await Actor.exit();
