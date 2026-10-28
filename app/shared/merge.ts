// Turns per-view sightings into one object index.
// Two sightings are the same object when they share a canonical label and their 3D points
// are closer than half the larger object's extent. Scale-free: works before calibration.
import { canonical } from './labels.ts';
import type { SceneObject, Sighting, Vec3 } from './types.ts';

const dist = (a: Vec3, b: Vec3) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

interface Cluster {
  label: string;
  members: Sighting[];
  position: Vec3;
  width: number;
  height: number;
}

function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

function refresh(c: Cluster) {
  // Medians resist the odd raycast that slipped past the object onto the wall behind it.
  c.position = [0, 1, 2].map((i) => median(c.members.map((m) => m.position[i]))) as Vec3;
  c.width = median(c.members.map((m) => m.width));
  c.height = median(c.members.map((m) => m.height));
}

export interface MergeOptions {
  /** Fraction of the larger extent within which two sightings merge. */
  radius?: number;
  /** Drop objects seen in fewer views than this (when the scan had enough views to confirm). */
  minViews?: number;
}

export function mergeSightings(sightings: Sighting[], opts: MergeOptions = {}): Omit<SceneObject, 'id'>[] {
  const radius = opts.radius ?? 0.5;
  const clusters: Cluster[] = [];
  // Larger objects first, so small mis-hits join them rather than seeding their own cluster.
  const sorted = [...sightings].sort((a, b) => b.width * b.height - a.width * a.height);
  for (const s of sorted) {
    const label = canonical(s.label);
    if (!label) continue;
    let best: Cluster | null = null;
    let bestD = Infinity;
    for (const c of clusters) {
      if (c.label !== label) continue;
      // One object can't be seen twice in the same view; two same-label boxes in one view are two objects.
      if (c.members.some((m) => m.view === s.view)) continue;
      const d = dist(c.position, s.position);
      const reach = radius * Math.max(c.width, c.height, s.width, s.height);
      if (d <= reach && d < bestD) [best, bestD] = [c, d];
    }
    if (best) {
      best.members.push(s);
      refresh(best);
    } else {
      clusters.push({ label, members: [s], position: [...s.position] as Vec3, width: s.width, height: s.height });
    }
  }
  const minViews = opts.minViews ?? 1;
  return clusters
    .filter((c) => new Set(c.members.map((m) => m.view)).size >= minViews)
    .map((c) => ({
      label: c.label,
      position: c.position,
      width: c.width,
      height: c.height,
      views: [...new Set(c.members.map((m) => m.view))].sort((a, b) => a - b),
    }))
    .sort((a, b) => a.label.localeCompare(b.label) || b.views.length - a.views.length);
}
