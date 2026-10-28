// Index once, answer many: render views around the space, have the local VLM box the objects
// in each, raycast each box into the splat for a 3D point, and send the sightings to be merged.
import * as THREE from 'three';
import type { Scene, Sighting, Vec3 } from '../shared/types.ts';
import { api } from './api.ts';
import type { Viewer } from './viewer.ts';

export interface ScanPose {
  position: Vec3;
  target: Vec3;
}

export interface ScanProgress {
  view: number;
  views: number;
  found: number;
  lastMs: number;
  thumb?: string;
  labels?: string[];
}

/**
 * For a splat without capture cameras, the trustworthy viewpoint is the one on screen: orbit its
 * target across ±75° at the current distance and closer in. A guessed ring around the scene's
 * centre put most cameras among floaters and found 1 object in a furnished room (tested).
 */
export function anchorPoses(anchor: ScanPose, n: number): ScanPose[] {
  const t = new THREE.Vector3(...anchor.target);
  const off = new THREE.Vector3(...anchor.position).sub(t);
  const rings = [1, 0.6];
  const per = Math.ceil(n / rings.length);
  const poses: ScanPose[] = [];
  for (const r of rings) {
    for (let i = 0; i < per && poses.length < n; i++) {
      const a = THREE.MathUtils.degToRad(-75 + (150 * i) / Math.max(1, per - 1));
      const p = off.clone().applyAxisAngle(new THREE.Vector3(0, 1, 0), a).multiplyScalar(r).add(t);
      poses.push({ position: p.toArray() as Vec3, target: anchor.target });
    }
  }
  return poses;
}

/**
 * Scenes reconstructed from video know where the real camera stood: evenly spaced capture
 * cameras give views that look like the footage, where the splat is sharpest.
 */
export function capturePoses(cams: { position: Vec3; direction: Vec3 }[], flip: boolean, n: number, look: number): ScanPose[] {
  const pick = n >= cams.length ? cams : Array.from({ length: n }, (_, i) => cams[Math.round((i * (cams.length - 1)) / Math.max(1, n - 1))]);
  // The viewer rotates a flipped splat 180° about X: (x, y, z) → (x, −y, −z).
  const f = (v: Vec3): Vec3 => (flip ? [v[0], -v[1], -v[2]] : v);
  return pick.map((c) => {
    const p = f(c.position);
    const d = f(c.direction);
    return { position: p, target: [p[0] + d[0] * look, p[1] + d[1] * look, p[2] + d[2] * look] };
  });
}

/** Sample points inside a box (0–1000 coords) as NDC; the median-depth hit is the object's point. */
function samplePoints(b: [number, number, number, number]): [number, number][] {
  const [x1, y1, x2, y2] = b.map((v) => v / 1000);
  const cx = (x1 + x2) / 2, cy = (y1 + y2) / 2, w = x2 - x1, h = y2 - y1;
  return [[cx, cy], [cx - w * 0.18, cy], [cx + w * 0.18, cy], [cx, cy - h * 0.18], [cx, cy + h * 0.18]].map(([x, y]) => [x * 2 - 1, -(y * 2 - 1)]);
}

export async function scan(viewer: Viewer, scene: Pick<Scene, 'id' | 'cameras' | 'flip'> & { url: string }, n: number, onProgress: (p: ScanProgress) => void, signal: AbortSignal): Promise<{ objects: number; sightings: number }> {
  if (!viewer.stats || viewer.loadedUrl !== scene.url) throw new Error('Load this scene first');
  const home = viewer.homeView();
  const poses = scene.cameras?.length ? capturePoses(scene.cameras, scene.flip, n, viewer.stats.extent * 0.3) : anchorPoses(home, n);
  n = poses.length;
  const sceneId = scene.id;
  const sightings: Sighting[] = [];
  const cam = viewer.camera;
  const vfov = THREE.MathUtils.degToRad(cam.fov);
  const fwd = new THREE.Vector3();
  let lastMs = 0;
  let failed = 0;
  try {
    for (let i = 0; i < poses.length; i++) {
      if (signal.aborted || viewer.contextLost) throw new DOMException('Scan stopped', 'AbortError');
      // In testing a scene switch mid-scan filed one room's objects under another; never again.
      if (viewer.loadedUrl !== scene.url) throw new Error('Another scene was opened during the scan');
      const image = await viewer.captureFrom(poses[i].position, poses[i].target, 768);
      onProgress({ view: i, views: n, found: sightings.length, lastMs, thumb: image });
      const t0 = performance.now();
      let boxes: { label: string; box: [number, number, number, number] }[];
      try {
        // The server keeps each view so later questions can look at the object from where it was seen.
        ({ boxes } = await api<{ boxes: typeof boxes }>('/api/detect', { method: 'POST', body: { image, sceneId, view: i }, signal }));
      } catch (e) {
        if (signal.aborted) throw e;
        // One bad view (a timeout, a model hiccup) costs that view, not the whole index.
        failed++;
        if (failed > n / 3) throw new Error(`${failed} views failed; last error: ${(e as Error).message}`);
        continue;
      }
      lastMs = Math.round(performance.now() - t0);
      // The camera has not moved since the capture, so its rays match the boxes.
      cam.getWorldDirection(fwd);
      const hfov = 2 * Math.atan(Math.tan(vfov / 2) * cam.aspect);
      for (const b of boxes) {
        const hits = samplePoints(b.box)
          .map(([x, y]) => viewer.raycast(x, y, cam))
          .filter((h): h is NonNullable<typeof h> => !!h);
        if (!hits.length) continue;
        hits.sort((a, c) => a.distance - c.distance);
        const hit = hits[hits.length >> 1];
        // Depth along the view axis turns the box's angular size into scene units.
        const depth = new THREE.Vector3(...hit.point).sub(cam.position).dot(fwd);
        const width = ((b.box[2] - b.box[0]) / 1000) * 2 * depth * Math.tan(hfov / 2);
        const height = ((b.box[3] - b.box[1]) / 1000) * 2 * depth * Math.tan(vfov / 2);
        sightings.push({ label: b.label, position: hit.point, width, height, view: i });
      }
      onProgress({ view: i + 1, views: n, found: sightings.length, lastMs, labels: boxes.map((b) => b.label) });
    }
  } finally {
    if (viewer.loadedUrl !== scene.url) throw new Error('Another scene was opened during the scan');
    viewer.camera.position.set(...home.position);
    viewer.controls.target.set(...home.target);
    viewer.requestRender();
  }
  const r = await api<{ objects: unknown[]; sightings: number }>(`/api/scenes/${sceneId}/objects`, { method: 'PUT', body: { sightings, scanViews: n } });
  return { objects: r.objects.length, sightings: r.sightings };
}
