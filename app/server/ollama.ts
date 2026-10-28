// Local model calls through Ollama. Everything streams so long generations never hit
// fetch's header timeout, and every call reports its timing for the agent trace.
const HOST = process.env.OLLAMA_HOST?.replace(/\/$/, '') ?? 'http://127.0.0.1:11434';
export const VLM = process.env.SF_VLM ?? 'qwen3-vl:4b-instruct';
const FALLBACK = process.env.SF_VLM_FALLBACK ?? 'qwen3-vl:2b-instruct';

interface ChatOpts {
  model?: string;
  prompt: string;
  system?: string;
  images?: string[];
  format?: unknown;
  maxTokens?: number;
  signal?: AbortSignal;
}

export interface ChatResult {
  text: string;
  model: string;
  ms: number;
  tokens: number;
}

let resolvedModel: string | null = null;

/** Lists installed models; picks the configured VLM or its fallback. */
export async function status(): Promise<{ ok: boolean; model: string | null; models: string[]; error?: string }> {
  try {
    const r = await fetch(`${HOST}/api/tags`, { signal: AbortSignal.timeout(3000) });
    const { models = [] } = (await r.json()) as { models: { name: string }[] };
    const names = models.map((m) => m.name);
    const has = (m: string) => names.includes(m) || names.includes(`${m}:latest`);
    resolvedModel = has(VLM) ? VLM : has(FALLBACK) ? FALLBACK : null;
    return { ok: true, model: resolvedModel, models: names };
  } catch (e) {
    return { ok: false, model: null, models: [], error: `Ollama is not reachable at ${HOST}` };
  }
}

async function model(): Promise<string> {
  if (!resolvedModel) await status();
  if (!resolvedModel) throw new Error(`No vision model installed. Run: ollama pull ${VLM}`);
  return resolvedModel;
}

// By default Ollama decides how many layers go on the GPU. On a 5 GB card with the viewer open it
// keeps ~30% of the 4B model on the CPU (~45 s a view). SF_NUM_GPU=99 forces it all onto the GPU:
// faster in a single test, but over a 12-view scan it starved the browser's WebGL of VRAM and froze
// the tab, so it is opt-in. If forcing fails to load, we retry without it once.
const NUM_GPU = process.env.SF_NUM_GPU ? Number(process.env.SF_NUM_GPU) : undefined;
let forceGpu = NUM_GPU !== undefined;

export async function chat(o: ChatOpts): Promise<ChatResult> {
  try {
    return await chatOnce(o, forceGpu);
  } catch (e) {
    if (!forceGpu || o.signal?.aborted || (e as Error).name === 'TimeoutError') throw e;
    console.warn(`Forcing the model onto the GPU failed (${(e as Error).message}); letting Ollama place it.`);
    forceGpu = false;
    return chatOnce(o, false);
  }
}

async function chatOnce(o: ChatOpts, gpu: boolean): Promise<ChatResult> {
  const m = o.model ?? (await model());
  const t0 = performance.now();
  const messages = [
    ...(o.system ? [{ role: 'system', content: o.system }] : []),
    { role: 'user', content: o.prompt, ...(o.images ? { images: o.images } : {}) },
  ];
  const res = await fetch(`${HOST}/api/chat`, {
    method: 'POST',
    signal: o.signal,
    body: JSON.stringify({
      model: m,
      stream: true,
      think: false,
      messages,
      ...(o.format ? { format: o.format } : {}),
      keep_alive: '15m',
      options: { temperature: 0, num_ctx: 4096, num_predict: o.maxTokens ?? 512, ...(gpu ? { num_gpu: NUM_GPU } : {}) },
    }),
  });
  if (!res.ok || !res.body) throw new Error(`Ollama ${res.status}: ${await res.text()}`);
  const dec = new TextDecoder();
  let buf = '';
  let text = '';
  let tokens = 0;
  for await (const chunk of res.body as unknown as AsyncIterable<Uint8Array>) {
    buf += dec.decode(chunk, { stream: true });
    let nl: number;
    while ((nl = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, nl).trim();
      buf = buf.slice(nl + 1);
      if (!line) continue;
      const msg = JSON.parse(line);
      if (msg.error) throw new Error(msg.error);
      text += msg.message?.content ?? '';
      if (msg.done) tokens = msg.eval_count ?? 0;
    }
  }
  return { text: text.trim(), model: m, ms: Math.round(performance.now() - t0), tokens };
}

export interface Box {
  label: string;
  /** [x1, y1, x2, y2], 0–1000 normalised (Qwen-VL convention). */
  box: [number, number, number, number];
}

/** Pulls every {"bbox_2d": [...], "label": "..."} out of a reply, tolerating fences and truncation. */
export function parseBoxes(text: string): Box[] {
  const out: Box[] = [];
  const re = /\{[^{}]*?"bbox_2d"\s*:\s*\[\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*\][^{}]*?\}/g;
  for (const m of text.matchAll(re)) {
    const label = m[0].match(/"label"\s*:\s*"([^"]+)"/)?.[1];
    if (!label) continue;
    let [x1, y1, x2, y2] = m.slice(1, 5).map(Number);
    if (x2 < x1) [x1, x2] = [x2, x1];
    if (y2 < y1) [y1, y2] = [y2, y1];
    const clamp = (v: number) => Math.max(0, Math.min(1000, v));
    const box: Box['box'] = [clamp(x1), clamp(y1), clamp(x2), clamp(y2)];
    if (box[2] - box[0] < 8 || box[3] - box[1] < 8) continue;
    out.push({ label: label.toLowerCase().trim(), box });
  }
  // The model sometimes repeats itself at the end of a list; drop exact duplicates.
  const seen = new Set<string>();
  return out.filter((b) => {
    const k = `${b.label}|${b.box.map((v) => Math.round(v / 10)).join(',')}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

const DETECT_PROMPT =
  'Locate every distinct physical object in this indoor scene: furniture, appliances, electronics, decor, fixtures, plants. ' +
  'Use specific nouns (sofa, armchair, ottoman, dining table, side table, tv, lamp, plant, rug, vase). ' +
  'Skip walls, floor, ceiling, windows and anything mostly cut off at the image edge. At most 15 objects, largest first. ' +
  'Output one compact JSON array on a single line: [{"bbox_2d":[x1,y1,x2,y2],"label":"short noun"}]';

export async function detect(imageB64: string, signal?: AbortSignal): Promise<{ boxes: Box[]; ms: number; model: string }> {
  // ~25 tokens per object; the cap also stops a model that starts repeating itself.
  const r = await chat({ prompt: DETECT_PROMPT, images: [imageB64], maxTokens: 520, signal });
  return { boxes: parseBoxes(r.text), ms: r.ms, model: r.model };
}

export async function describe(imageB64: string, question: string, signal?: AbortSignal): Promise<ChatResult> {
  return chat({
    system: 'You look at a rendered view of a 3D capture of a real place and answer the question in one or two plain sentences. Say so when you cannot tell.',
    prompt: question,
    images: [imageB64],
    maxTokens: 160,
    signal,
  });
}
