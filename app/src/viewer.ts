// The 3D viewer: Spark renders the splat into three.js. Renders on demand only, so the GPU
// is free for the local vision model whenever nothing on screen is moving.
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { SparkRenderer, SplatMesh } from '@sparkjsdev/spark';
import type { Pin, Vec3 } from '../shared/types.ts';

export interface HomeView {
  position: Vec3;
  target: Vec3;
}

export interface SceneStats {
  splats: number;
  center: Vec3;
  /** Robust size of the scene: the 10th–90th percentile span of splat centres. */
  extent: number;
  /** Robust half-spans per axis, used to place scan cameras inside the space. */
  span: Vec3;
}

export type ToolMode = 'orbit' | 'measure' | 'calibrate';

export interface MeasureResult {
  a: Vec3;
  b: Vec3;
  units: number;
}

const tmp = new THREE.Vector3();

// Timers in a hidden tab are throttled to once a minute; a worker's timers are not.
let timerWorker: Worker | null = null;
let timerSeq = 0;
const timerWaiters = new Map<number, () => void>();
function workerSleep(ms: number): Promise<void> {
  if (!timerWorker) {
    const src = 'onmessage = (e) => setTimeout(() => postMessage(e.data.id), e.data.ms);';
    timerWorker = new Worker(URL.createObjectURL(new Blob([src], { type: 'text/javascript' })));
    timerWorker.onmessage = (e) => {
      timerWaiters.get(e.data)?.();
      timerWaiters.delete(e.data);
    };
  }
  const id = ++timerSeq;
  return new Promise((r) => {
    timerWaiters.set(id, r);
    timerWorker!.postMessage({ id, ms });
  });
}

export class Viewer {
  readonly el: HTMLElement;
  readonly canvas: HTMLCanvasElement;
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(60, 1, 0.01, 500);
  readonly controls: OrbitControls;
  private spark: SparkRenderer;
  private splat: SplatMesh | null = null;
  private dirty = true;
  private anim: { from: [THREE.Vector3, THREE.Vector3]; to: [THREE.Vector3, THREE.Vector3]; t0: number; ms: number; done: () => void } | null = null;
  private pinLayer: HTMLElement;
  private pinEls = new Map<number, HTMLElement>();
  private pins: Pin[] = [];
  private measureLine: THREE.Line;
  private measureLabel: HTMLElement;
  private measurePts: THREE.Vector3[] = [];
  private frames = 0;
  private fpsT = performance.now();
  stats: SceneStats | null = null;
  fps = 0;
  mode: ToolMode = 'orbit';
  metersPerUnit: number | null = null;
  onMeasure: ((m: MeasureResult, mode: ToolMode) => void) | null = null;
  onPinClick: ((pin: Pin) => void) | null = null;
  onContextLost: (() => void) | null = null;
  contextLost = false;

  constructor(el: HTMLElement) {
    this.el = el;
    this.renderer = new THREE.WebGLRenderer({ antialias: false, preserveDrawingBuffer: false, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 1.25));
    this.canvas = this.renderer.domElement;
    this.canvas.className = 'viewer-canvas';
    el.prepend(this.canvas);
    this.spark = new SparkRenderer({ renderer: this.renderer, onDirty: () => this.markDirty() } as any);
    this.scene.add(this.spark);
    this.scene.background = new THREE.Color('#e9ebec');
    this.controls = new OrbitControls(this.camera, this.canvas);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.12;
    this.controls.addEventListener('change', () => (this.dirty = true));

    this.pinLayer = document.createElement('div');
    this.pinLayer.className = 'pin-layer';
    el.append(this.pinLayer);

    const geo = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]);
    this.measureLine = new THREE.Line(geo, new THREE.LineBasicMaterial({ color: '#d1246b', depthTest: false, transparent: true }));
    this.measureLine.renderOrder = 10;
    this.measureLine.visible = false;
    this.scene.add(this.measureLine);
    this.measureLabel = document.createElement('div');
    this.measureLabel.className = 'measure-label';
    this.measureLabel.hidden = true;
    el.append(this.measureLabel);

    new ResizeObserver(() => this.resize()).observe(el);
    // The browser drops the GL context when the GPU runs out of memory (the vision model shares it).
    this.canvas.addEventListener('webglcontextlost', (e) => {
      e.preventDefault();
      this.contextLost = true;
      this.onContextLost?.();
    });
    this.bindPointer();
    this.renderer.setAnimationLoop(() => this.tick());
  }

  private resize() {
    const { clientWidth: w, clientHeight: h } = this.el;
    if (!w || !h) return;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.dirty = true;
  }

  get loaded() {
    return !!this.splat;
  }

  /** URL of the splat on screen; long tasks check it so they never work on a scene swapped in under them. */
  loadedUrl: string | null = null;

  async load(url: string, flip: boolean, home: HomeView | null, onProgress?: (f: number) => void): Promise<SceneStats> {
    this.unload();
    this.loadedUrl = url;
    const splat = new SplatMesh({ url, onProgress: (e: ProgressEvent) => e.total && onProgress?.(e.loaded / e.total) } as any);
    if (flip) splat.quaternion.set(1, 0, 0, 0); // 3DGS / COLMAP exports are y-down
    this.scene.add(splat);
    this.splat = splat;
    await splat.initialized;
    splat.updateMatrixWorld(true);
    this.stats = this.measureScene(splat);
    const h = home ?? this.defaultHome(this.stats);
    this.home = h;
    this.camera.near = this.stats.extent / 500;
    this.camera.far = this.stats.extent * 40;
    this.camera.updateProjectionMatrix();
    this.camera.position.set(...h.position);
    this.controls.target.set(...h.target);
    this.controls.update();
    this.dirty = true;
    return this.stats;
  }

  unload() {
    this.loadedUrl = null;
    this.captureCams = [];
    if (this.splat) {
      this.scene.remove(this.splat);
      this.splat.dispose();
      this.splat = null;
    }
    this.stats = null;
    this.setPins([]);
    this.clearMeasure();
  }

  /** Samples splat centres (opaque ones) for a robust centre and size, ignoring floaters. */
  private measureScene(splat: SplatMesh): SceneStats {
    const n = (splat as any).packedSplats?.numSplats ?? (splat as any).numSplats ?? 0;
    const every = Math.max(1, Math.floor(n / 40000));
    const xs: number[] = [], ys: number[] = [], zs: number[] = [];
    const m = splat.matrixWorld;
    splat.forEachSplat((i, center, _s, _q, opacity) => {
      if (i % every || opacity < 0.5) return;
      tmp.copy(center).applyMatrix4(m);
      xs.push(tmp.x); ys.push(tmp.y); zs.push(tmp.z);
    });
    const q = (a: number[], p: number) => a[Math.min(a.length - 1, Math.floor(p * a.length))];
    for (const a of [xs, ys, zs]) a.sort((u, v) => u - v);
    const center: Vec3 = [q(xs, 0.5), q(ys, 0.5), q(zs, 0.5)];
    const span: Vec3 = [(q(xs, 0.9) - q(xs, 0.1)) / 2, (q(ys, 0.9) - q(ys, 0.1)) / 2, (q(zs, 0.9) - q(zs, 0.1)) / 2];
    const extent = Math.max(span[0], span[1], span[2]) * 2 || 1;
    return { splats: n, center, extent, span };
  }

  private defaultHome(s: SceneStats): HomeView {
    const [cx, cy, cz] = s.center;
    return { target: [cx, cy, cz], position: [cx, cy + s.extent * 0.12, cz + s.extent * 0.55] };
  }

  homeView(): HomeView {
    return { position: this.camera.position.toArray() as Vec3, target: this.controls.target.toArray() as Vec3 };
  }

  private tick() {
    if (this.anim) {
      const t = Math.min(1, (performance.now() - this.anim.t0) / this.anim.ms);
      const e = 1 - Math.pow(1 - t, 3);
      this.camera.position.lerpVectors(this.anim.from[0], this.anim.to[0], e);
      this.controls.target.lerpVectors(this.anim.from[1], this.anim.to[1], e);
      this.dirty = true;
      if (t >= 1) {
        const done = this.anim.done;
        this.anim = null;
        done();
      }
    }
    if (this.controls.update()) this.dirty = true;
    if (!this.dirty) return;
    this.dirty = false;
    this.renderer.render(this.scene, this.camera);
    this.placeOverlays();
    this.frames++;
    const now = performance.now();
    if (now - this.fpsT > 1000) {
      this.fps = Math.round((this.frames * 1000) / (now - this.fpsT));
      this.frames = 0;
      this.fpsT = now;
    }
  }

  requestRender() {
    this.dirty = true;
  }

  /** Capture cameras in world space (video scenes). The splat is only sharp near where they stood. */
  captureCams: { position: THREE.Vector3; forward: THREE.Vector3 }[] = [];

  /** Where Home returns to: the saved view, a capture camera, or a view of the scene's middle. */
  home: HomeView | null = null;

  setCaptureCameras(cams: { position: Vec3; direction: Vec3 }[] | null, flip: boolean, saved: HomeView | null) {
    const f = (v: Vec3) => (flip ? new THREE.Vector3(v[0], -v[1], -v[2]) : new THREE.Vector3(...v));
    this.captureCams = (cams ?? []).map((c) => ({ position: f(c.position), forward: f(c.direction).normalize() }));
    if (saved || !this.captureCams.length || !this.stats) return;
    // A fifth of the way along the walk is usually past the doorway and looking into the room.
    const c = this.captureCams[Math.floor(this.captureCams.length * 0.2)];
    const target = c.position.clone().addScaledVector(c.forward, this.stats.extent * 0.3);
    this.home = { position: c.position.toArray() as Vec3, target: target.toArray() as Vec3 };
    this.camera.position.copy(c.position);
    this.controls.target.copy(target);
    this.controls.update();
    this.dirty = true;
  }

  goHome(ms = 900) {
    if (!this.home) return;
    return this.animate(new THREE.Vector3(...this.home.position), new THREE.Vector3(...this.home.target), ms);
  }

  /** The capture camera that looks most directly at `p` (within 40°), nearer ones preferred. */
  private bestCaptureCam(p: THREE.Vector3) {
    let best: { position: THREE.Vector3 } | null = null;
    let bestScore = Infinity;
    const extent = this.stats?.extent ?? 1;
    for (const c of this.captureCams) {
      const to = p.clone().sub(c.position);
      const d = to.length();
      if (d < extent * 0.05) continue;
      const angle = to.normalize().angleTo(c.forward);
      if (angle > THREE.MathUtils.degToRad(40)) continue;
      const score = angle + d / extent;
      if (score < bestScore) [best, bestScore] = [c, score];
    }
    return best;
  }

  /** Eases the camera to look at `p` from `distance` away, keeping the current viewing direction. */
  flyTo(p: Vec3, distance?: number, ms = 900): Promise<void> {
    const target = new THREE.Vector3(...p);
    const cam = this.bestCaptureCam(target);
    if (cam) return this.animate(cam.position.clone(), target, ms);
    const dir = tmp.copy(this.camera.position).sub(this.controls.target).normalize();
    const d = Math.max(distance ?? this.camera.position.distanceTo(this.controls.target) * 0.6, (this.stats?.extent ?? 1) * 0.12);
    const pos = target.clone().addScaledVector(dir, d);
    return this.animate(pos, target, ms);
  }

  /** Frames several points: centre on their middle, back off until all fit. */
  frame(points: Vec3[], ms = 900): Promise<void> {
    if (!points.length) return Promise.resolve();
    if (points.length === 1) return this.flyTo(points[0]);
    const box = new THREE.Box3().setFromPoints(points.map((p) => new THREE.Vector3(...p)));
    const c = box.getCenter(new THREE.Vector3());
    if (this.captureCams.length) {
      // From the capture camera that sees the group's centre; back off along its ray if needed to fit.
      const cam = this.bestCaptureCam(c);
      if (cam) {
        const r = box.getSize(new THREE.Vector3()).length() / 2;
        const fov = THREE.MathUtils.degToRad(this.camera.fov) * Math.min(1, this.camera.aspect);
        const need = r / Math.tan(fov / 2) * 1.15;
        const dir = cam.position.clone().sub(c).normalize();
        const pos = cam.position.distanceTo(c) >= need ? cam.position.clone() : c.clone().addScaledVector(dir, need);
        return this.animate(pos, c, ms);
      }
    }
    const r = box.getSize(new THREE.Vector3()).length() / 2;
    const fov = THREE.MathUtils.degToRad(this.camera.fov) * Math.min(1, this.camera.aspect);
    // Points close together must not pull the camera into the floaters around them.
    const floor = (this.stats?.extent ?? 1) * 0.18;
    return this.flyTo(c.toArray() as Vec3, Math.max(r / Math.tan(fov / 2) * 1.15, r * 1.5, floor), ms);
  }

  private animate(pos: THREE.Vector3, target: THREE.Vector3, ms: number): Promise<void> {
    return new Promise((done) => {
      if (matchMedia('(prefers-reduced-motion: reduce)').matches) ms = 0;
      this.anim = { from: [this.camera.position.clone(), this.controls.target.clone()], to: [pos, target], t0: performance.now(), ms: Math.max(1, ms), done };
    });
  }

  /** Raycast through normalised device coords of `camera`; returns the nearest splat hit. */
  raycast(ndcX: number, ndcY: number, camera: THREE.Camera = this.camera): { point: Vec3; distance: number } | null {
    if (!this.splat) return null;
    const rc = new THREE.Raycaster();
    rc.setFromCamera(new THREE.Vector2(ndcX, ndcY), camera);
    const hit = rc.intersectObject(this.splat, false)[0];
    return hit ? { point: hit.point.toArray() as Vec3, distance: hit.distance } : null;
  }

  /** Renders the current view and returns a JPEG data URL, longest side `maxSide`. */
  capture(maxSide = 768, quality = 0.85): string {
    this.renderer.render(this.scene, this.camera);
    const src = this.canvas;
    const s = Math.min(1, maxSide / Math.max(src.width, src.height));
    const c = document.createElement('canvas');
    c.width = Math.round(src.width * s);
    c.height = Math.round(src.height * s);
    c.getContext('2d')!.drawImage(src, 0, 0, c.width, c.height);
    this.dirty = true;
    return c.toDataURL('image/jpeg', quality);
  }

  /**
   * Puts the camera at a pose, lets Spark finish its depth sort, and returns the capture.
   * Works in a hidden tab: it renders directly instead of waiting for animation frames (which
   * stop in background tabs) and waits on Spark's sort callback and a worker timer (not throttled).
   */
  async captureFrom(position: Vec3, target: Vec3, maxSide = 768): Promise<string> {
    this.anim = null;
    this.camera.position.set(...position);
    this.controls.target.set(...target);
    this.controls.update();
    this.camera.updateMatrixWorld();
    // Spark sorts splats for the new viewpoint in a worker, then reports it needs a re-render.
    for (let i = 0; i < 3; i++) {
      const settled = this.nextDirty();
      this.renderer.render(this.scene, this.camera);
      if (!(await Promise.race([settled.then(() => true), workerSleep(1500).then(() => false)]))) break;
    }
    return this.capture(maxSide);
  }

  private dirtyWaiters: (() => void)[] = [];
  private nextDirty(): Promise<void> {
    return new Promise((r) => this.dirtyWaiters.push(r));
  }
  private markDirty() {
    this.dirty = true;
    const w = this.dirtyWaiters;
    this.dirtyWaiters = [];
    w.forEach((r) => r());
  }

  // ---- pins -------------------------------------------------------------------------------

  setPins(pins: Pin[]) {
    this.pins = pins;
    for (const [id, el] of this.pinEls) if (!pins.some((p) => p.id === id)) (el.remove(), this.pinEls.delete(id));
    for (const p of pins) {
      let el = this.pinEls.get(p.id);
      if (!el) {
        const btn = document.createElement('button');
        btn.className = 'pin';
        btn.type = 'button';
        el = btn;
        el.addEventListener('click', () => this.onPinClick?.(p));
        this.pinLayer.append(el);
        this.pinEls.set(p.id, el);
      }
      el.innerHTML = `<span class="pin-dot"></span><span class="pin-label"></span>`;
      el.querySelector('.pin-label')!.textContent = p.label;
      el.setAttribute('aria-label', `Pin: ${p.label}`);
    }
    this.dirty = true;
  }

  private project(p: Vec3 | THREE.Vector3): { x: number; y: number; visible: boolean } {
    const v = Array.isArray(p) ? tmp.set(...p) : tmp.copy(p);
    const cam = v.clone().applyMatrix4(this.camera.matrixWorldInverse);
    v.project(this.camera);
    return {
      x: ((v.x + 1) / 2) * this.el.clientWidth,
      y: ((1 - v.y) / 2) * this.el.clientHeight,
      visible: cam.z < 0 && Math.abs(v.x) <= 1.05 && Math.abs(v.y) <= 1.05,
    };
  }

  private placeOverlays() {
    for (const p of this.pins) {
      const el = this.pinEls.get(p.id);
      if (!el) continue;
      const s = this.project(p.position);
      el.style.transform = `translate(${s.x}px, ${s.y}px)`;
      el.hidden = !s.visible;
    }
    if (this.measurePts.length === 2) {
      const mid = this.measurePts[0].clone().add(this.measurePts[1]).multiplyScalar(0.5);
      const s = this.project(mid);
      this.measureLabel.style.transform = `translate(${s.x}px, ${s.y}px)`;
      this.measureLabel.hidden = !s.visible;
    }
  }

  // ---- measuring --------------------------------------------------------------------------

  setMode(mode: ToolMode) {
    this.mode = mode;
    this.el.dataset.mode = mode;
    if (mode === 'orbit') this.clearMeasure();
  }

  clearMeasure() {
    this.measurePts = [];
    this.measureLine.visible = false;
    this.measureLabel.hidden = true;
    this.dirty = true;
  }

  formatUnits(units: number): string {
    if (this.metersPerUnit == null) return `${units.toFixed(2)} units`;
    const m = units * this.metersPerUnit;
    return m < 1 ? `${Math.round(m * 100)} cm` : `${m.toFixed(2)} m`;
  }

  private bindPointer() {
    let down: [number, number] | null = null;
    this.canvas.addEventListener('pointerdown', (e) => (down = [e.clientX, e.clientY]));
    this.canvas.addEventListener('pointerup', (e) => {
      if (!down || Math.hypot(e.clientX - down[0], e.clientY - down[1]) > 5) return;
      const r = this.canvas.getBoundingClientRect();
      const hit = this.raycast(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
      if (!hit) return;
      if (this.mode === 'orbit') return;
      if (this.measurePts.length === 2) this.measurePts = [];
      this.measurePts.push(new THREE.Vector3(...hit.point));
      const pts = this.measurePts.length === 1 ? [this.measurePts[0], this.measurePts[0]] : this.measurePts;
      this.measureLine.geometry.setFromPoints(pts);
      this.measureLine.visible = true;
      if (this.measurePts.length === 2) {
        const units = this.measurePts[0].distanceTo(this.measurePts[1]);
        this.measureLabel.textContent = this.mode === 'calibrate' ? `${units.toFixed(3)} units` : this.formatUnits(units);
        this.measureLabel.hidden = false;
        this.onMeasure?.({ a: this.measurePts[0].toArray() as Vec3, b: this.measurePts[1].toArray() as Vec3, units }, this.mode);
      }
      this.dirty = true;
    });
    this.canvas.addEventListener('dblclick', (e) => {
      if (this.mode !== 'orbit') return;
      const r = this.canvas.getBoundingClientRect();
      const hit = this.raycast(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
      if (hit) this.flyTo(hit.point);
    });
  }
}
