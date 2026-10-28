// The images a scan read, kept per scene: view i is the picture the model saw when it found the
// objects whose `views` include i. "What colour is the rug?" is answered from one of those.
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { VIEWS_DIR } from './paths.ts';

const dir = (sceneId: string) => join(VIEWS_DIR, sceneId.replace(/[^\w-]/g, ''));

export function saveScanView(sceneId: string, view: number, dataUrl: string) {
  mkdirSync(dir(sceneId), { recursive: true });
  writeFileSync(join(dir(sceneId), `${view}.jpg`), Buffer.from(dataUrl.replace(/^data:[^,]+,/, ''), 'base64'));
}

/** Base64 JPEG of a scan view, or null if that scan predates view saving. */
export function scanView(sceneId: string, view: number): string | null {
  const f = join(dir(sceneId), `${view}.jpg`);
  return existsSync(f) ? readFileSync(f).toString('base64') : null;
}

export function clearScanViews(sceneId: string) {
  rmSync(dir(sceneId), { recursive: true, force: true });
}
