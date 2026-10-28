// SceneForge as an MCP server (stdio): any MCP client can list captured places, query their
// object index, ask spatial questions, and drive the open viewer. Talks to the running app over HTTP.
//
//   claude mcp add sceneforge -- node <repo>/app/server/mcp.ts
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';

const BASE = process.env.SF_URL ?? `http://127.0.0.1:${process.env.SF_PORT ?? 5180}`;

async function api<T = any>(path: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${BASE}${path}`, { ...init, headers: { 'content-type': 'application/json', ...init?.headers } });
  } catch {
    throw new Error(`SceneForge is not running at ${BASE}. Start it with \`npm start\` in app/.`);
  }
  if (!res.ok) throw new Error(((await res.json().catch(() => ({}))) as any).error ?? `HTTP ${res.status}`);
  return (await res.json()) as T;
}

const text = (t: string) => ({ content: [{ type: 'text' as const, text: t }] });
const data = (o: unknown) => text(JSON.stringify(o, null, 2));

const server = new McpServer({ name: 'sceneforge', version: '0.2.0' });

server.registerTool(
  'list_scenes',
  { description: 'List the 3D captures (Gaussian splats) in SceneForge, with whether each is indexed and calibrated.', inputSchema: {} },
  async () => {
    const scenes = await api<any[]>('/api/scenes');
    return data(scenes.map((s) => ({ id: s.id, name: s.name, objects: s.objectCount, indexed: !!s.indexedAt, metersPerUnit: s.metersPerUnit, source: s.source })));
  },
);

server.registerTool(
  'get_objects',
  {
    description: 'The object index of a scene: each object with its label, 3D position, apparent width/height and how many scan views confirmed it. Units are scene units; multiply by metersPerUnit for metres.',
    inputSchema: { scene_id: z.string(), label: z.string().optional().describe('Only objects whose label contains this') },
  },
  async ({ scene_id, label }) => {
    const [scene, objs] = await Promise.all([api(`/api/scenes/${scene_id}`), api<any[]>(`/api/scenes/${scene_id}/objects`)]);
    const list = label ? objs.filter((o) => o.label.includes(label.toLowerCase())) : objs;
    return data({ metersPerUnit: scene.metersPerUnit, scanViews: scene.scanViews, objects: list.map((o) => ({ ...o, seenIn: o.views.length, views: undefined })) });
  },
);

server.registerTool(
  'ask',
  {
    description: 'Ask a spatial question about a place: where is X, how many X, how big is X, how far is X from Y, will a 2 m item fit between X and Y, what is in the room, or anything visual. If the scene is open in the viewer, its camera flies to the answer and pins it.',
    inputSchema: { scene_id: z.string(), question: z.string() },
  },
  async ({ scene_id, question }) => {
    const res = await fetch(`${BASE}/api/scenes/${scene_id}/ask`, { method: 'POST', body: JSON.stringify({ question }) }).catch(() => null);
    if (!res?.ok || !res.body) throw new Error(`SceneForge is not running at ${BASE}.`);
    const lines = (await res.text()).trim().split('\n').map((l) => JSON.parse(l));
    const end = lines.find((l) => l.type === 'answer' || l.type === 'error');
    if (end?.type === 'error') throw new Error(end.error);
    const a = end.answer;
    const trace = a.trace.map((s: any) => `- ${s.tool}: ${s.detail} (${s.ms} ms)`).join('\n');
    return text(`${a.text}\n\nTrace:\n${trace}`);
  },
);

server.registerTool(
  'fly_to',
  {
    description: 'Move the open viewer\'s camera to look at a 3D point (scene units), e.g. an object position from get_objects.',
    inputSchema: { scene_id: z.string(), x: z.number(), y: z.number(), z: z.number(), distance: z.number().optional() },
  },
  async ({ scene_id, x, y, z: zz, distance }) => {
    const r = await api(`/api/scenes/${scene_id}/command`, { method: 'POST', body: JSON.stringify({ type: 'fly_to', position: [x, y, zz], distance }) });
    return text(r.viewers ? 'Camera moved.' : 'No viewer has this scene open; nothing moved.');
  },
);

server.registerTool(
  'add_pin',
  { description: 'Drop a labelled pin at a 3D point in a scene.', inputSchema: { scene_id: z.string(), label: z.string(), x: z.number(), y: z.number(), z: z.number() } },
  async ({ scene_id, label, x, y, z: zz }) => data(await api(`/api/scenes/${scene_id}/pins`, { method: 'POST', body: JSON.stringify({ label, position: [x, y, zz] }) })),
);

server.registerTool(
  'render_view',
  { description: 'Get a JPEG of what the viewer currently shows for a scene (the scene must be open in SceneForge).', inputSchema: { scene_id: z.string() } },
  async ({ scene_id }) => {
    const { image } = await api<{ image: string }>(`/api/scenes/${scene_id}/command`, { method: 'POST', body: JSON.stringify({ type: 'render_view', maxSide: 1024 }) });
    return { content: [{ type: 'image' as const, data: image.replace(/^data:[^,]+,/, ''), mimeType: 'image/jpeg' }] };
  },
);

server.registerTool(
  'index_scene',
  { description: 'Scan the open scene from several viewpoints with the local vision model and rebuild its object index. Takes minutes on modest GPUs.', inputSchema: { scene_id: z.string(), views: z.number().int().min(4).max(48).optional() } },
  async ({ scene_id, views }) => data(await api(`/api/scenes/${scene_id}/command`, { method: 'POST', body: JSON.stringify({ type: 'scan', views }) })),
);

await server.connect(new StdioServerTransport());
