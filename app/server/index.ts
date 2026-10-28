// SceneForge server: scenes, the object index, pins, the agent, capture jobs, and the bridge
// to open viewers. Serves the built app from dist/ in production; `npm run dev` puts Vite in front.
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { createReadStream, createWriteStream, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { basename, extname, join, normalize, resolve } from 'node:path';
import { pipeline as streamPipeline } from 'node:stream/promises';
import { randomUUID } from 'node:crypto';
import { mergeSightings } from '../shared/merge.ts';
import type { Sighting, ViewerCommand } from '../shared/types.ts';
import { ask } from './agent.ts';
import * as bridge from './bridge.ts';
import { jobs, messages, objects, pins, scenes } from './db.ts';
import { holdAwake } from './keepawake.ts';
import { clearScanViews, saveScanView } from './views.ts';
import { detect, status as ollamaStatus } from './ollama.ts';
import { DIST_DIR, JOBS_DIR, REPO_ROOT, SCENES_DIR, VIEWS_DIR } from './paths.ts';
import { videoToSplat } from './pipeline.ts';
import { findTools } from './tools.ts';

export const PORT = Number(process.env.SF_PORT ?? 5180);
const SPLAT_EXT = ['.ply', '.spz', '.splat', '.ksplat'];
const VIDEO_EXT = ['.mp4', '.mov', '.m4v', '.webm', '.mkv', '.avi'];
const MAX_UPLOAD = 4 * 1024 ** 3;

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.woff2': 'font/woff2', '.wasm': 'application/wasm',
};

class HttpError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

function json(res: ServerResponse, status: number, body: unknown) {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify(body));
}

async function body<T = any>(req: IncomingMessage, limit = 32 * 1024 * 1024): Promise<T> {
  const chunks: Buffer[] = [];
  let n = 0;
  for await (const c of req) {
    n += c.length;
    if (n > limit) throw new HttpError(413, 'Request too large');
    chunks.push(c);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString() || '{}');
  } catch {
    throw new HttpError(400, 'Body is not JSON');
  }
}

/** Streams an upload straight to disk; the old pipeline read whole videos into RAM. */
async function saveUpload(req: IncomingMessage, dest: string): Promise<number> {
  const declared = Number(req.headers['content-length'] ?? 0);
  if (declared > MAX_UPLOAD) throw new HttpError(413, 'Files over 4 GB are not supported');
  const tmp = `${dest}.part`;
  await streamPipeline(req, createWriteStream(tmp));
  renameSync(tmp, dest);
  return statSync(dest).size;
}

function sendFile(res: ServerResponse, file: string, type?: string) {
  if (!existsSync(file)) throw new HttpError(404, 'File not found');
  res.writeHead(200, { 'content-type': type ?? MIME[extname(file).toLowerCase()] ?? 'application/octet-stream', 'content-length': statSync(file).size });
  createReadStream(file).pipe(res);
}

function slug(name: string) {
  return name.toLowerCase().replace(/\.[a-z0-9]+$/, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'scene';
}

function prettyName(file: string) {
  const s = basename(file).replace(/\.[a-z0-9]+$/i, '').replace(/[-_]+/g, ' ').trim();
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function scenePublic(id: string) {
  const s = scenes.get(id);
  if (!s) throw new HttpError(404, 'No such scene');
  return { ...s, file: undefined, url: `/api/scenes/${s.id}/file${extname(s.file)}`, thumb: s.thumb ? `/api/scenes/${s.id}/thumb?v=${encodeURIComponent(s.thumb)}` : null };
}

/** Registers splats found in data/scenes/ (samples the setup script downloaded) once. */
function seedSamples() {
  const dir = join(REPO_ROOT, 'data', 'scenes');
  if (!existsSync(dir)) return;
  const known = new Set(scenes.list().map((s) => s.file));
  const names: Record<string, string> = { 'room.ply': 'Living room', 'dining-room.ply': 'Dining room' };
  for (const f of readdirSync(dir)) {
    const file = join(dir, f);
    if (!SPLAT_EXT.includes(extname(f).toLowerCase()) || known.has(file)) continue;
    // A sample reconstructed from video may ship its camera path beside it: <name>.cameras.json
    const camFile = join(dir, `${basename(f, extname(f))}.cameras.json`);
    const cameras = existsSync(camFile) ? JSON.parse(readFileSync(camFile, 'utf8')) : null;
    scenes.insert({ id: `${slug(f)}-${randomUUID().slice(0, 4)}`, name: names[f] ?? prettyName(f), file, format: extname(f).slice(1), source: 'sample', bytes: statSync(file).size, cameras });
  }
}

async function runVideoJob(jobId: string, video: string, name: string, steps: number) {
  // The pipeline wipes its work dir, so it gets a subfolder and the uploaded video stays put.
  const workDir = join(JOBS_DIR, jobId, 'work');
  let last = 0;
  try {
    const r = await videoToSplat({
      video,
      workDir,
      steps,
      onProgress: (p) => {
        holdAwake(5 * 60 * 1000);
        jobs.progress(jobId, p.stage, p.fraction, p.message);
        const now = Date.now();
        if (now - last > 400 || p.fraction === 0 || p.fraction === 1) {
          last = now;
          bridge.broadcast('job', jobs.get(jobId));
        }
      },
    });
    const id = `${slug(name)}-${randomUUID().slice(0, 4)}`;
    const dest = join(SCENES_DIR, `${id}.ply`);
    renameSync(r.ply, dest);
    const cameras = JSON.parse(readFileSync(r.cameras, 'utf8'));
    scenes.insert({ id, name, file: dest, format: 'ply', source: 'video', bytes: statSync(dest).size, cameras });
    jobs.finish(jobId, id);
    writeFileSync(join(workDir, 'result.json'), JSON.stringify(r, null, 2));
  } catch (e) {
    jobs.fail(jobId, (e as Error).message.split('\n')[0]);
  }
  bridge.broadcast('job', jobs.get(jobId));
  bridge.broadcast('scenes', null);
}

type Handler = (req: IncomingMessage, res: ServerResponse, p: Record<string, string>, url: URL) => Promise<void> | void;
const routes: [string, RegExp, string[], Handler][] = [];
function route(method: string, path: string, h: Handler) {
  const keys: string[] = [];
  const re = new RegExp(`^${path.replace(/:(\w+)/g, (_, k) => (keys.push(k), '([^/]+)'))}$`);
  routes.push([method, re, keys, h]);
}

route('GET', '/api/health', async (_q, res) => {
  const t = findTools();
  json(res, 200, { ollama: await ollamaStatus(), tools: Object.fromEntries(Object.entries(t).map(([k, v]) => [k, !!v])) });
});

route('GET', '/api/scenes', (_q, res) => json(res, 200, scenes.list().map((s) => scenePublic(s.id))));

route('POST', '/api/scenes', async (req, res, _p, url) => {
  const name = String(req.headers['x-filename'] ?? url.searchParams.get('name') ?? '');
  const ext = extname(name).toLowerCase();
  if (!SPLAT_EXT.includes(ext)) throw new HttpError(415, `Drop a ${SPLAT_EXT.join(', ')} file. For a video, use Add capture → From video.`);
  const id = `${slug(name)}-${randomUUID().slice(0, 4)}`;
  const file = join(SCENES_DIR, `${id}${ext}`);
  const bytes = await saveUpload(req, file);
  if (bytes < 1024) {
    rmSync(file, { force: true });
    throw new HttpError(400, 'That file is too small to be a splat');
  }
  scenes.insert({ id, name: prettyName(name), file, format: ext.slice(1), source: 'upload', bytes });
  bridge.broadcast('scenes', null);
  json(res, 201, scenePublic(id));
});

route('GET', '/api/scenes/:id', (_q, res, p) => json(res, 200, scenePublic(p.id)));

route('PATCH', '/api/scenes/:id', async (req, res, p) => {
  scenePublic(p.id);
  const b = await body(req);
  if (b.metersPerUnit != null && !(b.metersPerUnit > 0)) throw new HttpError(400, 'metersPerUnit must be positive');
  scenes.update(p.id, b);
  bridge.broadcast('scene', scenePublic(p.id));
  json(res, 200, scenePublic(p.id));
});

route('DELETE', '/api/scenes/:id', (_q, res, p) => {
  const s = scenes.get(p.id);
  if (!s) throw new HttpError(404, 'No such scene');
  scenes.remove(p.id);
  if (s.source !== 'sample' && normalize(s.file).startsWith(SCENES_DIR)) rmSync(s.file, { force: true });
  rmSync(join(VIEWS_DIR, `${p.id}.jpg`), { force: true });
  clearScanViews(p.id);
  bridge.broadcast('scenes', null);
  json(res, 200, { ok: true });
});

// The extension in the URL tells Spark which format to parse.
route('GET', '/api/scenes/:id/file(?:\\.\\w+)?', (_q, res, p) => {
  const s = scenes.get(p.id);
  if (!s) throw new HttpError(404, 'No such scene');
  sendFile(res, s.file, 'application/octet-stream');
});

route('GET', '/api/scenes/:id/thumb', (_q, res, p) => sendFile(res, join(VIEWS_DIR, `${p.id}.jpg`)));

route('PUT', '/api/scenes/:id/thumb', async (req, res, p) => {
  scenePublic(p.id);
  const { image } = await body<{ image: string }>(req);
  writeFileSync(join(VIEWS_DIR, `${p.id}.jpg`), Buffer.from(image.replace(/^data:[^,]+,/, ''), 'base64'));
  scenes.update(p.id, { thumb: new Date().toISOString() });
  json(res, 200, scenePublic(p.id));
});

route('GET', '/api/scenes/:id/objects', (_q, res, p) => json(res, 200, objects.list(p.id)));

route('PUT', '/api/scenes/:id/objects', async (req, res, p) => {
  scenePublic(p.id);
  const { sightings, scanViews } = await body<{ sightings: Sighting[]; scanViews: number }>(req);
  if (!Array.isArray(sightings)) throw new HttpError(400, 'sightings must be an array');
  // With 8+ views, an object seen once is more likely a mis-hit than a real thing.
  const merged = mergeSightings(sightings, { minViews: scanViews >= 8 ? 2 : 1 });
  pins.clear(p.id);
  const list = objects.replace(p.id, merged, scanViews);
  bridge.broadcast('scene', scenePublic(p.id));
  json(res, 200, { objects: list, sightings: sightings.length });
});

route('POST', '/api/detect', async (req, res) => {
  const { image, sceneId, view } = await body<{ image: string; sceneId?: string; view?: number }>(req);
  if (!image) throw new HttpError(400, 'image is required');
  if (sceneId && scenes.get(sceneId) && Number.isInteger(view)) saveScanView(sceneId, view!, image);
  holdAwake(3 * 60 * 1000); // a scan sends one view after another
  // Stop generating when the viewer gives up on this view (Stop, or the tab closed).
  const gone = new AbortController();
  res.on('close', () => !res.writableFinished && gone.abort());
  const r = await detect(image.replace(/^data:[^,]+,/, ''), AbortSignal.any([gone.signal, AbortSignal.timeout(180_000)]));
  json(res, 200, r);
});

route('GET', '/api/scenes/:id/pins', (_q, res, p) => json(res, 200, pins.list(p.id)));

route('POST', '/api/scenes/:id/pins', async (req, res, p) => {
  scenePublic(p.id);
  const b = await body<{ label: string; position: [number, number, number] }>(req);
  if (!b.label || !Array.isArray(b.position) || b.position.length !== 3) throw new HttpError(400, 'label and position [x,y,z] are required');
  const pin = pins.add(p.id, b.label.slice(0, 80), b.position);
  bridge.command(p.id, { type: 'pins_changed' });
  json(res, 201, pin);
});

route('DELETE', '/api/scenes/:id/pins/:pin', (_q, res, p) => {
  pins.remove(p.id, Number(p.pin));
  bridge.command(p.id, { type: 'pins_changed' });
  json(res, 200, { ok: true });
});

route('DELETE', '/api/scenes/:id/pins', (_q, res, p) => {
  pins.clear(p.id);
  bridge.command(p.id, { type: 'pins_changed' });
  json(res, 200, { ok: true });
});

route('GET', '/api/scenes/:id/messages', (_q, res, p) => json(res, 200, messages.list(p.id)));
route('DELETE', '/api/scenes/:id/messages', (_q, res, p) => {
  messages.clear(p.id);
  json(res, 200, { ok: true });
});

// Ask streams NDJSON: {type:'step'} per tool call, then {type:'answer'}.
// A viewer that asks runs the returned commands itself; any other caller (MCP) has them sent to open viewers.
route('POST', '/api/scenes/:id/ask', async (req, res, p) => {
  const scene = scenes.get(p.id);
  if (!scene) throw new HttpError(404, 'No such scene');
  const { question, view, fromViewer } = await body<{ question: string; view?: string; fromViewer?: boolean }>(req);
  if (!question?.trim()) throw new HttpError(400, 'question is required');
  res.writeHead(200, { 'content-type': 'application/x-ndjson' });
  const send = (o: unknown) => res.write(`${JSON.stringify(o)}\n`);
  messages.add(p.id, 'user', question.trim());
  try {
    const a = await ask(question.trim(), {
      scene,
      view: view?.replace(/^data:[^,]+,/, ''),
      renderView: () => bridge.request<string>(p.id, { type: 'render_view', maxSide: 768 }),
      onStep: (s) => send({ type: 'step', step: s }),
    });
    messages.add(p.id, 'agent', a.text, a.trace);
    // The asking viewer runs the commands itself; other open viewers and MCP-driven ones get them here.
    if (!fromViewer) {
      for (const c of a.commands) bridge.command(p.id, c);
      bridge.command(p.id, { type: 'messages_changed' }); // an agent asked: show it in the open conversation
    } else if (a.commands.some((c) => c.type === 'pins_changed')) bridge.command(p.id, { type: 'pins_changed' });
    send({ type: 'answer', answer: a });
  } catch (e) {
    const msg = (e as Error).message;
    messages.add(p.id, 'agent', `Something went wrong: ${msg}`);
    send({ type: 'error', error: msg });
  }
  res.end();
});

// Drive the open viewer (used by the MCP server).
route('POST', '/api/scenes/:id/command', async (req, res, p) => {
  scenePublic(p.id);
  const cmd = await body<ViewerCommand>(req);
  if (cmd.type === 'render_view') {
    const image = await bridge.request<string>(p.id, cmd);
    if (!image) throw new HttpError(409, 'No viewer has this scene open. Open it in SceneForge first.');
    return json(res, 200, { image });
  }
  if (cmd.type === 'scan') {
    const r = await bridge.request<{ objects: number }>(p.id, cmd, 60 * 60 * 1000);
    if (!r) throw new HttpError(409, 'No viewer has this scene open. Open it in SceneForge first.');
    return json(res, 200, r);
  }
  bridge.command(p.id, cmd);
  json(res, 200, { ok: true, viewers: bridge.viewersFor(p.id) });
});

route('POST', '/api/bridge/:id', async (req, res, p) => {
  const { value } = await body(req, 64 * 1024 * 1024);
  json(res, bridge.reply(p.id, value) ? 200 : 410, { ok: true });
});

// A viewer subscribes with ?scene=<id> and reconnects when it switches scene.
route('GET', '/api/events', (_q, res, _p, url) => {
  bridge.attach(res, url.searchParams.get('scene'));
});

route('GET', '/api/jobs', (_q, res) => json(res, 200, jobs.list()));

route('POST', '/api/videos', async (req, res, _p, url) => {
  const name = String(req.headers['x-filename'] ?? url.searchParams.get('name') ?? 'capture.mp4');
  const ext = extname(name).toLowerCase();
  if (!VIDEO_EXT.includes(ext)) throw new HttpError(415, `Use a video file (${VIDEO_EXT.join(', ')})`);
  const missing = Object.entries(findTools()).filter(([, v]) => !v).map(([k]) => k);
  if (missing.length) throw new HttpError(503, `Capture tools missing: ${missing.join(', ')}. Run scripts/setup-tools.ps1.`);
  const id = randomUUID().slice(0, 8);
  const dir = join(JOBS_DIR, id);
  const video = join(dir, `input${ext}`);
  mkdirSync(dir, { recursive: true });
  if ((await saveUpload(req, video)) < 10 * 1024) {
    rmSync(dir, { recursive: true, force: true });
    throw new HttpError(400, 'That file is too small to be a video');
  }
  const display = prettyName(name);
  jobs.insert(id, display);
  const steps = Math.min(30000, Math.max(1000, Number(url.searchParams.get('steps') ?? 7000)));
  void runVideoJob(id, video, display, steps).catch(() => {});
  bridge.broadcast('job', jobs.get(id));
  json(res, 202, jobs.get(id));
});

async function handle(req: IncomingMessage, res: ServerResponse) {
  const url = new URL(req.url ?? '/', `http://${req.headers.host}`);
  if (url.pathname.startsWith('/api/')) {
    for (const [method, re, keys, h] of routes) {
      if (method !== req.method) continue;
      const m = url.pathname.match(re);
      if (!m) continue;
      const params = Object.fromEntries(keys.map((k, i) => [k, decodeURIComponent(m[i + 1])]));
      return h(req, res, params, url);
    }
    throw new HttpError(404, `No route for ${req.method} ${url.pathname}`);
  }
  // Production: the built app.
  const rel = url.pathname === '/' ? 'index.html' : decodeURIComponent(url.pathname.slice(1));
  const file = normalize(join(DIST_DIR, rel));
  if (file.startsWith(DIST_DIR) && existsSync(file) && statSync(file).isFile()) return sendFile(res, file);
  if (existsSync(join(DIST_DIR, 'index.html'))) return sendFile(res, join(DIST_DIR, 'index.html'));
  res.writeHead(404, { 'content-type': 'text/plain' });
  res.end('The app is not built. Run `npm run build`, or `npm run dev` for development.');
}

export function start(port = PORT) {
  jobs.failOrphans();
  seedSamples();
  const server = createServer((req, res) => {
    handle(req, res).catch((e: Error) => {
      // A viewer that stops a scan cancels its detect request; that is not a server error.
      if (e.name === 'AbortError' && res.destroyed) return;
      const status = e instanceof HttpError ? e.status : 500;
      if (status === 500) console.error(e);
      if (!res.headersSent) json(res, status, { error: e.message });
      else res.end();
    });
  });
  server.requestTimeout = 0; // uploads and the ask stream can take minutes
  server.listen(port, '127.0.0.1', () => console.log(`SceneForge server on http://127.0.0.1:${port}`));
  return server;
}

if (resolve(process.argv[1] ?? '') === resolve(import.meta.filename)) start();
