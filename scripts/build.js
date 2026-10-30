// Builds the static site into dist/: the page, game code and the pinned
// vendor libraries, at the same paths the dev server uses. No bundler is
// needed: the browser loads the ES modules directly.
import fs from 'node:fs';
import path from 'node:path';
import { ROOT, SITE } from './layout.js';

const DIST = path.join(ROOT, 'dist');
const SKIP = new Set(['.DS_Store']);

fs.rmSync(DIST, { recursive: true, force: true });
let files = 0;
let bytes = 0;

function copy(from, to) {
  const st = fs.statSync(from);
  if (st.isDirectory()) {
    for (const name of fs.readdirSync(from)) {
      if (SKIP.has(name) || name.endsWith('.map')) continue;
      copy(path.join(from, name), path.join(to, name));
    }
    return;
  }
  fs.mkdirSync(path.dirname(to), { recursive: true });
  fs.copyFileSync(from, to);
  files++;
  bytes += st.size;
}

for (const e of SITE) {
  if (!fs.existsSync(e.from)) {
    console.error(`Missing ${e.from}. Did you run "npm install"?`);
    process.exit(1);
  }
  copy(e.from, path.join(DIST, e.url));
}
// client/index.html is served as the site root; drop the duplicate copy.
fs.rmSync(path.join(DIST, 'client/index.html'), { force: true });
console.log(`Built dist/: ${files} files, ${(bytes / 1024 / 1024).toFixed(1)} MB.`);
