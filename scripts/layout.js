// Which files make up the static site, shared by the dev server and the build.
// Paths on the left are URLs (relative to the site root); paths on the right
// are folders or files in this repository.
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const nm = (p) => path.join(ROOT, 'node_modules', p);

export const SITE = [
  { url: 'index.html', from: path.join(ROOT, 'client/index.html') },
  { url: 'client/', from: path.join(ROOT, 'client') },
  { url: 'engine/', from: path.join(ROOT, 'engine') },
  { url: 'shared/', from: path.join(ROOT, 'shared') },
  { url: 'challenges/', from: path.join(ROOT, 'challenges') },
  { url: 'vendor/three/three.module.js', from: nm('three/build/three.module.js') },
  { url: 'vendor/three/three.core.js', from: nm('three/build/three.core.js') },
  { url: 'vendor/three-addons/utils/BufferGeometryUtils.js', from: nm('three/examples/jsm/utils/BufferGeometryUtils.js') },
  { url: 'vendor/rapier/rapier.mjs', from: nm('@dimforge/rapier3d-compat/rapier.mjs') },
  { url: 'vendor/monaco/', from: nm('monaco-editor/min') },
  { url: 'LICENSES.txt', from: path.join(ROOT, 'LICENSES.txt') },
];

export const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.wasm': 'application/wasm',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ttf': 'font/ttf',
  '.txt': 'text/plain; charset=utf-8',
};

/** Map a URL path ("client/src/main.js") to a file on disk, or null. */
export function resolveSource(urlPath) {
  const clean = urlPath.replace(/^\/+/, '') || 'index.html';
  for (const e of SITE) {
    if (e.url.endsWith('/')) {
      if (!clean.startsWith(e.url)) continue;
      const file = path.resolve(e.from, clean.slice(e.url.length));
      // Never leave the mapped folder (no "../" tricks).
      if (file !== e.from && !file.startsWith(e.from + path.sep)) return null;
      return file;
    }
    if (clean === e.url) return e.from;
  }
  return null;
}
