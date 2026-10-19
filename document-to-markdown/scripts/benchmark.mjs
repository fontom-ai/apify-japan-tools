// Convert every document in a folder and print what came out (for checking quality on real files by hand).
// usage: node scripts/benchmark.mjs <input-dir> <output-dir>
import { readdirSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { convertBytes } from '../src/convert.js';

const [inDir, outDir] = process.argv.slice(2);
if (!inDir || !outDir) { console.error('usage: node scripts/benchmark.mjs <input-dir> <output-dir>'); process.exit(2); }
mkdirSync(outDir, { recursive: true });
for (const f of readdirSync(inDir).sort()) {
  const bytes = readFileSync(join(inDir, f));
  const t0 = Date.now();
  try {
    const r = await convertBytes(bytes, { name: f });
    writeFileSync(join(outDir, `${f}.md`), r.markdown);
    console.log(`${f.padEnd(28)} ${String(r.pages ?? '-').padStart(4)}p ${String(r.tables ?? '-').padStart(3)} tables ${String(r.chars).padStart(8)} chars ${String(Date.now() - t0).padStart(6)} ms ${r.script} ${r.warnings.length ? '⚠ ' + r.warnings.join(' / ').slice(0, 90) : ''}`);
  } catch (e) { console.log(`${f.padEnd(28)} ERROR ${e.message}`); }
}
