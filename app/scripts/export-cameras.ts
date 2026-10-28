// CLI: node scripts/export-cameras.ts <colmap images.txt> <out.cameras.json>
// Writes the capture camera path for a splat trained outside the app (see scan.ts capturePoses).
import { readFileSync, writeFileSync } from 'node:fs';
import { parseColmapImages } from '../server/pipeline.ts';

const [images, out] = process.argv.slice(2);
if (!images || !out) {
  console.error('usage: node scripts/export-cameras.ts <images.txt> <out.cameras.json>');
  process.exit(1);
}
const cams = parseColmapImages(readFileSync(images, 'utf8'));
writeFileSync(out, JSON.stringify(cams));
console.log(`${cams.length} cameras → ${out}`);
