// Connects to the SceneForge MCP server over stdio, the way an agent would, and exercises its tools.
// Usage: node scripts/mcp-smoke.ts [question]   (the app must be running)
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const question = process.argv[2] ?? 'How many chairs are there?';
const client = new Client({ name: 'sceneforge-smoke', version: '1.0.0' });
await client.connect(new StdioClientTransport({ command: process.execPath, args: [new URL('../server/mcp.ts', import.meta.url).pathname.replace(/^\/([A-Z]:)/, '$1')] }));

const text = (r: any) => r.content.map((c: any) => (c.type === 'text' ? c.text : `[${c.type} ${c.mimeType ?? ''} ${c.data?.length ?? 0} chars]`)).join('\n');

const tools = await client.listTools();
console.log('tools:', tools.tools.map((t) => t.name).join(', '));

const scenes = JSON.parse(text(await client.callTool({ name: 'list_scenes', arguments: {} })));
console.log('scenes:', scenes.map((s: any) => `${s.id} (${s.objects} objects)`).join(', '));
const scene = scenes.find((s: any) => s.indexed) ?? scenes[0];
if (!scene) throw new Error('No scenes');

const objs = JSON.parse(text(await client.callTool({ name: 'get_objects', arguments: { scene_id: scene.id } })));
console.log(`get_objects: ${objs.objects.length} objects, scale ${objs.metersPerUnit ?? 'not set'}`);

const t0 = performance.now();
console.log(`ask "${question}":\n${text(await client.callTool({ name: 'ask', arguments: { scene_id: scene.id, question } }))}`);
console.log(`(${Math.round(performance.now() - t0)} ms)`);

const view = await client.callTool({ name: 'render_view', arguments: { scene_id: scene.id } });
console.log('render_view:', view.isError ? text(view) : text(view));

await client.close();
