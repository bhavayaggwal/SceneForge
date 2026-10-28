// Question → intent. Rules handle the common phrasings instantly; the local model
// classifies anything the rules miss, constrained by a JSON schema.
import type { Intent } from '../shared/types.ts';
import { chat } from './ollama.ts';

export interface Parsed {
  intent: Intent;
  target?: string;
  target2?: string;
  /** A length named in the question, in metres ("2.1 m sofa"). */
  lengthM?: number;
  /** "Is there a …?": answer yes or no rather than with a bare count. */
  yesNo?: boolean;
  via: 'rules' | 'model';
}

const UNIT: Record<string, number> = { m: 1, metre: 1, meter: 1, metres: 1, meters: 1, cm: 0.01, mm: 0.001, ft: 0.3048, foot: 0.3048, feet: 0.3048, in: 0.0254, inch: 0.0254, inches: 0.0254 };

function length(q: string): number | undefined {
  const m = q.match(/(\d+(?:\.\d+)?)\s*(mm|cm|m|metres?|meters?|ft|foot|feet|in|inch(?:es)?)\b/i);
  return m ? Number(m[1]) * UNIT[m[2].toLowerCase()] : undefined;
}

const clean = (s: string | undefined) =>
  s?.replace(/[?.!]+$/, '').replace(/^(the|a|an|my|any|some)\s+/i, '').replace(/\s+(here|in here|in this room|in the room|there)$/i, '').trim() || undefined;

export function parseRules(question: string): Parsed | null {
  const q = question.trim().toLowerCase().replace(/\s+/g, ' ');
  let m: RegExpMatchArray | null;

  if ((m = q.match(/^(?:how many|count(?: the)?|number of) (.+?)(?: are there| do you see| can you see| is there)?[?.!]*$/)))
    return { intent: 'count', target: clean(m[1]), via: 'rules' };

  if ((m = q.match(/(?:will|would|does|do|can) (?:a |an |the |my )?(.*?)(?:\s+(?:fit|go))(?:\s+(?:on|in|at|along|against|between|where|next to|beside)\s+(?:the\s+)?(.*?))?[?.!]*$/)) && /fit|go/.test(q)) {
    const len = length(q);
    const between = q.match(/between (?:the )?(.+?) and (?:the )?(.+?)[?.!]*$/);
    if (between) return { intent: 'fit', target: clean(between[1]), target2: clean(between[2]), lengthM: len, via: 'rules' };
    const where = clean(m[2]?.replace(/^(where|that|this)\s+/, '').replace(/\s+is$/, ''));
    return { intent: 'fit', target: where && !/^(wall|space|gap|spot|corner)$/.test(where) ? where : undefined, lengthM: len, via: 'rules' };
  }

  if ((m = q.match(/(?:how far|distance|how close)(?: is| it is)?(?: from| between)? (?:the )?(.+?) (?:to|and|from) (?:the )?(.+?)[?.!]*$/)))
    return { intent: 'distance', target: clean(m[1]), target2: clean(m[2]), via: 'rules' };

  if ((m = q.match(/(?:how (?:big|wide|tall|long|large|high) is|size of|dimensions of|measure) (?:the )?(.+?)[?.!]*$/)))
    return { intent: 'measure', target: clean(m[1]), via: 'rules' };

  if ((m = q.match(/^(?:where(?:'s| is| are)|find|show me|locate|take me to|go to|fly to)(?: the| a| an| my)? (.+?)[?.!]*$/)))
    return { intent: 'find', target: clean(m[1]), via: 'rules' };

  if (/^(?:list|what(?:'s| is| are)? (?:in|inside) (?:this|the) (?:room|place|scene)|what objects|what things|inventory|everything)/.test(q) || /list everything|what is in here|what's in here/.test(q))
    return { intent: 'list', via: 'rules' };

  if ((m = q.match(/^(?:is there|are there|do you see|can you see) (?:a |an |any )?(.+?)(?: here| in here| in this room| in the room)?[?.!]*$/)))
    return { intent: 'count', target: clean(m[1]), yesNo: true, via: 'rules' };

  if (/^(what|describe|which|tell me|why|who|how does|what colou?r)/.test(q)) return { intent: 'describe', via: 'rules' };
  return null;
}

const SCHEMA = {
  type: 'object',
  properties: {
    intent: { type: 'string', enum: ['find', 'count', 'measure', 'distance', 'fit', 'list', 'describe'] },
    target: { type: 'string' },
    target2: { type: 'string' },
    length_m: { type: 'number' },
  },
  required: ['intent'],
};

export async function parseIntent(question: string, labels: string[]): Promise<Parsed> {
  const r = parseRules(question);
  if (r) return r;
  const res = await chat({
    system:
      'Classify a question about a 3D capture of a room. intent: find (where is X), count (how many X), measure (size of X), ' +
      'distance (between X and Y), fit (does an item of length_m fit at X or between X and Y), list (everything in the room), describe (anything else, answered by looking). ' +
      'target and target2 are object nouns, preferably from this list: ' + labels.slice(0, 60).join(', '),
    prompt: question,
    format: SCHEMA,
    maxTokens: 80,
  });
  try {
    const j = JSON.parse(res.text);
    return { intent: j.intent, target: clean(j.target), target2: clean(j.target2), lengthM: j.length_m ?? length(question), via: 'model' };
  } catch {
    return { intent: 'describe', via: 'model' };
  }
}
