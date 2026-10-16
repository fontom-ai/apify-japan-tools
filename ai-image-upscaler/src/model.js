// Real-ESRGAN "general x4v3" (BSD-3-Clause, xinntao/Real-ESRGAN) through ONNX Runtime on CPU.
import * as ort from 'onnxruntime-node';
import { existsSync } from 'node:fs';
import { cpus } from 'node:os';

export const MODEL_PATH = new URL('../models/real_esrgan_general_x4v3.onnx', import.meta.url);

export async function loadModel(path = MODEL_PATH) {
  if (!existsSync(path)) throw new Error('Model file missing: models/real_esrgan_general_x4v3.onnx');
  const session = await ort.InferenceSession.create(path.pathname ? decodeURIComponent(path.pathname) : path, {
    executionProviders: ['cpu'], graphOptimizationLevel: 'all', intraOpNumThreads: Math.max(1, cpus().length),
  });
  const inName = session.inputNames[0], outName = session.outputNames[0];
  const dims = session.inputMetadata?.[0]?.shape ?? session.inputMetadata?.[inName]?.shape;     // e.g. [1,3,128,128] or dynamic
  const fixed = Array.isArray(dims) && typeof dims[2] === 'number' && dims[2] > 0 ? dims[2] : null;
  const tile = fixed ?? 128;
  let scale = 4;
  return {
    tile, scale, fixedInput: fixed !== null,
    async run(chw) {
      const res = await session.run({ [inName]: new ort.Tensor('float32', chw, [1, 3, tile, tile]) });
      const t = res[outName];
      scale = Math.round(t.dims[2] / tile);
      return t.data;
    },
    get scaleFactor() { return scale; },
  };
}
