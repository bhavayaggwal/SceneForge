import './styles.css';
import type { AgentAnswer } from '../server/agent.ts';
import type { Job, Message, Pin, Scene, SceneObject, TraceStep, Vec3, ViewerCommand } from '../shared/types.ts';
import { plural } from '../shared/labels.ts';
import { api, stream, upload } from './api.ts';
import { scan, type ScanProgress } from './scan.ts';
import { Viewer, type MeasureResult, type ToolMode } from './viewer.ts';

type PublicScene = Scene & { url: string };
type Tab = 'ask' | 'objects' | 'pins';

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
const fmtInt = (n: number) => n.toLocaleString('en');
const fmtMB = (b: number) => (b >= 1e9 ? `${(b / 1e9).toFixed(1)} GB` : `${Math.round(b / 1e6)} MB`);
const fmtDur = (ms: number) => (ms < 1000 ? `${ms} ms` : ms < 60000 ? `${(ms / 1000).toFixed(1)} s` : `${Math.floor(ms / 60000)} m ${Math.round((ms % 60000) / 1000)} s`);

const state = {
  scenes: [] as PublicScene[],
  scene: null as PublicScene | null,
  objects: [] as SceneObject[],
  pins: [] as Pin[],
  messages: [] as Message[],
  jobs: [] as Job[],
  tab: 'ask' as Tab,
  selected: null as number | null,
  health: null as null | { ollama: { ok: boolean; model: string | null; error?: string }; tools: Record<string, boolean> },
  scanning: null as null | { abort: AbortController; progress: ScanProgress; started: number },
  asking: false,
  loadToken: 0,
};

const viewer = new Viewer($('stage'));
let events: EventSource | null = null;

// ---------- toast ----------
let toastTimer = 0;
function toast(text: string) {
  document.querySelector('.toast')?.remove();
  const el = Object.assign(document.createElement('div'), { className: 'toast', role: 'status', textContent: text });
  document.body.append(el);
  clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => el.remove(), 4200);
}

// ---------- sidebar ----------
function renderPlaces() {
  const nav = $('places');
  if (!state.scenes.length) {
    nav.innerHTML = `<p class="places-empty">No captures yet.</p>`;
    return;
  }
  nav.innerHTML = state.scenes
    .map((s) => {
      const splats = s.splats ? `${s.splats >= 1e6 ? `${(s.splats / 1e6).toFixed(1)}M` : `${Math.round(s.splats / 1e3)}k`} splats` : fmtMB(s.bytes);
      const sub = s.indexedAt ? `${fmtInt(s.objectCount)} ${plural('object', s.objectCount)} · ${splats}` : `Not indexed · ${splats}`;
      return `<a class="place" href="#/scene/${encodeURIComponent(s.id)}" ${state.scene?.id === s.id ? 'aria-current="page"' : ''}>
        <span class="thumb" ${s.thumb ? `style="background-image:url('${s.thumb}')"` : ''}></span>
        <span><span class="name">${esc(s.name)}</span><span class="sub">${esc(sub)}</span></span></a>`;
    })
    .join('');
}

function renderJobs() {
  const live = state.jobs.filter((j) => j.status === 'running' || (j.status === 'failed' && Date.now() - Date.parse(`${j.finishedAt}Z`) < 10 * 60 * 1000));
  $('jobs').innerHTML = live
    .map((j) => {
      if (j.status === 'failed') return `<div class="job failed"><div class="row1"><span>${esc(j.name)}</span><span>Failed</span></div><p>${esc(j.error ?? 'Unknown error')}</p></div>`;
      const stages = ['frames', 'features', 'matching', 'mapping', 'undistort', 'training'];
      const si = Math.max(0, stages.indexOf(j.stage));
      // Training dominates the time, so it gets half the bar.
      const weights = [0.03, 0.12, 0.15, 0.17, 0.03, 0.5];
      const overall = weights.slice(0, si).reduce((a, b) => a + b, 0) + weights[si] * j.fraction;
      return `<div class="job"><div class="row1"><span>${esc(j.name)}</span><span>${Math.round(overall * 100)}%</span></div>
        <p>${esc(j.message || 'Queued')}</p><div class="track"><span style="width:${(overall * 100).toFixed(1)}%"></span></div></div>`;
    })
    .join('');
}

function renderEngine() {
  const h = state.health;
  const el = $('engine');
  if (!h) return void (el.innerHTML = '');
  el.classList.toggle('off', !h.ollama.ok || !h.ollama.model);
  const name = h.ollama.model ? h.ollama.model.replace('qwen3-vl:', 'Qwen3-VL ').replace('-instruct', '') : null;
  el.innerHTML = h.ollama.ok
    ? name
      ? `<strong><span class="dot"></span>${esc(name)}</strong><span>Local vision model, via Ollama</span>`
      : `<strong><span class="dot"></span>No vision model</strong><span>Run: ollama pull qwen3-vl:4b-instruct</span>`
    : `<strong><span class="dot"></span>Ollama is off</strong><span>Start Ollama to index and ask</span>`;
}

// ---------- top bar ----------
function renderTop() {
  const s = state.scene;
  $('title').textContent = s?.name ?? 'SceneForge';
  document.title = s ? `${s.name} · SceneForge` : 'SceneForge';
  const pill = $('status-pill');
  pill.hidden = !s;
  if (s) {
    pill.className = `pill ${s.indexedAt ? 'pos' : ''}`;
    pill.textContent = state.scanning ? 'Indexing' : s.indexedAt ? `Indexed · ${fmtInt(s.objectCount)} ${plural('object', s.objectCount)}` : 'Not indexed';
  }
  const ready = !!state.health?.ollama.model;
  const idx = $<HTMLButtonElement>('index-btn');
  idx.hidden = !s;
  idx.disabled = !ready || !viewer.loaded || !!state.scanning;
  idx.textContent = s?.indexedAt ? 'Re-index' : 'Index scene';
  idx.className = `btn ${s?.indexedAt ? '' : 'primary'}`;
  idx.title = !ready
    ? 'Needs Ollama with a Qwen3-VL model'
    : s?.cameras?.length
      ? 'Scan the place from 12 of the capture camera positions'
      : 'Scan the place from 12 viewpoints around what you see now: frame the room first';
  const sc = $<HTMLButtonElement>('scale-btn');
  sc.hidden = !s;
  sc.disabled = !viewer.loaded;
  sc.textContent = s?.metersPerUnit ? 'Rescale' : 'Set scale';
  sc.title = s?.metersPerUnit
    ? `1 scene unit is ${s.metersPerUnit.toFixed(3)} m. Click two points a known distance apart to change it.`
    : 'Click two points a known distance apart';
}

// ---------- stage ----------
function renderStageEmpty() {
  const el = $('stage-empty');
  if (state.scene) return void (el.hidden = true);
  el.hidden = false;
  el.innerHTML = `<div class="empty-card">
    <h2>Talk to a place</h2>
    <p>Open a 3D capture and ask where things are, how many there are and how big they are. The answer is found by a vision model running on this machine and pinned in 3D.</p>
    <div class="empty-drop"><strong>Drop a splat or a video of a room here</strong><span class="meta">.ply, .spz or .splat opens at once. A video is reconstructed locally with COLMAP and Brush.</span></div>
    <div class="empty-actions">
      <button class="btn primary" data-pick="splat">Open a splat</button>
      <button class="btn" data-pick="video">Reconstruct a video</button>
    </div></div>`;
}

function renderScanCard() {
  const card = $('scan-card');
  const s = state.scanning;
  if (!s) return void (card.hidden = true);
  card.hidden = false;
  const p = s.progress;
  const elapsed = Date.now() - s.started;
  const per = p.view ? elapsed / p.view : 0;
  const left = p.view ? per * (p.views - p.view) : 0;
  card.innerHTML = `<header><h2>Indexing</h2><span class="meta">View ${Math.min(p.view + 1, p.views)} of ${p.views}</span></header>
    ${p.thumb ? `<img src="${p.thumb}" alt="The view being read now" />` : ''}
    <div class="track"><span style="width:${((p.view / p.views) * 100).toFixed(1)}%"></span></div>
    <p class="found">${p.found ? `${fmtInt(p.found)} ${plural('sighting', p.found)} so far` : 'Reading the first view'}${p.labels?.length ? ` · last view: ${esc(p.labels.slice(0, 6).join(', '))}` : ''}</p>
    <footer><span class="meta">${p.view ? `${fmtDur(p.lastMs)} per view · about ${fmtDur(Math.round(left / 1000) * 1000)} left` : 'The first view loads the model'}</span>
    <button class="btn small" id="scan-stop">Stop</button></footer>`;
  $('scan-stop').onclick = () => s.abort.abort();
}

// ---------- panel ----------
function setTab(t: Tab) {
  state.tab = t;
  for (const id of ['ask', 'objects', 'pins'] as Tab[]) {
    $(`tab-${id}`).setAttribute('aria-selected', String(id === t));
    $(`pane-${id}`).hidden = id !== t;
  }
}

function suggestions(): string[] {
  if (!state.objects.length) return [];
  const counts = new Map<string, number>();
  for (const o of state.objects) counts.set(o.label, (counts.get(o.label) ?? 0) + 1);
  const many = [...counts].filter(([, n]) => n > 1).sort((a, b) => b[1] - a[1])[0]?.[0];
  const big = [...state.objects].sort((a, b) => b.width * b.height - a.width * a.height);
  const findable = big.find((o) => o.views.length >= 2) ?? big[0];
  const other = big.find((o) => o.label !== findable.label);
  const out = [`Where is the ${findable.label}?`];
  if (many) out.push(`How many ${plural(many, 2)} are there?`);
  out.push(`How big is the ${(other ?? findable).label}?`);
  if (other) out.push(`How far is the ${findable.label} from the ${other.label}?`);
  out.push('What is in this room?');
  return out.slice(0, 4);
}

function traceHtml(t: TraceStep[], running = false) {
  if (!t.length && !running) return '';
  return `<ol class="trace" aria-label="Agent steps">${t
    .map((s) => `<li><span class="tool">${esc(s.tool)}</span><span class="detail" title="${esc(s.detail)}">${esc(s.detail)}</span><span class="ms">${fmtDur(s.ms)}</span></li>`)
    .join('')}${running ? `<li class="running"><span class="tool">working</span><span class="detail"></span><span class="ms"></span></li>` : ''}</ol>`;
}

function renderThread() {
  const el = $('thread');
  if (!state.scene) {
    el.innerHTML = `<li class="thread-intro"><h2>No place open</h2><p>Open a capture from Places, or add one.</p></li>`;
  } else if (!state.messages.length) {
    const s = state.scene;
    el.innerHTML = s.indexedAt
      ? `<li class="thread-intro"><h2>Ask about ${esc(s.name.toLowerCase())}</h2><p>${fmtInt(s.objectCount)} objects are indexed from ${s.scanViews} views. Ask where something is, how many there are, how big or how far apart. Answers fly the camera there and drop a pin.</p></li>`
      : `<li class="thread-intro"><h2>Index this place first</h2><p>The local vision model looks at the place from 12 viewpoints and records every object it sees with its 3D position. On this GPU that takes about ten minutes, once.</p>
        ${s.cameras?.length ? '' : '<p>The viewpoints circle what you see now, so frame the room well before you start.</p>'}
        <button class="btn primary" id="intro-index" ${state.health?.ollama.model && viewer.loaded && !state.scanning ? '' : 'disabled'}>Index scene</button></li>`;
    $('intro-index')?.addEventListener('click', () => startScan());
  } else {
    el.innerHTML = state.messages
      .map((m) => (m.role === 'user' ? `<li class="msg-user">${esc(m.text)}</li>` : `<li class="msg-agent${m.id < 0 && m.text.startsWith('Something went wrong') ? ' error' : ''}"><p class="text">${esc(m.text)}</p>${traceHtml(m.trace, m.id === -1 && state.asking)}</li>`))
      .join('');
  }
  el.scrollTop = el.scrollHeight;
  const sug = $('suggest');
  sug.innerHTML = !state.messages.length && state.scene?.indexedAt ? suggestions().map((q) => `<button type="button" class="chip">${esc(q)}</button>`).join('') : '';
  sug.querySelectorAll<HTMLButtonElement>('.chip').forEach((b) => (b.onclick = () => askQuestion(b.textContent!)));
  const ta = $<HTMLTextAreaElement>('ask');
  ta.disabled = !state.scene || state.asking;
  $<HTMLButtonElement>('send').disabled = !state.scene || state.asking;
}

function renderObjects() {
  const el = $('pane-objects');
  $('objects-count').textContent = state.objects.length ? fmtInt(state.objects.length) : '';
  const s = state.scene;
  if (!s) return void (el.innerHTML = '');
  if (!s.indexedAt) {
    el.innerHTML = `<div class="list-head"><h2>Objects</h2></div><p class="blank">Nothing indexed yet. Index scene records each object the model sees, with its position.</p>`;
    return;
  }
  const views = s.scanViews;
  const seq = new Map<string, number>();
  const rows = state.objects
    .map((o) => {
      const n = (seq.get(o.label) ?? 0) + 1;
      seq.set(o.label, n);
      const total = state.objects.filter((x) => x.label === o.label).length;
      const strip = Array.from({ length: views }, (_, i) => `<i class="${o.views.includes(i) ? 'on' : ''}"></i>`).join('');
      const size = s.metersPerUnit ? viewer.formatUnits(o.width) : `${o.width.toFixed(2)}`;
      return `<tr class="obj" tabindex="0" data-id="${o.id}" aria-selected="${state.selected === o.id}">
        <td class="label">${esc(o.label)}${total > 1 ? ` <small>${n}</small>` : ''}</td>
        <td><span class="seen"><span class="strip" aria-hidden="true">${strip}</span><span class="n">${o.views.length}/${views}</span></span></td>
        <td class="num">${size}</td></tr>`;
    })
    .join('');
  const scaleNote = s.metersPerUnit ? ` · 1 unit = ${s.metersPerUnit.toFixed(2)} m` : '';
  el.innerHTML = `<div class="list-head"><h2>Objects</h2><span class="meta">${views} views${scaleNote}</span></div>
    <table class="objects"><thead><tr><th>Object</th><th>Seen in</th><th class="num">Width${s.metersPerUnit ? '' : ' (units)'}</th></tr></thead><tbody>${rows}</tbody></table>
    ${s.metersPerUnit ? '' : `<p class="note">Sizes are in scene units until the scale is set. <button type="button" id="note-scale">Set scale</button></p>`}`;
  el.querySelectorAll<HTMLTableRowElement>('tr.obj').forEach((tr) => {
    const go = () => {
      const o = state.objects.find((x) => x.id === Number(tr.dataset.id));
      if (!o) return;
      state.selected = o.id;
      renderObjects();
      viewer.flyTo(o.position, Math.max(o.width, o.height) * 2.2);
    };
    tr.onclick = go;
    tr.onkeydown = (e) => (e.key === 'Enter' || e.key === ' ') && (e.preventDefault(), go());
  });
  $('note-scale')?.addEventListener('click', () => setMode('calibrate'));
}

function renderPins() {
  const el = $('pane-pins');
  $('pins-count').textContent = state.pins.length ? fmtInt(state.pins.length) : '';
  if (!state.scene) return void (el.innerHTML = '');
  if (!state.pins.length) {
    el.innerHTML = `<div class="list-head"><h2>Pins</h2></div><p class="blank">No pins. Answers drop a pin on what they found.</p>`;
    return;
  }
  el.innerHTML = `<div class="list-head"><h2>Pins</h2><button class="btn ghost small" id="pins-clear">Clear all</button></div>
    <ul class="pins">${state.pins
      .map((p) => `<li><span class="dot"></span><button class="go" data-id="${p.id}">${esc(p.label)}</button>
        <time datetime="${p.createdAt}">${new Date(`${p.createdAt}Z`).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</time>
        <button class="icon-btn" data-del="${p.id}" aria-label="Remove pin ${esc(p.label)}"><svg viewBox="0 0 16 16" aria-hidden="true"><path d="M4 4l8 8M12 4l-8 8"/></svg></button></li>`)
      .join('')}</ul>`;
  el.querySelectorAll<HTMLButtonElement>('button.go').forEach((b) => {
    b.onclick = () => {
      const p = state.pins.find((x) => x.id === Number(b.dataset.id));
      if (p) viewer.flyTo(p.position);
    };
  });
  el.querySelectorAll<HTMLButtonElement>('[data-del]').forEach((b) => {
    b.onclick = async () => {
      await api(`/api/scenes/${state.scene!.id}/pins/${b.dataset.del}`, { method: 'DELETE' });
      await loadPins();
    };
  });
  $('pins-clear')?.addEventListener('click', async () => {
    await api(`/api/scenes/${state.scene!.id}/pins`, { method: 'DELETE' });
    await loadPins();
  });
}

function renderAll() {
  renderPlaces();
  renderJobs();
  renderEngine();
  renderTop();
  renderStageEmpty();
  renderScanCard();
  renderThread();
  renderObjects();
  renderPins();
}

// ---------- data ----------
async function loadScenes() {
  state.scenes = await api<PublicScene[]>('/api/scenes');
  if (state.scene) state.scene = state.scenes.find((s) => s.id === state.scene!.id) ?? null;
  renderPlaces();
  renderTop();
}

async function loadPins() {
  if (!state.scene) return;
  const before = new Set(state.pins.map((p) => p.id));
  state.pins = await api<Pin[]>(`/api/scenes/${state.scene.id}/pins`);
  viewer.setPins(state.pins);
  // Mark new pins so they land with a short pulse.
  for (const p of state.pins) if (!before.has(p.id)) document.querySelectorAll('.pin').forEach((el) => el.getAttribute('aria-label') === `Pin: ${p.label}` && el.classList.add('fresh'));
  renderPins();
}

async function refreshHealth() {
  try {
    state.health = await api('/api/health');
  } catch {
    state.health = { ollama: { ok: false, model: null }, tools: {} };
  }
  renderEngine();
  renderTop();
  renderThread();
}

function connectEvents(sceneId: string | null) {
  events?.close();
  events = new EventSource(`/api/events${sceneId ? `?scene=${encodeURIComponent(sceneId)}` : ''}`);
  events.addEventListener('scenes', () => loadScenes());
  events.addEventListener('scene', (e) => {
    const s = JSON.parse((e as MessageEvent).data) as PublicScene;
    state.scenes = state.scenes.map((x) => (x.id === s.id ? s : x));
    if (state.scene?.id === s.id) {
      state.scene = s;
      viewer.metersPerUnit = s.metersPerUnit;
    }
    renderPlaces();
    renderTop();
  });
  events.addEventListener('job', (e) => {
    const j = JSON.parse((e as MessageEvent).data) as Job;
    const had = state.jobs.find((x) => x.id === j.id);
    state.jobs = had ? state.jobs.map((x) => (x.id === j.id ? j : x)) : [j, ...state.jobs];
    renderJobs();
    if (j.status === 'done' && had?.status !== 'done') {
      toast(`${j.name} is ready to open`);
      loadScenes();
    }
  });
  events.addEventListener('command', (e) => {
    const { sceneId, cmd } = JSON.parse((e as MessageEvent).data) as { sceneId: string; cmd: ViewerCommand };
    if (sceneId === state.scene?.id) runCommand(cmd);
  });
  events.addEventListener('request', async (e) => {
    const { id, sceneId, cmd } = JSON.parse((e as MessageEvent).data) as { id: string; sceneId: string; cmd: ViewerCommand };
    if (sceneId !== state.scene?.id) return;
    let value: unknown = null;
    if (cmd.type === 'render_view' && viewer.loaded) value = viewer.capture(cmd.maxSide ?? 768);
    if (cmd.type === 'scan') value = await startScan(cmd.views);
    await api(`/api/bridge/${id}`, { method: 'POST', body: { value } }).catch(() => {});
  });
}

async function runCommand(cmd: ViewerCommand) {
  switch (cmd.type) {
    case 'fly_to':
      return viewer.flyTo(cmd.position, cmd.distance);
    case 'frame':
      return viewer.frame(cmd.positions);
    case 'pins_changed':
      return loadPins();
    case 'messages_changed':
      if (state.asking || !state.scene) return;
      state.messages = await api<Message[]>(`/api/scenes/${state.scene.id}/messages`);
      setTab('ask');
      renderThread();
      return;
    case 'index_changed':
      return openScene(state.scene!.id, true);
    case 'measure_mode':
      setMode(cmd.reason === 'calibrate' ? 'calibrate' : 'measure');
      return;
  }
}

// ---------- opening a scene ----------
async function openScene(id: string | null, keepCamera = false) {
  const token = ++state.loadToken;
  closeNav();
  if (!id) {
    state.scene = null;
    viewer.unload();
    Object.assign(state, { objects: [], pins: [], messages: [], selected: null });
    connectEvents(null);
    renderAll();
    return;
  }
  let scene = state.scenes.find((s) => s.id === id) ?? null;
  if (!scene) {
    await loadScenes();
    scene = state.scenes.find((s) => s.id === id) ?? null;
  }
  if (!scene) {
    toast('That place no longer exists');
    location.hash = '#/';
    return;
  }
  const switching = state.scene?.id !== id || viewer.loadedUrl !== scene.url;
  if (switching && state.scanning) {
    state.scanning.abort.abort();
    toast('Indexing stopped because another place was opened');
  }
  state.scene = scene;
  viewer.metersPerUnit = scene.metersPerUnit;
  if (switching) connectEvents(id);
  const [objects, pins, messages] = await Promise.all([
    api<SceneObject[]>(`/api/scenes/${id}/objects`),
    api<Pin[]>(`/api/scenes/${id}/pins`),
    api<Message[]>(`/api/scenes/${id}/messages`),
  ]);
  if (token !== state.loadToken) return;
  Object.assign(state, { objects, pins, messages, selected: null });
  renderAll();
  if (switching || !viewer.loaded) {
    setMode('orbit');
    const loading = $('loading');
    loading.hidden = false;
    const bar = loading.querySelector<HTMLElement>('.bar span')!;
    const label = loading.querySelector('p')!;
    label.textContent = `Loading ${fmtMB(scene.bytes)}`;
    bar.style.width = '0%';
    try {
      const stats = await viewer.load(scene.url, scene.flip, scene.view, (f) => {
        bar.style.width = `${(f * 100).toFixed(1)}%`;
        label.textContent = f < 1 ? `Loading ${fmtMB(scene!.bytes * f)} of ${fmtMB(scene!.bytes)}` : 'Preparing splats';
      });
      if (token !== state.loadToken) return;
      viewer.setCaptureCameras(scene.cameras, scene.flip, scene.view);
      if (!scene.splats) api(`/api/scenes/${id}`, { method: 'PATCH', body: { splats: stats.splats } }).catch(() => {});
      if (!scene.thumb) setTimeout(() => saveThumb(id), 1200);
    } catch (e) {
      toast(`Couldn't open this capture: ${(e as Error).message}`);
    } finally {
      if (token === state.loadToken) loading.hidden = true;
    }
  }
  if (token !== state.loadToken) return;
  viewer.setPins(pins);
  renderAll();
  if (!keepCamera) viewer.requestRender();
}

async function saveThumb(id: string) {
  if (state.scene?.id !== id || !viewer.loaded) return;
  const image = viewer.capture(240, 0.8);
  await api(`/api/scenes/${id}/thumb`, { method: 'PUT', body: { image } }).catch(() => {});
  loadScenes();
}

// ---------- asking ----------
async function askQuestion(q: string) {
  const s = state.scene;
  if (!s || state.asking || !q.trim()) return;
  setTab('ask');
  state.asking = true;
  state.messages.push({ id: -2, role: 'user', text: q.trim(), trace: [], createdAt: '' });
  const pending: Message = { id: -1, role: 'agent', text: '', trace: [], createdAt: '' };
  state.messages.push(pending);
  renderThread();
  try {
    const view = viewer.loaded ? viewer.capture(768, 0.8) : undefined;
    let answer: AgentAnswer | null = null;
    await stream(`/api/scenes/${s.id}/ask`, { question: q.trim(), view, fromViewer: true }, (line) => {
      if (line.type === 'step') {
        pending.trace.push(line.step);
        renderThread();
      } else if (line.type === 'answer') answer = line.answer;
      else if (line.type === 'error') throw new Error(line.error);
    });
    if (answer) {
      const a = answer as AgentAnswer;
      pending.text = a.text;
      pending.trace = a.trace;
      for (const c of a.commands) runCommand(c);
      if (a.objects.length === 1) state.selected = a.objects[0].id;
    }
  } catch (e) {
    pending.text = `Something went wrong: ${(e as Error).message}`;
  } finally {
    state.asking = false;
    pending.id = -3;
    renderThread();
    renderObjects();
    $<HTMLTextAreaElement>('ask').focus();
  }
}

// ---------- scanning ----------
async function startScan(views = 12): Promise<{ objects: number } | null> {
  const s = state.scene;
  if (!s || state.scanning || viewer.loadedUrl !== s.url) return null;
  const abort = new AbortController();
  state.scanning = { abort, progress: { view: 0, views, found: 0, lastMs: 0 }, started: Date.now() };
  setMode('orbit');
  renderTop();
  renderThread();
  renderScanCard();
  try {
    const r = await scan(viewer, s, views, (p) => {
      if (!state.scanning) return;
      state.scanning.progress = { ...state.scanning.progress, ...p };
      renderScanCard();
    }, abort.signal);
    state.scanning = null;
    toast(`Indexed ${r.objects} objects from ${r.sightings} sightings`);
    await loadScenes();
    await openScene(s.id, true);
    return { objects: r.objects };
  } catch (e) {
    const stopped = (e as Error).name === 'AbortError';
    toast(stopped ? 'Indexing stopped; the old index is unchanged' : `Indexing failed: ${(e as Error).message}`);
    return null;
  } finally {
    state.scanning = null;
    renderTop();
    renderScanCard();
    renderThread();
  }
}

// ---------- measuring and scale ----------
function setMode(mode: ToolMode) {
  viewer.setMode(mode);
  document.querySelectorAll<HTMLButtonElement>('#modes button').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.mode === mode || (mode === 'calibrate' && b.dataset.mode === 'measure'))));
  const r = $('readout');
  if (mode === 'orbit') return void (r.hidden = true);
  r.hidden = false;
  r.innerHTML = mode === 'calibrate'
    ? `<p>Set scale: click both ends of something you know the length of, like a door's width.</p><button class="btn ghost small" id="ro-cancel">Cancel</button>`
    : `<p>Measure: click two points.</p><button class="btn ghost small" id="ro-cancel">Done</button>`;
  $('ro-cancel').onclick = () => setMode('orbit');
}

viewer.onMeasure = (m: MeasureResult, mode) => {
  const r = $('readout');
  if (mode === 'measure') {
    const unitNote = viewer.metersPerUnit == null ? ' <button class="btn ghost small" id="ro-scale">Set scale for metres</button>' : '';
    r.innerHTML = `<p><strong class="num">${viewer.formatUnits(m.units)}</strong> between the two points</p>${unitNote}<button class="btn ghost small" id="ro-cancel">Done</button>`;
    $('ro-cancel').onclick = () => setMode('orbit');
    $('ro-scale')?.addEventListener('click', () => setMode('calibrate'));
    return;
  }
  r.innerHTML = `<p>That span is <span class="num">${m.units.toFixed(3)}</span> units. Real length:</p>
    <form id="ro-form"><label class="visually-hidden" for="ro-len">Real length in metres</label>
    <input id="ro-len" inputmode="decimal" placeholder="0.80" aria-describedby="ro-unit" required /><span id="ro-unit">m</span>
    <button class="btn primary small">Save scale</button></form><button class="btn ghost small" id="ro-cancel">Cancel</button>`;
  $('ro-cancel').onclick = () => setMode('orbit');
  const input = $<HTMLInputElement>('ro-len');
  input.focus();
  $<HTMLFormElement>('ro-form').onsubmit = async (e) => {
    e.preventDefault();
    const metres = Number(input.value.replace(',', '.'));
    if (!(metres > 0)) return void input.focus();
    const s = await api<PublicScene>(`/api/scenes/${state.scene!.id}`, { method: 'PATCH', body: { metersPerUnit: metres / m.units } });
    state.scene = s;
    viewer.metersPerUnit = s.metersPerUnit;
    toast(`Scale set: 1 unit is ${s.metersPerUnit!.toFixed(3)} m`);
    setMode('orbit');
    renderTop();
    renderObjects();
  };
};

// ---------- adding captures ----------
async function addFile(file: File) {
  const isVideo = file.type.startsWith('video/') || /\.(mp4|mov|m4v|webm|mkv|avi)$/i.test(file.name);
  const isSplat = /\.(ply|spz|splat|ksplat)$/i.test(file.name);
  if (!isVideo && !isSplat) return toast('Drop a .ply, .spz or .splat file, or a video');
  const name = file.name;
  const fake: Job = { id: `up-${Date.now()}`, sceneId: null, name, status: 'running', stage: 'frames', fraction: 0, message: 'Uploading', error: null, createdAt: '', finishedAt: null };
  state.jobs = [fake, ...state.jobs];
  renderJobs();
  const progress = (f: number) => {
    fake.message = `Uploading ${Math.round(f * 100)}%`;
    renderJobs();
  };
  try {
    if (isSplat) {
      const s = await upload<PublicScene>('/api/scenes', file, progress);
      state.jobs = state.jobs.filter((j) => j !== fake);
      renderJobs();
      await loadScenes();
      location.hash = `#/scene/${encodeURIComponent(s.id)}`;
    } else {
      const j = await upload<Job>('/api/videos', file, progress);
      state.jobs = [j, ...state.jobs.filter((x) => x !== fake && x.id !== j.id)];
      renderJobs();
      toast('Reconstructing on this machine. This takes a while; you can keep working.');
    }
  } catch (e) {
    state.jobs = state.jobs.filter((j) => j !== fake);
    renderJobs();
    toast((e as Error).message);
  }
}

function closeNav() {
  $('app').classList.remove('nav-open');
  $('scrim').hidden = true;
  $('menu-btn').setAttribute('aria-expanded', 'false');
}

function bindUi() {
  const menu = $('add-menu');
  const addBtn = $('add-btn');
  const toggleMenu = (open: boolean) => {
    menu.hidden = !open;
    addBtn.setAttribute('aria-expanded', String(open));
    if (open) menu.querySelector('button')?.focus();
  };
  addBtn.onclick = () => toggleMenu(menu.hidden);
  document.addEventListener('click', (e) => {
    const pick = (e.target as HTMLElement).closest<HTMLElement>('[data-pick]');
    if (pick) {
      toggleMenu(false);
      $(pick.dataset.pick === 'video' ? 'pick-video' : 'pick-splat').click();
      return;
    }
    if (!menu.hidden && !(e.target as HTMLElement).closest('.add')) toggleMenu(false);
  });
  for (const id of ['pick-splat', 'pick-video']) {
    const input = $<HTMLInputElement>(id);
    input.onchange = () => {
      if (input.files?.[0]) addFile(input.files[0]);
      input.value = '';
    };
  }

  const stage = $('stage');
  const drop = $('drop');
  let depth = 0;
  stage.addEventListener('dragenter', (e) => {
    if (!e.dataTransfer?.types.includes('Files')) return;
    depth++;
    drop.hidden = false;
  });
  stage.addEventListener('dragleave', () => {
    if (--depth <= 0) drop.hidden = true;
  });
  stage.addEventListener('dragover', (e) => e.preventDefault());
  stage.addEventListener('drop', (e) => {
    e.preventDefault();
    depth = 0;
    drop.hidden = true;
    const f = e.dataTransfer?.files?.[0];
    if (f) addFile(f);
  });

  for (const t of ['ask', 'objects', 'pins'] as Tab[]) $(`tab-${t}`).onclick = () => setTab(t);
  $('index-btn').onclick = () => startScan();
  $('scale-btn').onclick = () => setMode('calibrate');
  $('home-btn').onclick = () => viewer.goHome();
  document.querySelectorAll<HTMLButtonElement>('#modes button').forEach((b) => (b.onclick = () => setMode(b.dataset.mode as ToolMode)));

  const ta = $<HTMLTextAreaElement>('ask');
  const fit = () => {
    ta.style.height = 'auto';
    ta.style.height = `${Math.min(120, ta.scrollHeight)}px`;
  };
  ta.addEventListener('input', fit);
  ta.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      $<HTMLFormElement>('composer').requestSubmit();
    }
  });
  $<HTMLFormElement>('composer').onsubmit = (e) => {
    e.preventDefault();
    const q = ta.value;
    ta.value = '';
    fit();
    askQuestion(q);
  };

  $('menu-btn').onclick = () => {
    const open = !$('app').classList.contains('nav-open');
    $('app').classList.toggle('nav-open', open);
    $('scrim').hidden = !open;
    $('menu-btn').setAttribute('aria-expanded', String(open));
  };
  $('scrim').onclick = closeNav;

  viewer.onPinClick = (p) => viewer.flyTo(p.position);
  viewer.onContextLost = () => {
    state.scanning?.abort.abort();
    const el = $('loading');
    el.hidden = false;
    el.innerHTML = `<p>The GPU dropped the 3D view, usually because it ran out of memory.</p><button class="btn" onclick="location.reload()">Reload the view</button>`;
  };

  document.addEventListener('keydown', (e) => {
    const typing = (e.target as HTMLElement).closest('input, textarea');
    if (e.key === 'Escape') {
      setMode('orbit');
      closeNav();
      menu.hidden = true;
      return;
    }
    if (typing || e.metaKey || e.ctrlKey || e.altKey) return;
    if (e.key === '/') (e.preventDefault(), ta.focus());
    else if (e.key === 'm') setMode(viewer.mode === 'measure' ? 'orbit' : 'measure');
    else if (e.key === 'o') setMode('orbit');
    else if (e.key === 'h') $('home-btn').click();
  });

  window.addEventListener('hashchange', route);
}

function route() {
  const m = location.hash.match(/^#\/scene\/(.+)$/);
  openScene(m ? decodeURIComponent(m[1]) : null);
}

// ---------- boot ----------
bindUi();
await Promise.all([loadScenes().catch(() => toast('The SceneForge server is not running')), refreshHealth()]);
state.jobs = await api<Job[]>('/api/jobs').catch(() => []);
if (!location.hash && state.scenes.length) location.hash = `#/scene/${encodeURIComponent(state.scenes[0].id)}`;
else route();
setInterval(refreshHealth, 15000);
(window as any).__sf = { state, viewer, askQuestion, startScan };
