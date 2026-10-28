import { test } from 'node:test';
import assert from 'node:assert/strict';
import { holdAwake, isHoldingAwake } from '../server/keepawake.ts';

test('keep-awake request is accepted by Windows', { skip: process.platform !== 'win32' }, async () => {
  holdAwake(4000);
  const t0 = Date.now();
  while (!isHoldingAwake() && Date.now() - t0 < 15000) await new Promise((r) => setTimeout(r, 200));
  assert.ok(isHoldingAwake(), 'SetThreadExecutionState helper did not report success');
  // The helper exits once the hold expires.
  await new Promise((r) => setTimeout(r, 10000));
  assert.ok(!isHoldingAwake());
});
