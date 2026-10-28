// Video → Gaussian splat, all local and open source:
//   FFmpeg (frames) → COLMAP (camera poses, sparse points) → Brush (3DGS training) → .ply
// Each stage reports progress through `onProgress`; the caller decides how to surface it.
import { spawn } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { DATA_DIR } from './paths.ts';
import { colmapEnv, findTools } from './tools.ts';

export type Stage = 'frames' | 'features' | 'matching' | 'mapping' | 'undistort' | 'training' | 'done';

export interface Progress {
  stage: Stage;
  /** 0–1 within the stage */
  fraction: number;
  message: string;
}

export interface PipelineOptions {
  video: string;
  workDir: string;
  /** Frames sampled per second of video. */
  fps?: number;
  /** Longest side of extracted frames. */
  frameSize?: number;
  /** Brush training steps. */
  steps?: number;
  onProgress?: (p: Progress) => void;
  signal?: AbortSignal;
}

export interface PipelineResult {
  ply: string;
  cameras: string;
  frames: number;
  registered: number;
  timings: Record<string, number>;
}

function run(
  cmd: string,
  args: string[],
  opts: { cwd?: string; env?: NodeJS.ProcessEnv; signal?: AbortSignal; onLine?: (line: string) => void },
): Promise<void> {
  return new Promise((ok, fail) => {
    const env = opts.env ?? (/colmap/i.test(basename(cmd)) ? colmapEnv(cmd) : undefined);
    const child = spawn(cmd, args, { cwd: opts.cwd, env, signal: opts.signal, windowsHide: true });
    const tail: string[] = [];
    const feed = (data: Buffer) => {
      for (const line of data.toString().split(/\r?\n|\r/)) {
        if (!line.trim()) continue;
        tail.push(line);
        if (tail.length > 30) tail.shift();
        opts.onLine?.(line);
      }
    };
    child.stdout.on('data', feed);
    child.stderr.on('data', feed);
    child.on('error', fail);
    child.on('close', (code) =>
      code === 0 ? ok() : fail(new Error(`${cmd.split(/[\\/]/).pop()} exited with ${code}:\n${tail.join('\n')}`)),
    );
  });
}

// Measured on a Quadro P2000: 7,000 steps in 684 s.
const DEFAULT_RATE = 10;
const RATE_FILE = join(DATA_DIR, 'brush-rate.json');

function readRate(): number {
  try {
    const r = JSON.parse(readFileSync(RATE_FILE, 'utf8')).stepsPerSecond;
    return r > 0 ? r : DEFAULT_RATE;
  } catch {
    return DEFAULT_RATE;
  }
}

function writeRate(stepsPerSecond: number) {
  if (Number.isFinite(stepsPerSecond) && stepsPerSecond > 0) writeFileSync(RATE_FILE, JSON.stringify({ stepsPerSecond }));
}

function count(dir: string, re: RegExp): number {
  return existsSync(dir) ? readdirSync(dir).filter((f) => re.test(f)).length : 0;
}

export interface CaptureCamera {
  /** Camera centre and viewing direction in the splat's own (COLMAP) frame; Brush keeps that frame. */
  position: [number, number, number];
  direction: [number, number, number];
}

/** Parses COLMAP's images.txt into camera centres (C = -Rᵀt) and view directions (Rᵀ·ẑ), in capture order. */
export function parseColmapImages(text: string): CaptureCamera[] {
  const rows = text.split(/\r?\n/).filter((l) => l && !l.startsWith('#'));
  const cams: { name: string; cam: CaptureCamera }[] = [];
  for (let i = 0; i < rows.length; i += 2) {
    const f = rows[i].trim().split(/\s+/);
    const [qw, qx, qy, qz, tx, ty, tz] = f.slice(1, 8).map(Number);
    const R = [
      [1 - 2 * (qy * qy + qz * qz), 2 * (qx * qy - qz * qw), 2 * (qx * qz + qy * qw)],
      [2 * (qx * qy + qz * qw), 1 - 2 * (qx * qx + qz * qz), 2 * (qy * qz - qx * qw)],
      [2 * (qx * qz - qy * qw), 2 * (qy * qz + qx * qw), 1 - 2 * (qx * qx + qy * qy)],
    ];
    const t = [tx, ty, tz];
    const position = [0, 1, 2].map((j) => -(R[0][j] * t[0] + R[1][j] * t[1] + R[2][j] * t[2])) as CaptureCamera['position'];
    const direction = [R[2][0], R[2][1], R[2][2]] as CaptureCamera['direction'];
    cams.push({ name: f[9], cam: { position, direction } });
  }
  return cams.sort((a, b) => a.name.localeCompare(b.name)).map((c) => c.cam);
}

/** Reads COLMAP's images.txt-free summary by asking `model_analyzer`. */
async function registeredImages(colmap: string, model: string): Promise<number> {
  let n = 0;
  await run(colmap, ['model_analyzer', '--path', model], {
    onLine: (l) => {
      const m = l.match(/Registered images:\s*(\d+)/i);
      if (m) n = Number(m[1]);
    },
  });
  return n;
}

export async function videoToSplat(o: PipelineOptions): Promise<PipelineResult> {
  const tools = findTools();
  for (const [k, v] of Object.entries(tools)) if (!v) throw new Error(`Missing tool: ${k}. Run scripts/setup-tools.ps1.`);
  const { ffmpeg, colmap, brush } = tools as Required<{ [K in keyof typeof tools]: string }>;
  const report = o.onProgress ?? (() => {});
  const fps = o.fps ?? 8;
  const size = o.frameSize ?? 1280;
  const steps = o.steps ?? 7000;
  const timings: Record<string, number> = {};
  const time = async <T>(name: string, fn: () => Promise<T>) => {
    const t = performance.now();
    const r = await fn();
    timings[name] = Math.round(performance.now() - t);
    return r;
  };

  const images = join(o.workDir, 'images');
  const db = join(o.workDir, 'database.db');
  const sparse = join(o.workDir, 'sparse');
  const dense = join(o.workDir, 'dense');
  const out = join(o.workDir, 'train');
  rmSync(o.workDir, { recursive: true, force: true });
  for (const d of [images, sparse, out]) mkdirSync(d, { recursive: true });

  // 1. Frames
  report({ stage: 'frames', fraction: 0, message: 'Sampling frames from the video' });
  await time('frames', () =>
    run(ffmpeg, ['-loglevel', 'error', '-i', o.video, '-vf', `fps=${fps},scale='if(gt(iw,ih),${size},-2)':'if(gt(iw,ih),-2,${size})'`, '-q:v', '2', join(images, 'f_%04d.jpg')], { signal: o.signal }).catch((e) => {
      if (o.signal?.aborted) throw e;
      throw new Error(`FFmpeg could not read this video. ${(e as Error).message.split('\n').slice(1).join(' ').trim()}`.trim());
    }),
  );
  const frames = count(images, /\.jpg$/);
  if (frames < 10) throw new Error(`Only ${frames} frames came out of the video; it needs at least 10.`);
  report({ stage: 'frames', fraction: 1, message: `${frames} frames` });

  // 2. Features
  report({ stage: 'features', fraction: 0, message: 'Finding SIFT features' });
  let done = 0;
  await time('features', () =>
    run(colmap, ['feature_extractor', '--database_path', db, '--image_path', images, '--ImageReader.single_camera', '1', '--ImageReader.camera_model', 'OPENCV'], {
      signal: o.signal,
      onLine: (l) => {
        if (/Processed file|Features:/i.test(l)) {
          done = Math.min(frames, done + (/Processed file/i.test(l) ? 1 : 0));
          report({ stage: 'features', fraction: done / frames, message: `Features in ${done} of ${frames} frames` });
        }
      },
    }),
  );

  // 3. Matching — video frames are ordered, so sequential matching is far cheaper than exhaustive.
  report({ stage: 'matching', fraction: 0, message: 'Matching neighbouring frames' });
  await time('matching', () =>
    run(colmap, ['sequential_matcher', '--database_path', db, '--SequentialMatching.overlap', '12'], {
      signal: o.signal,
      onLine: (l) => {
        const m = l.match(/Matching block \[(\d+)\/(\d+)/);
        if (m) report({ stage: 'matching', fraction: Number(m[1]) / Number(m[2]), message: `Matching block ${m[1]} of ${m[2]}` });
      },
    }),
  );

  // 4. Mapping
  report({ stage: 'mapping', fraction: 0, message: 'Solving camera poses' });
  let reg = 0;
  await time('mapping', () =>
    run(colmap, ['mapper', '--database_path', db, '--image_path', images, '--output_path', sparse], {
      signal: o.signal,
      onLine: (l) => {
        if (/Registering image/i.test(l)) {
          reg++;
          report({ stage: 'mapping', fraction: Math.min(1, reg / frames), message: `Posed ${reg} of ${frames} frames` });
        }
      },
    }),
  );
  // COLMAP may split into several models; the largest one is the scene.
  const models = existsSync(sparse) ? readdirSync(sparse).filter((d) => statSync(join(sparse, d)).isDirectory()) : [];
  if (!models.length) throw new Error('COLMAP could not reconstruct the camera path. Try a slower video with more overlap.');
  let best = models[0];
  let bestN = -1;
  for (const m of models) {
    const n = await registeredImages(colmap, join(sparse, m));
    if (n > bestN) [best, bestN] = [m, n];
  }
  // A model built from a handful of frames trains into a scrap (2 of 48 posed gave a 140 KB splat in testing).
  if (bestN < Math.max(10, frames * 0.3))
    throw new Error(
      `Only ${bestN} of ${frames} frames could be placed in 3D. Film slower, keep textured things in view (furniture, pictures, rugs rather than bare walls or glossy floors) and move sideways around the room as well as forward.`,
    );
  report({ stage: 'mapping', fraction: 1, message: `${bestN} of ${frames} frames posed` });

  // 5. Undistort to a pinhole camera, the model every 3DGS trainer accepts.
  report({ stage: 'undistort', fraction: 0, message: 'Undistorting frames' });
  await time('undistort', () =>
    run(colmap, ['image_undistorter', '--image_path', images, '--input_path', join(sparse, best), '--output_path', dense, '--output_type', 'COLMAP'], { signal: o.signal }),
  );
  // Brush expects sparse/0/
  const ds = join(dense, 'sparse');
  mkdirSync(join(ds, '0'), { recursive: true });
  for (const f of readdirSync(ds)) if (f !== '0') renameSync(join(ds, f), join(ds, '0', f));
  // Keep the solved camera path: the scan later looks from where a real camera stood.
  const txt = join(o.workDir, 'poses');
  mkdirSync(txt, { recursive: true });
  await run(colmap, ['model_converter', '--input_path', join(ds, '0'), '--output_path', txt, '--output_type', 'TXT'], { signal: o.signal });
  const cameras = parseColmapImages(readFileSync(join(txt, 'images.txt'), 'utf8'));
  writeFileSync(join(o.workDir, 'cameras.json'), JSON.stringify(cameras));
  report({ stage: 'undistort', fraction: 1, message: 'Frames undistorted' });

  // 6. Train. Brush prints progress only to a terminal, so progress is estimated from the
  // steps-per-second this machine measured last time, and re-measured after every run.
  const rate = readRate();
  const expected = steps / rate;
  report({ stage: 'training', fraction: 0, message: `Training ${steps.toLocaleString('en')} steps, about ${Math.ceil(expected / 60)} min` });
  const t0 = performance.now();
  const tick = setInterval(() => {
    const s = (performance.now() - t0) / 1000;
    const left = Math.max(0, expected - s);
    report({ stage: 'training', fraction: Math.min(0.99, s / expected), message: left > 30 ? `Training, about ${Math.ceil(left / 60)} min left` : 'Training, finishing' });
  }, 2000);
  try {
    await time('training', () =>
      run(brush, [dense, '--total-steps', String(steps), '--export-every', String(steps), '--export-path', out, '--export-name', 'scene.ply', '--max-resolution', String(size), '--eval-every', String(steps * 10)], { signal: o.signal }),
    );
  } finally {
    clearInterval(tick);
  }
  writeRate(steps / (timings.training / 1000));
  const ply = existsSync(join(out, 'scene.ply')) ? join(out, 'scene.ply') : readdirSync(out).filter((f) => f.endsWith('.ply')).map((f) => join(out, f)).pop();
  if (!ply) throw new Error('Brush finished without writing a .ply');
  const final = join(o.workDir, 'scene.ply');
  copyFileSync(ply, final);
  report({ stage: 'done', fraction: 1, message: 'Splat ready' });
  return { ply: final, cameras: join(o.workDir, 'cameras.json'), frames, registered: bestN, timings };
}
