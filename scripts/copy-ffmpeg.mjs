// Copies ffmpeg.wasm into public/engine/vendor so it is served from the same
// origin as the engine page (required for its Web Worker).
import { cpSync, mkdirSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const vendor = join(root, 'public', 'engine', 'vendor');
const pkgDir = (name) => join(root, 'node_modules', name);

rmSync(vendor, { recursive: true, force: true });
mkdirSync(vendor, { recursive: true });
cpSync(join(pkgDir('@ffmpeg/ffmpeg'), 'dist', 'esm'), join(vendor, 'ffmpeg'), {
  recursive: true,
  filter: (src) => !src.endsWith('.d.ts') && !src.endsWith('.d.mts'),
});
cpSync(join(pkgDir('@ffmpeg/core'), 'dist', 'esm'), join(vendor, 'core'), { recursive: true });
console.log('ffmpeg.wasm copied to public/engine/vendor');
