// Label normalisation so "sofa", "Couch" and "couches" land on one object, and
// a question about "the telly" finds the "tv".

const SYNONYMS: Record<string, string> = {
  couch: 'sofa', settee: 'sofa', loveseat: 'sofa',
  television: 'tv', telly: 'tv', 'tv screen': 'tv', 'flat screen': 'tv', 'flat-screen tv': 'tv',
  'arm chair': 'armchair', recliner: 'armchair',
  footstool: 'ottoman', pouf: 'ottoman', 'foot stool': 'ottoman',
  'wall shelves': 'shelf', shelves: 'shelf', shelving: 'shelf', bookshelf: 'shelf', bookcase: 'shelf',
  'picture frame': 'picture', 'framed picture': 'picture', painting: 'picture', artwork: 'picture', 'wall art': 'picture', poster: 'picture',
  'floor mat': 'rug', carpet: 'rug', mat: 'rug',
  'potted plant': 'plant', 'house plant': 'plant', houseplant: 'plant',
  'ceiling fan': 'fan',
  'floor lamp': 'lamp', 'table lamp': 'lamp', 'desk lamp': 'lamp',
  'side table': 'table', 'coffee table': 'table', 'small table': 'table', 'end table': 'table', 'dining table': 'table',
  'dining chair': 'chair', 'office chair': 'chair',
  'loudspeaker': 'speaker', 'subwoofer': 'speaker',
  'cushion': 'pillow', 'throw pillow': 'pillow',
  'drapes': 'curtain', 'drape': 'curtain', 'curtains': 'curtain',
  'teddy bear': 'stuffed animal', 'plush toy': 'stuffed animal', 'soft toy': 'stuffed animal',
  'fire extinguisher': 'fire extinguisher',
};

const STOP = /^(the|a|an|some|any|my|this|that|those|these)\s+/;

function singular(w: string): string {
  if (w.endsWith('ies') && w.length > 4) return w.slice(0, -3) + 'y';
  if (/(ch|sh|ss|x)es$/.test(w)) return w.slice(0, -2);
  if (w.endsWith('s') && !w.endsWith('ss') && w.length > 3) return w.slice(0, -1);
  return w;
}

/** Canonical form of an object label. */
export function canonical(label: string): string {
  let s = label.toLowerCase().trim().replace(/[^a-z0-9 -]/g, '').replace(/\s+/g, ' ');
  while (STOP.test(s)) s = s.replace(STOP, '');
  if (SYNONYMS[s]) return SYNONYMS[s];
  const words = s.split(' ');
  words[words.length - 1] = singular(words[words.length - 1]);
  s = words.join(' ');
  return SYNONYMS[s] ?? s;
}

/** Broader words that a question may use for more specific labels ("chairs" includes armchairs). */
const KINDS: Record<string, string[]> = {
  chair: ['armchair', 'stool'],
  seat: ['chair', 'armchair', 'sofa', 'stool', 'bench', 'ottoman'],
  seating: ['chair', 'armchair', 'sofa', 'stool', 'bench', 'ottoman'],
  light: ['lamp', 'chandelier', 'pendant light', 'ceiling light'],
  furniture: ['chair', 'armchair', 'sofa', 'table', 'shelf', 'cabinet', 'stool', 'bench', 'ottoman', 'desk', 'bed', 'dresser', 'sideboard'],
  screen: ['tv', 'monitor'],
  decoration: ['vase', 'picture', 'plant', 'sculpture', 'candle', 'figurine'],
};

/** Does an indexed label answer a query term? Exact canonical match, a kind it belongs to, or the query is the head noun. */
export function matches(query: string, label: string): boolean {
  const q = canonical(query);
  const l = canonical(label);
  if (!q) return false;
  if (q === l) return true;
  if (KINDS[q]?.includes(l)) return true;
  const head = l.split(' ').pop()!;
  return head === q || l.endsWith(` ${q}`) || q.endsWith(` ${l}`);
}

/** Plural for answers: "2 chairs", "1 sofa". */
export function plural(label: string, n: number): string {
  if (n === 1) return label;
  if (/(shel|lea|hal)f$/.test(label)) return `${label.slice(0, -1)}ves`;
  if (/(ch|sh|ss|x)$/.test(label)) return `${label}es`;
  if (/[^aeiou]y$/.test(label)) return `${label.slice(0, -1)}ies`;
  if (label.endsWith('s')) return label;
  return `${label}s`;
}
