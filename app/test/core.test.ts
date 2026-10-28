import { test } from 'node:test';
import assert from 'node:assert/strict';
import { canonical, matches, plural } from '../shared/labels.ts';
import { mergeSightings } from '../shared/merge.ts';
import type { Sighting } from '../shared/types.ts';
import { parseRules } from '../server/intent.ts';
import { parseBoxes } from '../server/ollama.ts';

test('labels: synonyms, plurals and articles collapse to one canonical label', () => {
  assert.equal(canonical('Couch'), 'sofa');
  assert.equal(canonical('the couches'), 'sofa');
  assert.equal(canonical('television'), 'tv');
  assert.equal(canonical('Shelves'), 'shelf');
  assert.equal(canonical('chairs'), 'chair');
  assert.equal(canonical('glass'), 'glass');
  assert.equal(canonical('dining chair'), 'chair');
  assert.ok(matches('sofa', 'couch'));
  assert.ok(matches('chair', 'dining chair'));
  assert.ok(matches('chairs', 'armchair'));
  assert.ok(!matches('armchair', 'chair'));
  assert.ok(matches('seating', 'sofa'));
  assert.ok(!matches('table', 'tablet'));
  assert.equal(plural('shelf', 2), 'shelves');
  assert.equal(plural('lamp', 2), 'lamps');
  assert.equal(plural('glass', 3), 'glasses');
  assert.equal(plural('chair', 1), 'chair');
});

const s = (label: string, x: number, view: number, w = 1): Sighting => ({ label, position: [x, 0, 0], width: w, height: w, view });

test('merge: the same object seen from several views becomes one object', () => {
  const out = mergeSightings([s('sofa', 0, 0, 2), s('couch', 0.3, 1, 2), s('sofa', 0.1, 2, 2)]);
  assert.equal(out.length, 1);
  assert.deepEqual(out[0].views, [0, 1, 2]);
  assert.equal(out[0].label, 'sofa');
});

test('merge: two same-label boxes in one view stay two objects', () => {
  const out = mergeSightings([s('chair', 0, 0, 0.5), s('chair', 0.2, 0, 0.5)]);
  assert.equal(out.length, 2);
});

test('merge: far-apart objects with one label stay apart; position is the median', () => {
  const out = mergeSightings([s('chair', 0, 0, 0.5), s('chair', 3, 0, 0.5), s('chair', 0.05, 1, 0.5), s('chair', 3.1, 1, 0.5), s('chair', 0.1, 2, 0.5)]);
  assert.equal(out.length, 2);
  const near = out.find((o) => o.position[0] < 1)!;
  assert.equal(near.position[0], 0.05);
});

test('merge: minViews drops single sightings', () => {
  const out = mergeSightings([s('vase', 0, 0), s('vase', 0, 1), s('lamp', 5, 2)], { minViews: 2 });
  assert.deepEqual(out.map((o) => o.label), ['vase']);
});

test('intent rules cover the common phrasings', () => {
  assert.deepEqual(parseRules('Where is the fire extinguisher?'), { intent: 'find', target: 'fire extinguisher', via: 'rules' });
  assert.deepEqual(parseRules('How many chairs are there?'), { intent: 'count', target: 'chairs', via: 'rules' });
  assert.deepEqual(parseRules('How big is the TV?'), { intent: 'measure', target: 'tv', via: 'rules' });
  assert.deepEqual(parseRules('How far is the sofa from the window?'), { intent: 'distance', target: 'sofa', target2: 'window', via: 'rules' });
  const fit = parseRules('Will a 2.1 m sofa fit between the window and the shelf?')!;
  assert.equal(fit.intent, 'fit');
  assert.equal(fit.lengthM, 2.1);
  assert.equal(fit.target, 'window');
  assert.equal(fit.target2, 'shelf');
  assert.equal(parseRules('Will a 210cm sofa fit on that wall?')!.lengthM, 2.1);
  assert.equal(parseRules('Will a 210cm sofa fit on that wall?')!.target, undefined);
  assert.equal(parseRules('List everything in this room')!.intent, 'list');
  assert.equal(parseRules('What colour is the rug?')!.intent, 'describe');
  assert.deepEqual(parseRules('Is there a plant?'), { intent: 'count', target: 'plant', yesNo: true, via: 'rules' });
  assert.equal(parseRules('mumble'), null);
});

test('describe questions find the object they name', async () => {
  // agent.ts opens the database on import; point it at a throwaway file.
  process.env.SF_DB = `${process.env.TEMP ?? '/tmp'}/sf-test-${process.pid}.db`;
  const { mentioned } = await import('../server/agent.ts');
  const o = (id: number, label: string, views: number[]) => ({ id, label, position: [0, 0, 0] as [number, number, number], width: 1, height: 1, views });
  const index = [o(1, 'rug', [1, 2]), o(2, 'armchair', [1, 2, 3]), o(3, 'armchair', [4]), o(4, 'tv', [5])];
  assert.equal(mentioned('What colour is the rug?', index)?.id, 1);
  assert.equal(mentioned('what are the chairs made of', index)?.id, 2);
  assert.equal(mentioned('Is the television on?', index)?.id, 4);
  assert.equal(mentioned('Describe the view outside', index), null);
});

test('box parser tolerates fences, spaces, swapped corners and duplicates', () => {
  const text = '```json\n[{"bbox_2d": [37, 495, 443, 997], "label": "Couch"},{"bbox_2d":[582,662,482,365],"label":"armchair"},{"bbox_2d":[37,495,443,997],"label":"couch"},{"bbox_2d":[1,1,3,3],"label":"dot"}]\n```';
  const boxes = parseBoxes(text);
  assert.deepEqual(boxes, [
    { label: 'couch', box: [37, 495, 443, 997] },
    { label: 'armchair', box: [482, 365, 582, 662] },
  ]);
  // A reply cut off mid-list keeps the complete entries.
  assert.equal(parseBoxes('[{"bbox_2d":[10,10,200,200],"label":"tv"},{"bbox_2d":[5,5').length, 1);
});
