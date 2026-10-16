import test from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import { loadModel } from '../src/model.js';
import { upscaleOne } from '../src/upscale.js';

const model = await loadModel();
const O = { scale: 4, format: 'png', quality: 90, maxInputMegapixels: 4 };

async function pattern(w, h, channels = 3) {
  const raw = Buffer.alloc(w * h * channels);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = (y * w + x) * channels;
    const on = ((x >> 3) + (y >> 3)) % 2;
    raw[i] = on ? 230 : 40; raw[i + 1] = (x * 255 / w) | 0; raw[i + 2] = (y * 255 / h) | 0;
    if (channels === 4) raw[i + 3] = x < w / 2 ? 255 : 0;       // left half opaque, right half transparent
  }
  return sharp(raw, { raw: { width: w, height: h, channels } }).png().toBuffer();
}

test('model loads with a fixed 128px tile and x4 output', () => { assert.equal(model.tile, 128); assert.equal(model.fixedInput, true); });

test('4x: size, format and content (not blank, not just noise)', async () => {
  const r = await upscaleOne(model, await pattern(96, 64), O);
  assert.equal(r.outputWidth, 384); assert.equal(r.outputHeight, 256);
  const meta = await sharp(r.buffer).metadata();
  assert.equal(meta.width, 384); assert.equal(meta.format, 'png');
  const { channels } = await sharp(r.buffer).stats();
  assert.ok(channels[0].stdev > 30, 'checker pattern must still be there');
  assert.ok(channels[1].mean > 100 && channels[1].mean < 155, 'green gradient keeps its mean');
});

test('2x gives half the 4x size and a non-multiple-of-tile input works', async () => {
  const r = await upscaleOne(model, await pattern(101, 77), { ...O, scale: 2 });
  assert.equal(r.outputWidth, 202); assert.equal(r.outputHeight, 154);
  assert.equal((await sharp(r.buffer).metadata()).width, 202);
});

test('transparency is kept (alpha enlarged, jpg request falls back to png with a warning)', async () => {
  const r = await upscaleOne(model, await pattern(64, 64, 4), { ...O, format: 'jpg' });
  const meta = await sharp(r.buffer).metadata();
  assert.equal(meta.format, 'png'); assert.equal(meta.hasAlpha, true);
  assert.match(r.warnings.join(' '), /transparency/);
  const raw = await sharp(r.buffer).raw().toBuffer();
  const a = (x, y) => raw[(y * 256 + x) * 4 + 3];
  assert.equal(a(20, 128), 255); assert.equal(a(236, 128), 0);
});

test('jpg and webp output', async () => {
  for (const f of ['jpg', 'webp']) {
    const r = await upscaleOne(model, await pattern(64, 64), { ...O, format: f });
    assert.equal((await sharp(r.buffer).metadata()).format, f === 'jpg' ? 'jpeg' : 'webp');
  }
});

test('oversize input is reduced first, with a warning', async () => {
  const r = await upscaleOne(model, await pattern(400, 300), { ...O, maxInputMegapixels: 0.05 });
  assert.match(r.warnings.join(' '), /reduced/);
  assert.ok(r.inputWidth === 400 && r.outputWidth < 400 * 4);
});

test('EXIF orientation is honoured', async () => {
  const raw = await sharp(await pattern(80, 40)).jpeg().withMetadata({ orientation: 6 }).toBuffer();   // rotate 90° on display
  const r = await upscaleOne(model, raw, O);
  assert.equal(r.outputWidth, 40 * 4); assert.equal(r.outputHeight, 80 * 4);
});

test('garbage input gives a readable error', async () => {
  await assert.rejects(() => upscaleOne(model, Buffer.from('not an image'), O));
});

test('thread count follows the Actor memory (about 1 vCPU per 4 GB)', async () => {
  const { cpuThreads } = await import('../src/model.js');
  assert.equal(cpuThreads({ ACTOR_MEMORY_MBYTES: '1024' }, 12), 1);
  assert.equal(cpuThreads({ ACTOR_MEMORY_MBYTES: '4096' }, 12), 1);
  assert.equal(cpuThreads({ ACTOR_MEMORY_MBYTES: '8192' }, 12), 2);
  assert.equal(cpuThreads({}, 12), 12);
});
