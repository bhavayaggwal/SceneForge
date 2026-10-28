// The spatial agent. The model only classifies the question (and answers "describe" by looking);
// every figure in an answer comes from the object index and real geometry, never from generation.
import { canonical, matches, plural } from '../shared/labels.ts';
import type { Pin, Scene, SceneObject, TraceStep, Vec3, ViewerCommand } from '../shared/types.ts';
import { objects as objectsDb, pins as pinsDb } from './db.ts';
import { parseIntent, type Parsed } from './intent.ts';
import { describe } from './ollama.ts';
import { scanView } from './views.ts';

export interface AgentContext {
  scene: Scene;
  /** Base64 JPEG of what the viewer shows now; used by "describe". */
  view?: string;
  /** Asks the open viewer for a render when no view came with the question. */
  renderView?: () => Promise<string | null>;
  onStep?: (s: TraceStep) => void;
}

export interface AgentAnswer {
  text: string;
  intent: Parsed;
  trace: TraceStep[];
  commands: ViewerCommand[];
  pins: Pin[];
  /** Objects the answer is about (for MCP clients). */
  objects: SceneObject[];
}

const dist = (a: Vec3, b: Vec3) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

export function formatLength(units: number, mpu: number | null): string {
  if (mpu == null) return `${units.toFixed(2)} units`;
  const m = units * mpu;
  return m < 1 ? `${Math.round(m * 100)} cm` : `${m.toFixed(2)} m`;
}

function nearestOther(o: SceneObject, all: SceneObject[]): SceneObject | null {
  let best: SceneObject | null = null;
  let bd = Infinity;
  for (const x of all) {
    if (x.id === o.id || canonical(x.label) === canonical(o.label)) continue;
    const d = dist(x.position, o.position);
    if (d < bd) [best, bd] = [x, d];
  }
  return best;
}

/** The best-confirmed indexed object a free-form question names ("what colour is the rug?"), if any. */
export function mentioned(question: string, index: SceneObject[]): SceneObject | null {
  const words = question.toLowerCase().replace(/[^a-z\s-]/g, ' ').split(/\s+/).filter(Boolean);
  const grams = [...words, ...words.slice(1).map((w, i) => `${words[i]} ${w}`)];
  const hits = index.filter((o) => grams.some((g) => g.length > 2 && matches(g, o.label)));
  return hits.sort((a, b) => b.views.length - a.views.length)[0] ?? null;
}

/** Most-confirmed objects first: more sightings means the index trusts it more. */
const byConfidence = (a: SceneObject, b: SceneObject) => b.views.length - a.views.length;

export async function ask(question: string, ctx: AgentContext): Promise<AgentAnswer> {
  const trace: TraceStep[] = [];
  const commands: ViewerCommand[] = [];
  const newPins: Pin[] = [];
  const step = async <T>(tool: string, fn: () => Promise<T> | T, detail: (r: T) => string): Promise<T> => {
    const t = performance.now();
    const r = await fn();
    const s = { tool, detail: detail(r), ms: Math.round(performance.now() - t) };
    trace.push(s);
    ctx.onStep?.(s);
    return r;
  };

  const { scene } = ctx;
  const mpu = scene.metersPerUnit;
  const index = objectsDb.list(scene.id);
  const labels = [...new Set(index.map((o) => o.label))];

  const intent = await step('parse_intent', () => parseIntent(question, labels), (p) =>
    [p.intent, p.target, p.target2, p.lengthM != null ? `${p.lengthM} m` : null].filter(Boolean).join(' · ') + ` (${p.via})`,
  );

  const lookup = (term: string | undefined) => (term ? index.filter((o) => matches(term, o.label)).sort(byConfidence) : []);
  let cleared = false;
  const pin = (o: SceneObject, label = o.label) => {
    // A new answer's pins replace the last answer's, so the view shows what was just asked.
    if (!cleared) {
      pinsDb.clearAnswerPins(scene.id);
      cleared = true;
    }
    const p = pinsDb.add(scene.id, label, o.position, o.id);
    newPins.push(p);
    return p;
  };
  const finish = (text: string, about: SceneObject[] = []): AgentAnswer => {
    if (cleared) commands.push({ type: 'pins_changed' });
    return { text, intent, trace, commands, pins: newPins, objects: about };
  };

  if (!index.length && intent.intent !== 'describe') {
    return finish('This place has no object index yet. Run Index scene first; it takes a few minutes on this machine.');
  }

  const unitNote = mpu == null ? ' Set the scale to get metres.' : '';

  switch (intent.intent) {
    case 'find': {
      const hits = await step('query_index', () => lookup(intent.target), (h) => `${h.length} match${h.length === 1 ? '' : 'es'} for "${intent.target}"`);
      if (!hits.length) return finish(`I can't find ${intent.target ? `a ${intent.target}` : 'that'} in the index. Indexed here: ${labels.slice(0, 8).join(', ')}.`);
      const o = hits[0];
      await step('fly_to', () => commands.push({ type: 'fly_to', position: o.position, distance: Math.max(o.width, o.height) * 2.2 }), () => o.label);
      await step('add_pin', () => pin(o), () => o.label);
      const near = nearestOther(o, index);
      const rel = near ? `, next to the ${near.label} (${formatLength(dist(o.position, near.position), mpu)} away)` : '';
      const more = hits.length > 1 ? ` There ${hits.length === 2 ? 'is 1 more' : `are ${hits.length - 1} more`}; ask how many to see them all.` : '';
      return finish(`Here is the ${o.label}${rel}.${more}`, [o]);
    }
    case 'count': {
      const hits = await step('query_index', () => lookup(intent.target), (h) => `${h.length} match${h.length === 1 ? '' : 'es'} for "${intent.target}"`);
      const word = canonical(intent.target ?? 'object');
      if (!hits.length)
        return finish(intent.yesNo ? `I found no ${word} when I indexed this place. Small or partly hidden things can be missed.` : `I count no ${plural(word, 2)} in the index.`);
      await step('frame', () => commands.push({ type: 'frame', positions: hits.map((h) => h.position) }), () => `${hits.length} positions`);
      await step('add_pin', () => hits.forEach((h, i) => pin(h, hits.length > 1 ? `${h.label} ${i + 1}` : h.label)), () => `${hits.length} pins`);
      const weak = hits.filter((h) => h.views.length < 2).length;
      const caveat = weak ? ` ${weak} of them ${weak === 1 ? 'was' : 'were'} seen in only one view, so check ${weak === 1 ? 'it' : 'them'}.` : '';
      const lead = intent.yesNo ? 'Yes. ' : '';
      return finish(`${lead}There ${hits.length === 1 ? 'is 1' : `are ${hits.length}`} ${plural(word, hits.length)}.${caveat}`, hits);
    }
    case 'measure': {
      const hits = await step('query_index', () => lookup(intent.target), (h) => `${h.length} match${h.length === 1 ? '' : 'es'}`);
      if (!hits.length) return finish(`I can't find ${intent.target ? `a ${intent.target}` : 'that'} to measure.`);
      const o = hits[0];
      await step('measure', () => o, () => `${formatLength(o.width, mpu)} × ${formatLength(o.height, mpu)} from ${o.views.length} view${o.views.length === 1 ? '' : 's'}`);
      await step('fly_to', () => commands.push({ type: 'fly_to', position: o.position, distance: Math.max(o.width, o.height) * 2.2 }), () => o.label);
      await step('add_pin', () => pin(o, `${o.label} · ${formatLength(o.width, mpu)} wide`), () => o.label);
      return finish(`The ${o.label} is about ${formatLength(o.width, mpu)} wide and ${formatLength(o.height, mpu)} tall, judged from ${o.views.length} view${o.views.length === 1 ? '' : 's'}.${unitNote} For an exact figure, use Measure and click its two ends.`, [o]);
    }
    case 'distance': {
      const a = lookup(intent.target);
      const b = lookup(intent.target2);
      await step('query_index', () => [a, b], () => `${a.length} "${intent.target}", ${b.length} "${intent.target2}"`);
      if (!a.length || !b.length) return finish(`I need both objects in the index; I can't find the ${!a.length ? intent.target : intent.target2}.`);
      let pair: [SceneObject, SceneObject] = [a[0], b[0]];
      let best = Infinity;
      for (const x of a) for (const y of b) if (x.id !== y.id && dist(x.position, y.position) < best) [best, pair] = [dist(x.position, y.position), [x, y]];
      await step('measure', () => best, (d) => formatLength(d, mpu));
      await step('frame', () => commands.push({ type: 'frame', positions: [pair[0].position, pair[1].position] }), () => '2 positions');
      await step('add_pin', () => { pin(pair[0]); pin(pair[1]); }, () => '2 pins');
      return finish(`The ${pair[0].label} and the ${pair[1].label} are ${formatLength(best, mpu)} apart, centre to centre.${unitNote}`, pair);
    }
    case 'fit': {
      const len = intent.lengthM;
      if (len == null) return finish('Give me the item\'s length, for example "Will a 2.1 m sofa fit between the window and the shelf?"');
      if (mpu == null) {
        commands.push({ type: 'measure_mode', reason: 'calibrate' });
        return finish('I need the scale first. Click two points a known distance apart (a door is usually 0.8 m wide), then ask again.');
      }
      let space: number | null = null;
      let about: SceneObject[] = [];
      if (intent.target && intent.target2) {
        const a = lookup(intent.target)[0];
        const b = lookup(intent.target2)[0];
        if (a && b) {
          // Clear space between two objects: centre distance minus half of each one's width.
          space = Math.max(0, dist(a.position, b.position) - a.width / 2 - b.width / 2);
          about = [a, b];
        }
      } else if (intent.target) {
        const a = lookup(intent.target)[0];
        if (a) {
          space = a.width;
          about = [a];
        }
      }
      if (space == null) {
        commands.push({ type: 'measure_mode', reason: 'fit' });
        return finish(`Click the two ends of the space and I'll compare it with ${len.toFixed(2)} m.`);
      }
      const spaceM = space * mpu;
      await step('measure', () => spaceM, (s) => `space ${s.toFixed(2)} m vs item ${len.toFixed(2)} m`);
      if (about.length) {
        await step('frame', () => commands.push({ type: 'frame', positions: about.map((o) => o.position) }), () => `${about.length} positions`);
        await step('add_pin', () => about.forEach((o) => pin(o)), () => `${about.length} pins`);
      }
      const margin = spaceM - len;
      const verdict = margin >= 0.05 ? `Yes, with about ${Math.round(margin * 100)} cm to spare` : margin >= 0 ? 'Only just; there is under 5 cm to spare' : `No, it is about ${Math.round(-margin * 100)} cm too long`;
      const where = about.length === 2 ? `between the ${about[0].label} and the ${about[1].label}` : `where the ${about[0].label} is`;
      return finish(`${verdict}. The space ${where} is about ${spaceM.toFixed(2)} m, estimated from the scan.`, about);
    }
    case 'list': {
      const counts = new Map<string, number>();
      for (const o of index) counts.set(o.label, (counts.get(o.label) ?? 0) + 1);
      const parts = [...counts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([l, n]) => `${n} ${plural(l, n)}`);
      await step('query_index', () => index.length, (n) => `${n} objects, ${counts.size} kinds`);
      return finish(`I indexed ${index.length} objects: ${parts.join(', ')}.`, index);
    }
    case 'describe':
    default: {
      // If the question names an indexed object, look at it from a scan view that saw it: those
      // views are sharp (taken from capture cameras) where the current view may be anywhere.
      const named = mentioned(question, index);
      if (named) {
        const v = named.views[named.views.length >> 1];
        const img = scanView(scene.id, v);
        if (img) {
          await step('scan_view', () => v, () => `view ${v + 1}, which saw the ${named.label}`);
          await step('fly_to', () => commands.push({ type: 'fly_to', position: named.position, distance: Math.max(named.width, named.height) * 2.2 }), () => named.label);
          const r = await step('look', () => describe(img, question), (x) => `${x.model}, ${x.tokens} tokens`);
          return finish(r.text, [named]);
        }
      }
      let view = ctx.view;
      if (!view && ctx.renderView) view = (await step('render_view', () => ctx.renderView!(), (v) => (v ? 'current view' : 'no viewer open'))) ?? undefined;
      if (!view) return finish('I need the viewer open to look at the place for that question.');
      const r = await step('look', () => describe(view!, question), (x) => `${x.model}, ${x.tokens} tokens`);
      return finish(r.text);
    }
  }
}
