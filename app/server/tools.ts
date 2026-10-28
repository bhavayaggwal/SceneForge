// Locates the external open-source binaries the capture pipeline needs.
// Order: env override → repo tools/ folder (filled by scripts/setup-tools.ps1) → PATH.
import { existsSync, readdirSync } from 'node:fs';
import { delimiter, dirname, join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { REPO_ROOT } from './paths.ts';

const TOOLS = join(REPO_ROOT, 'tools');

function firstExisting(paths: string[]): string | null {
  for (const p of paths) if (existsSync(p)) return p;
  return null;
}

function onPath(name: string): string | null {
  const r = spawnSync(process.platform === 'win32' ? 'where' : 'which', [name], { encoding: 'utf8' });
  return r.status === 0 ? r.stdout.split(/\r?\n/)[0].trim() || null : null;
}

function ffmpegDir(): string[] {
  const root = join(TOOLS, 'ffmpeg');
  if (!existsSync(root)) return [];
  return readdirSync(root).map((d) => join(root, d, 'bin'));
}

const exe = process.platform === 'win32' ? '.exe' : '';

/** COLMAP's Windows build needs its bin/ on PATH and its Qt plugins (SiftGPU uses an OpenGL context). */
export function colmapEnv(colmap: string): NodeJS.ProcessEnv {
  const bin = dirname(colmap);
  const plugins = join(bin, '..', 'plugins');
  return {
    ...process.env,
    PATH: `${bin}${delimiter}${process.env.PATH ?? ''}`,
    ...(existsSync(plugins) ? { QT_PLUGIN_PATH: plugins } : {}),
  };
}

export interface ToolPaths {
  ffmpeg: string | null;
  ffprobe: string | null;
  colmap: string | null;
  brush: string | null;
}

export function findTools(): ToolPaths {
  return {
    ffmpeg: process.env.SF_FFMPEG ?? firstExisting(ffmpegDir().map((d) => join(d, `ffmpeg${exe}`))) ?? onPath('ffmpeg'),
    ffprobe: process.env.SF_FFPROBE ?? firstExisting(ffmpegDir().map((d) => join(d, `ffprobe${exe}`))) ?? onPath('ffprobe'),
    colmap: process.env.SF_COLMAP ?? firstExisting([join(TOOLS, 'colmap', 'bin', `colmap${exe}`), join(TOOLS, 'colmap', `COLMAP.bat`)]) ?? onPath('colmap'),
    brush: process.env.SF_BRUSH ?? firstExisting([join(TOOLS, 'brush', `brush_app${exe}`)]) ?? onPath('brush_app'),
  };
}
