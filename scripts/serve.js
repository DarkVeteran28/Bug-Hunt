// A tiny static file server for local play and testing. It only serves files;
// there is no game logic or API here.
//   node scripts/serve.js          serve the source tree (development)
//   node scripts/serve.js --dist   serve the built dist/ folder
//   PORT=8080 HOST=0.0.0.0 node scripts/serve.js --dist
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ROOT, TYPES, resolveSource } from './layout.js';

const useDist = process.argv.includes('--dist');
const DIST = path.join(ROOT, 'dist');
const PORT = Number(process.env.PORT || 3000);
const HOST = process.env.HOST || '127.0.0.1';

if (useDist && !fs.existsSync(path.join(DIST, 'index.html'))) {
  console.error('dist/ is missing. Run "npm run build" first.');
  process.exit(1);
}

function fileFor(urlPath) {
  if (!useDist) return resolveSource(urlPath);
  const clean = urlPath.replace(/^\/+/, '') || 'index.html';
  const file = path.resolve(DIST, clean);
  return file === DIST || file.startsWith(DIST + path.sep) ? file : null;
}

export function createServer() {
  return http.createServer((req, res) => {
    let urlPath;
    try {
      urlPath = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    } catch {
      res.writeHead(400).end('Bad request');
      return;
    }
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.writeHead(405, { Allow: 'GET, HEAD' }).end();
      return;
    }
    const file = fileFor(urlPath);
    fs.stat(file || '', (err, st) => {
      if (err || !st.isFile()) {
        res.writeHead(404, { 'Content-Type': 'text/plain' }).end('Not found');
        return;
      }
      res.writeHead(200, {
        'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream',
        'Content-Length': st.size,
        'Cache-Control': useDist ? 'public, max-age=300' : 'no-store',
        'X-Content-Type-Options': 'nosniff',
      });
      if (req.method === 'HEAD') res.end();
      else fs.createReadStream(file).pipe(res);
    });
  });
}

// Start only when run directly (not when imported by the browser test).
// Compare file paths, not URLs, so Windows paths (C:\...) match too.
const norm = (p) => (process.platform === 'win32' ? path.resolve(p).toLowerCase() : path.resolve(p));
if (process.argv[1] && norm(fileURLToPath(import.meta.url)) === norm(process.argv[1])) {
  createServer().listen(PORT, HOST, () => {
    console.log(`Vice City: Bug Hunt 3D (${useDist ? 'dist' : 'source'}) at http://${HOST === '0.0.0.0' ? 'localhost' : HOST}:${PORT} (open it in your browser; Ctrl+C stops it)`);
  });
}
