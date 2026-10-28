// Day-1 spike: time one Qwen3-VL bbox-detection request against a captured view.
// Usage: node spike/vlm-bbox.mjs spike/out/view-1.png [model] [maxSide]
// Streams so a slow model can't hit fetch's header timeout; prints time-to-first-token and token rates.
// Writes <image>.boxes.json next to the image; view it at /boxes.html?v=view-1
import { readFileSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

const [img, model = 'qwen3-vl:4b', maxSide = '768'] = process.argv.slice(2);
if (!img) throw new Error('usage: node spike/vlm-bbox.mjs <image.png> [model] [maxSide]');

// Downscale with ffmpeg if available (vision tokens scale with pixel count).
let bytes = readFileSync(img);
const ffmpeg = process.env.FFMPEG;
if (ffmpeg) {
  bytes = execFileSync(ffmpeg, ['-loglevel', 'error', '-i', img, '-vf', `scale='min(${maxSide},iw)':-2`, '-f', 'image2pipe', '-vcodec', 'mjpeg', '-q:v', '3', '-'], { maxBuffer: 1 << 26 });
}

const schema = {
  type: 'object',
  properties: {
    objects: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          label: { type: 'string' },
          bbox_2d: { type: 'array', items: { type: 'integer' }, minItems: 4, maxItems: 4 },
        },
        required: ['label', 'bbox_2d'],
      },
    },
  },
  required: ['objects'],
};

const useSchema = !process.env.NOSCHEMA;
const numGpu = process.env.NUM_GPU ? Number(process.env.NUM_GPU) : undefined;
const prompt = useSchema
  ? 'Detect up to 15 distinct physical objects in this indoor scene (furniture, appliances, decor, fixtures). ' +
    'For each, give a short lowercase label and bbox_2d as [x1, y1, x2, y2] in 0-1000 normalized coordinates. ' +
    'Return JSON only.'
  : 'Locate up to 15 distinct physical objects in this indoor scene (furniture, appliances, decor, fixtures). ' +
    'Output one compact JSON array on a single line, no spaces: [{"bbox_2d":[x1,y1,x2,y2],"label":"..."}]';

const t0 = performance.now();
let first = 0;
let text = '';
let final = {};
const res = await fetch('http://127.0.0.1:11434/api/chat', {
  method: 'POST',
  body: JSON.stringify({
    model,
    stream: true,
    think: false,
    ...(useSchema ? { format: schema } : {}),
    options: { temperature: 0, num_ctx: 4096, ...(numGpu !== undefined ? { num_gpu: numGpu } : {}) },
    keep_alive: '10m',
    messages: [{ role: 'user', content: prompt, images: [bytes.toString('base64')] }],
  }),
});
if (!res.ok) throw new Error(await res.text());
const dec = new TextDecoder();
let buf = '';
for await (const chunk of res.body) {
  buf += dec.decode(chunk, { stream: true });
  let nl;
  while ((nl = buf.indexOf('\n')) >= 0) {
    const line = buf.slice(0, nl).trim();
    buf = buf.slice(nl + 1);
    if (!line) continue;
    const msg = JSON.parse(line);
    if (msg.message?.content) {
      if (!first) first = performance.now() - t0;
      text += msg.message.content;
    }
    if (msg.done) final = msg;
  }
}
const wallMs = performance.now() - t0;

const ms = (k) => ((final[k] ?? 0) / 1e6).toFixed(0);
let parsed;
try {
  const j = JSON.parse(text.replace(/^```(?:json)?\s*|\s*```$/g, ''));
  parsed = Array.isArray(j) ? { objects: j } : j;
} catch { parsed = { raw: text }; }
writeFileSync(img.replace(/\.png$/, '.boxes.json'), JSON.stringify(parsed, null, 2));

const genRate = final.eval_count / ((final.eval_duration ?? 1) / 1e9);
console.log(`model ${model} | image ${bytes.length} bytes`);
console.log(`wall ${wallMs.toFixed(0)} ms | first token ${first.toFixed(0)} ms | load ${ms('load_duration')} ms | prompt ${ms('prompt_eval_duration')} ms (${final.prompt_eval_count} tok) | gen ${ms('eval_duration')} ms (${final.eval_count} tok, ${genRate.toFixed(1)} tok/s)`);
console.log(`objects ${parsed.objects?.length ?? 'parse failed'}`);
for (const o of parsed.objects ?? []) console.log(`  ${o.label.padEnd(24)} ${JSON.stringify(o.bbox_2d)}`);
