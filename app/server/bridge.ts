// Server-sent events to every open viewer, plus request/response for commands that need
// an answer from the browser (a rendered view). This is how the MCP server drives the viewer.
import type { ServerResponse } from 'node:http';
import { randomUUID } from 'node:crypto';
import type { ViewerCommand } from '../shared/types.ts';

interface Client {
  res: ServerResponse;
  sceneId: string | null;
}

const clients = new Set<Client>();
const pending = new Map<string, { resolve: (v: unknown) => void; timer: NodeJS.Timeout }>();

export function attach(res: ServerResponse, sceneId: string | null) {
  res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', connection: 'keep-alive' });
  res.write(': connected\n\n');
  const c: Client = { res, sceneId };
  clients.add(c);
  const ping = setInterval(() => res.write(': ping\n\n'), 20000);
  res.on('close', () => {
    clearInterval(ping);
    clients.delete(c);
  });
  return c;
}

export function setScene(res: ServerResponse, sceneId: string) {
  for (const c of clients) if (c.res === res) c.sceneId = sceneId;
}

/** Broadcast an app event (jobs, scene list changes) to every viewer. */
export function broadcast(event: string, data: unknown) {
  const msg = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const c of clients) c.res.write(msg);
}

export function viewersFor(sceneId: string): number {
  let n = 0;
  for (const c of clients) if (c.sceneId === sceneId) n++;
  return n;
}

/** Send a command to the viewers showing `sceneId`. */
export function command(sceneId: string, cmd: ViewerCommand) {
  const msg = `event: command\ndata: ${JSON.stringify({ sceneId, cmd })}\n\n`;
  for (const c of clients) if (c.sceneId === sceneId) c.res.write(msg);
}

/** Send a command and wait for the first viewer to answer it (or time out with null). */
export function request<T>(sceneId: string, cmd: ViewerCommand, timeoutMs = 15000): Promise<T | null> {
  if (!viewersFor(sceneId)) return Promise.resolve(null);
  const id = randomUUID();
  const msg = `event: request\ndata: ${JSON.stringify({ id, sceneId, cmd })}\n\n`;
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      pending.delete(id);
      resolve(null);
    }, timeoutMs);
    pending.set(id, { resolve: resolve as (v: unknown) => void, timer });
    for (const c of clients) if (c.sceneId === sceneId) c.res.write(msg);
  });
}

export function reply(id: string, value: unknown): boolean {
  const p = pending.get(id);
  if (!p) return false;
  clearTimeout(p.timer);
  pending.delete(id);
  p.resolve(value);
  return true;
}
