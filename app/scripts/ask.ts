// CLI: node scripts/ask.ts <scene-id> "<question>" ["<question>" ...]
// Asks the running app and prints each answer with the agent's trace.
export {};
const [scene, ...questions] = process.argv.slice(2);
const base = process.env.SF_URL ?? 'http://127.0.0.1:5180';
for (const q of questions) {
  const t0 = performance.now();
  const res = await fetch(`${base}/api/scenes/${scene}/ask`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ question: q }) });
  const lines = (await res.text()).trim().split('\n').map((l) => JSON.parse(l));
  const end = lines.find((l) => l.type === 'answer' || l.type === 'error');
  console.log(`\nQ: ${q}`);
  if (!end || end.type === 'error') {
    console.log(`  ERROR ${end?.error ?? res.status}`);
    continue;
  }
  console.log(`A: ${end.answer.text}`);
  for (const s of end.answer.trace) console.log(`   ${s.tool.padEnd(13)} ${s.detail} (${s.ms} ms)`);
  console.log(`   commands: ${end.answer.commands.map((c: any) => c.type).join(', ') || '-'} · ${Math.round(performance.now() - t0)} ms`);
}
