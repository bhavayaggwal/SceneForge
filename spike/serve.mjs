// Day-1 spike server: serves spike/ pages, data/scenes/ splats, and saves captured views.
// Usage: node spike/serve.mjs  → http://127.0.0.1:5173/viewer.html?scene=room.ply
import { createServer } from 'node:http';
import { createReadStream, existsSync, mkdirSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { extname, join, normalize, resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname);
const SCENES = resolve(ROOT, '..', 'data', 'scenes');
const OUT = join(ROOT, 'out');
const PORT = 5173;
mkdirSync(OUT, { recursive: true });

const TYPES = {
  '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.json': 'application/json',
  '.png': 'image/png', '.ply': 'application/octet-stream', '.spz': 'application/octet-stream', '.splat': 'application/octet-stream',
};

function safeJoin(base, rel) {
  const p = normalize(join(base, decodeURIComponent(rel)));
  return p.startsWith(base) ? p : null;
}

function readBody(req) {
  return new Promise((ok, fail) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => ok(Buffer.concat(chunks)));
    req.on('error', fail);
  });
}

createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);

  // POST /capture  { png: dataURL, camera: {...} } → out/view-N.png + out/view-N.json
  if (req.method === 'POST' && url.pathname === '/capture') {
    const { png, camera } = JSON.parse((await readBody(req)).toString());
    const n = readdirSync(OUT).filter((f) => f.endsWith('.png')).length + 1;
    const name = `view-${n}`;
    writeFileSync(join(OUT, `${name}.png`), Buffer.from(png.split(',')[1], 'base64'));
    writeFileSync(join(OUT, `${name}.json`), JSON.stringify(camera, null, 2));
    res.writeHead(200, { 'content-type': 'application/json' });
    return res.end(JSON.stringify({ name }));
  }

  const file = url.pathname.startsWith('/scenes/')
    ? safeJoin(SCENES, url.pathname.slice('/scenes/'.length))
    : safeJoin(ROOT, url.pathname === '/' ? 'viewer.html' : url.pathname.slice(1));
  if (!file || !existsSync(file) || !statSync(file).isFile()) {
    res.writeHead(404);
    return res.end('not found');
  }
  res.writeHead(200, { 'content-type': TYPES[extname(file).toLowerCase()] || 'application/octet-stream' });
  createReadStream(file).pipe(res);
}).listen(PORT, '127.0.0.1', () => console.log(`spike server on http://127.0.0.1:${PORT}/viewer.html?scene=room.ply`));
