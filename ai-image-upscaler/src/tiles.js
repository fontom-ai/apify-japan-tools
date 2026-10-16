// Tile-based super-resolution plumbing. The model only ever sees fixed-size tiles; this file cuts the image into
// overlapping tiles, runs a model function on each, and stitches the centres back together (no visible seams).

/**
 * @param {Uint8Array|Uint8ClampedArray} rgb  interleaved RGB, length w*h*3
 * @param {number} w @param {number} h
 * @param {(chw: Float32Array) => Promise<Float32Array>|Float32Array} runTile  CHW float [0,1] (3*T*T) -> CHW (3*(T*S)*(T*S))
 * @param {{tile:number, pad:number, scale:number, onProgress?:(done:number,total:number)=>void}} o
 * @returns {Promise<Uint8Array>} interleaved RGB of size (w*S)*(h*S)*3
 */
export async function upscaleRgb(rgb, w, h, runTile, { tile = 128, pad = 12, scale = 4, onProgress } = {}) {
  const core = tile - 2 * pad;                         // pixels of each tile that are kept
  if (core < 8) throw new Error('tile too small for the chosen padding');
  const W = w * scale, H = h * scale;
  const out = new Uint8Array(W * H * 3);
  const nx = Math.ceil(w / core), ny = Math.ceil(h / core), total = nx * ny;
  const clampX = (x) => (x < 0 ? -x : x >= w ? 2 * w - 2 - x : x);          // mirror at the borders
  const clampY = (y) => (y < 0 ? -y : y >= h ? 2 * h - 2 - y : y);
  const safeX = (x) => Math.max(0, Math.min(w - 1, clampX(x)));
  const safeY = (y) => Math.max(0, Math.min(h - 1, clampY(y)));
  const inp = new Float32Array(3 * tile * tile);
  let done = 0;
  for (let ty = 0; ty < ny; ty++) {
    for (let tx = 0; tx < nx; tx++) {
      const x0 = tx * core - pad, y0 = ty * core - pad;
      for (let y = 0; y < tile; y++) {
        const sy = safeY(y0 + y);
        for (let x = 0; x < tile; x++) {
          const si = (sy * w + safeX(x0 + x)) * 3, di = y * tile + x;
          inp[di] = rgb[si] / 255;
          inp[tile * tile + di] = rgb[si + 1] / 255;
          inp[2 * tile * tile + di] = rgb[si + 2] / 255;
        }
      }
      const res = await runTile(inp);
      const T = tile * scale, plane = T * T;
      const cw = Math.min(core, w - tx * core), ch = Math.min(core, h - ty * core);   // kept area (edge tiles are smaller)
      for (let y = 0; y < ch * scale; y++) {
        const oy = ty * core * scale + y, sy = pad * scale + y;
        for (let x = 0; x < cw * scale; x++) {
          const ox = tx * core * scale + x, sx = pad * scale + x;
          const oi = (oy * W + ox) * 3, si = sy * T + sx;
          out[oi] = clamp8(res[si]);
          out[oi + 1] = clamp8(res[plane + si]);
          out[oi + 2] = clamp8(res[2 * plane + si]);
        }
      }
      onProgress?.(++done, total);
    }
  }
  return out;
}

const clamp8 = (v) => (v <= 0 ? 0 : v >= 1 ? 255 : Math.round(v * 255));

/** Reference "model" for tests and fallbacks: nearest-neighbour x`scale` in CHW layout. */
export function nearestTile(tile, scale) {
  return (chw) => {
    const T = tile * scale, out = new Float32Array(3 * T * T);
    for (let c = 0; c < 3; c++) for (let y = 0; y < T; y++) for (let x = 0; x < T; x++) {
      out[c * T * T + y * T + x] = chw[c * tile * tile + Math.floor(y / scale) * tile + Math.floor(x / scale)];
    }
    return out;
  };
}
