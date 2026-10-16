import sharp from 'sharp';
import { upscaleRgb } from './tiles.js';

export async function upscaleOne(model, bytes, o) {
  const t0 = Date.now();
  let img = sharp(bytes, { failOn: 'none', limitInputPixels: 268402689 }).rotate();            // honour EXIF orientation
  const meta = await img.metadata();
  if (!meta.width || !meta.height) throw new Error('Not a readable image');
  const warnings = [];
  const oriented = meta.orientation && meta.orientation >= 5;                                   // EXIF 5-8 swap width and height
  let w = oriented ? meta.height : meta.width, h = oriented ? meta.width : meta.height;
  const origW = w, origH = h;
  const mp = (w * h) / 1e6;
  if (mp > o.maxInputMegapixels) {
    const k = Math.sqrt(o.maxInputMegapixels / mp);
    w = Math.max(1, Math.floor(w * k)); h = Math.max(1, Math.floor(h * k));
    img = img.resize(w, h, { kernel: 'lanczos3' });
    warnings.push(`Input was ${mp.toFixed(1)} MP; it was reduced to ${(w * h / 1e6).toFixed(1)} MP first (maxInputMegapixels) to keep the run time bounded.`);
  }
  const hasAlpha = Boolean(meta.hasAlpha);
  const { data: rgbRaw, info } = await img.clone().removeAlpha().raw().toBuffer({ resolveWithObject: true });   // RGB after rotation/resize
  w = info.width; h = info.height;
  const S = model.scaleFactor ?? 4;
  const up = await upscaleRgb(rgbRaw, w, h, (chw) => model.run(chw), { tile: model.tile, pad: Math.min(12, Math.floor(model.tile / 8)), scale: 4 });
  const sf = model.scaleFactor ?? S;
  const outW = w * sf, outH = h * sf;
  let pipe = sharp(Buffer.from(up.buffer, up.byteOffset, up.length), { raw: { width: outW, height: outH, channels: 3 } });
  const target = o.scale; // 2 or 4
  const finalW = w * target, finalH = h * target;
  if (target !== sf) pipe = pipe.resize(finalW, finalH, { kernel: 'lanczos3' });
  if (hasAlpha) {                                                                                  // keep transparency: enlarge the alpha plane normally
    const alpha = await img.clone().extractChannel('alpha').resize(finalW, finalH, { kernel: 'lanczos3' }).raw().toBuffer();
    const rgbFinal = await pipe.raw().toBuffer();
    const rgba = Buffer.alloc(finalW * finalH * 4);
    for (let i = 0; i < finalW * finalH; i++) { rgba[i * 4] = rgbFinal[i * 3]; rgba[i * 4 + 1] = rgbFinal[i * 3 + 1]; rgba[i * 4 + 2] = rgbFinal[i * 3 + 2]; rgba[i * 4 + 3] = alpha[i]; }
    pipe = sharp(rgba, { raw: { width: finalW, height: finalH, channels: 4 } });
  }
  const fmt = hasAlpha && o.format === 'jpg' ? 'png' : o.format;
  if (fmt !== o.format) warnings.push('The image has transparency, so PNG was used instead of JPG.');
  const outBuf = await (fmt === 'png' ? pipe.png({ compressionLevel: 6 }) : fmt === 'webp' ? pipe.webp({ quality: o.quality }) : pipe.jpeg({ quality: o.quality, mozjpeg: true })).toBuffer();
  return { buffer: outBuf, format: fmt, inputWidth: origW, inputHeight: origH, outputWidth: finalW, outputHeight: finalH, warnings, seconds: Math.round((Date.now() - t0) / 100) / 10 };
}

