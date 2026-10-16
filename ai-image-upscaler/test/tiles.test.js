import test from 'node:test';
import assert from 'node:assert/strict';
import { upscaleRgb, nearestTile } from '../src/tiles.js';

function image(w, h) {
  const rgb = new Uint8Array(w * h * 3);
  for (let i = 0; i < w * h; i++) { rgb[i * 3] = (i * 7) % 256; rgb[i * 3 + 1] = (i * 13 + 5) % 256; rgb[i * 3 + 2] = (i * 29 + 11) % 256; }
  return rgb;
}
const reference = (rgb, w, h, s) => {
  const out = new Uint8Array(w * s * h * s * 3);
  for (let y = 0; y < h * s; y++) for (let x = 0; x < w * s; x++) for (let c = 0; c < 3; c++) out[(y * w * s + x) * 3 + c] = rgb[(Math.floor(y / s) * w + Math.floor(x / s)) * 3 + c];
  return out;
};

test('tiling + stitching reproduces a whole-image result exactly (sizes that are and are not multiples of the tile core)', async () => {
  for (const [w, h] of [[50, 40], [104, 104], [1, 1], [7, 300], [130, 5], [200, 137]]) {
    const rgb = image(w, h);
    const out = await upscaleRgb(rgb, w, h, nearestTile(64, 4), { tile: 64, pad: 8, scale: 4 });
    assert.equal(out.length, w * 4 * h * 4 * 3);
    assert.deepEqual(Buffer.from(out), Buffer.from(reference(rgb, w, h, 4)), `${w}x${h}`);
  }
});

test('progress is reported for every tile', async () => {
  const seen = [];
  await upscaleRgb(image(100, 100), 100, 100, nearestTile(64, 2), { tile: 64, pad: 8, scale: 2, onProgress: (d, t) => seen.push([d, t]) });
  assert.equal(seen.at(-1)[0], seen.at(-1)[1]);
  assert.equal(seen.length, seen.at(-1)[1]);
});

test('guards', async () => {
  await assert.rejects(() => upscaleRgb(image(10, 10), 10, 10, nearestTile(16, 4), { tile: 16, pad: 8, scale: 4 }), /too small/);
});
