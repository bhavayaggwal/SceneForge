// CLI: node scripts/video-to-splat.ts <video> <workDir> [steps] [fps]
import { videoToSplat } from '../server/pipeline.ts';

const [video, workDir, steps = '7000', fps = '8'] = process.argv.slice(2);
if (!video || !workDir) {
  console.error('usage: node scripts/video-to-splat.ts <video> <workDir> [steps] [fps]');
  process.exit(1);
}
let last = '';
const t0 = performance.now();
const r = await videoToSplat({
  video,
  workDir,
  steps: Number(steps),
  fps: Number(fps),
  onProgress: (p) => {
    const line = `[${((performance.now() - t0) / 1000).toFixed(0).padStart(5)}s] ${p.stage.padEnd(9)} ${(p.fraction * 100).toFixed(0).padStart(3)}%  ${p.message}`;
    // Print stage changes and every ~10% step.
    const key = `${p.stage}:${Math.floor(p.fraction * 10)}`;
    if (key !== last) console.log(line);
    last = key;
  },
});
console.log(JSON.stringify(r, null, 2));
