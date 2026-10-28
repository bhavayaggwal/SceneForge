// Persistence on Node's built-in SQLite (no native build step).
import { DatabaseSync } from 'node:sqlite';
import { join } from 'node:path';
import { DATA_DIR } from './paths.ts';
import type { Job, Message, Pin, Scene, SceneObject } from '../shared/types.ts';

const db = new DatabaseSync(process.env.SF_DB ?? join(DATA_DIR, 'sceneforge.db'));
db.exec(`
  PRAGMA journal_mode = WAL;
  PRAGMA foreign_keys = ON;
  CREATE TABLE IF NOT EXISTS scenes (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    file TEXT NOT NULL,
    format TEXT NOT NULL,
    source TEXT NOT NULL,            -- 'upload' | 'video' | 'sample'
    bytes INTEGER NOT NULL DEFAULT 0,
    splats INTEGER,
    flip INTEGER NOT NULL DEFAULT 1, -- 3DGS/COLMAP exports are y-down
    meters_per_unit REAL,            -- null until calibrated
    view TEXT,                       -- JSON {position, target} home view
    scan_views INTEGER NOT NULL DEFAULT 0,
    indexed_at TEXT,
    thumb TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE TABLE IF NOT EXISTS objects (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    scene_id TEXT NOT NULL REFERENCES scenes(id) ON DELETE CASCADE,
    label TEXT NOT NULL,
    x REAL NOT NULL, y REAL NOT NULL, z REAL NOT NULL,
    width REAL NOT NULL, height REAL NOT NULL,
    views TEXT NOT NULL              -- JSON array of scan view indices that saw it
  );
  CREATE TABLE IF NOT EXISTS pins (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    scene_id TEXT NOT NULL REFERENCES scenes(id) ON DELETE CASCADE,
    label TEXT NOT NULL,
    x REAL NOT NULL, y REAL NOT NULL, z REAL NOT NULL,
    object_id INTEGER,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE TABLE IF NOT EXISTS messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    scene_id TEXT NOT NULL REFERENCES scenes(id) ON DELETE CASCADE,
    role TEXT NOT NULL,
    text TEXT NOT NULL,
    trace TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE TABLE IF NOT EXISTS jobs (
    id TEXT PRIMARY KEY,
    scene_id TEXT,
    name TEXT NOT NULL,
    status TEXT NOT NULL,            -- 'running' | 'done' | 'failed'
    stage TEXT NOT NULL,
    fraction REAL NOT NULL DEFAULT 0,
    message TEXT NOT NULL DEFAULT '',
    error TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    finished_at TEXT
  );
`);

// Columns added after the first release.
for (const sql of ['ALTER TABLE scenes ADD COLUMN cameras TEXT']) {
  try {
    db.exec(sql);
  } catch {
    // already there
  }
}

type Row = Record<string, any>;

const toScene = (r: Row): Scene => ({
  id: r.id,
  name: r.name,
  file: r.file,
  format: r.format,
  source: r.source,
  bytes: r.bytes,
  splats: r.splats ?? null,
  flip: !!r.flip,
  metersPerUnit: r.meters_per_unit ?? null,
  view: r.view ? JSON.parse(r.view) : null,
  cameras: r.cameras ? JSON.parse(r.cameras) : null,
  scanViews: r.scan_views,
  indexedAt: r.indexed_at ?? null,
  thumb: r.thumb ?? null,
  createdAt: r.created_at,
  objectCount: r.object_count ?? 0,
  pinCount: r.pin_count ?? 0,
});

const toObject = (r: Row): SceneObject => ({
  id: r.id,
  label: r.label,
  position: [r.x, r.y, r.z],
  width: r.width,
  height: r.height,
  views: JSON.parse(r.views),
});

const toPin = (r: Row): Pin => ({ id: r.id, label: r.label, position: [r.x, r.y, r.z], objectId: r.object_id ?? null, createdAt: r.created_at });

const SCENE_SELECT = `SELECT s.*, (SELECT COUNT(*) FROM objects o WHERE o.scene_id = s.id) AS object_count,
  (SELECT COUNT(*) FROM pins p WHERE p.scene_id = s.id) AS pin_count FROM scenes s`;

export const scenes = {
  list: (): Scene[] => db.prepare(`${SCENE_SELECT} ORDER BY s.created_at DESC`).all().map(toScene),
  get: (id: string): Scene | null => {
    const r = db.prepare(`${SCENE_SELECT} WHERE s.id = ?`).get(id);
    return r ? toScene(r) : null;
  },
  insert(s: { id: string; name: string; file: string; format: string; source: string; bytes: number; flip?: boolean; cameras?: unknown[] | null }) {
    db.prepare('INSERT INTO scenes (id, name, file, format, source, bytes, flip, cameras) VALUES (?, ?, ?, ?, ?, ?, ?, ?)').run(
      s.id, s.name, s.file, s.format, s.source, s.bytes, s.flip === false ? 0 : 1, s.cameras ? JSON.stringify(s.cameras) : null,
    );
    return scenes.get(s.id)!;
  },
  update(id: string, patch: Partial<{ name: string; splats: number; flip: boolean; metersPerUnit: number | null; view: unknown; thumb: string }>) {
    const cols: Record<string, string> = { name: 'name', splats: 'splats', flip: 'flip', metersPerUnit: 'meters_per_unit', view: 'view', thumb: 'thumb' };
    for (const [k, v] of Object.entries(patch)) {
      if (!(k in cols) || v === undefined) continue;
      const val = k === 'view' ? JSON.stringify(v) : k === 'flip' ? (v ? 1 : 0) : (v as any);
      db.prepare(`UPDATE scenes SET ${cols[k]} = ? WHERE id = ?`).run(val, id);
    }
    return scenes.get(id);
  },
  remove: (id: string) => db.prepare('DELETE FROM scenes WHERE id = ?').run(id),
};

export const objects = {
  list: (sceneId: string): SceneObject[] => db.prepare('SELECT * FROM objects WHERE scene_id = ? ORDER BY label, id').all(sceneId).map(toObject),
  /** Replaces the scene's index in one transaction. */
  replace(sceneId: string, list: Omit<SceneObject, 'id'>[], scanViews: number) {
    db.exec('BEGIN');
    try {
      db.prepare('DELETE FROM objects WHERE scene_id = ?').run(sceneId);
      const ins = db.prepare('INSERT INTO objects (scene_id, label, x, y, z, width, height, views) VALUES (?, ?, ?, ?, ?, ?, ?, ?)');
      for (const o of list) ins.run(sceneId, o.label, o.position[0], o.position[1], o.position[2], o.width, o.height, JSON.stringify(o.views));
      db.prepare("UPDATE scenes SET scan_views = ?, indexed_at = datetime('now') WHERE id = ?").run(scanViews, sceneId);
      db.exec('COMMIT');
    } catch (e) {
      db.exec('ROLLBACK');
      throw e;
    }
    return objects.list(sceneId);
  },
};

export const pins = {
  list: (sceneId: string): Pin[] => db.prepare('SELECT * FROM pins WHERE scene_id = ? ORDER BY id').all(sceneId).map(toPin),
  add(sceneId: string, label: string, p: [number, number, number], objectId: number | null = null): Pin {
    const r = db.prepare('INSERT INTO pins (scene_id, label, x, y, z, object_id) VALUES (?, ?, ?, ?, ?, ?)').run(sceneId, label, p[0], p[1], p[2], objectId);
    return toPin(db.prepare('SELECT * FROM pins WHERE id = ?').get(r.lastInsertRowid)!);
  },
  remove: (sceneId: string, id: number) => db.prepare('DELETE FROM pins WHERE scene_id = ? AND id = ?').run(sceneId, id),
  clear: (sceneId: string) => db.prepare('DELETE FROM pins WHERE scene_id = ?').run(sceneId),
  /** Pins an answer placed on indexed objects; pins added by hand or over MCP have no object. */
  clearAnswerPins: (sceneId: string) => db.prepare('DELETE FROM pins WHERE scene_id = ? AND object_id IS NOT NULL').run(sceneId),
};

export const messages = {
  list: (sceneId: string): Message[] =>
    db.prepare('SELECT * FROM messages WHERE scene_id = ? ORDER BY id').all(sceneId).map((r: Row) => ({
      id: r.id, role: r.role, text: r.text, trace: r.trace ? JSON.parse(r.trace) : [], createdAt: r.created_at,
    })),
  add(sceneId: string, role: 'user' | 'agent', text: string, trace: unknown[] = []) {
    db.prepare('INSERT INTO messages (scene_id, role, text, trace) VALUES (?, ?, ?, ?)').run(sceneId, role, text, JSON.stringify(trace));
  },
  clear: (sceneId: string) => db.prepare('DELETE FROM messages WHERE scene_id = ?').run(sceneId),
};

const toJob = (r: Row): Job => ({
  id: r.id, sceneId: r.scene_id ?? null, name: r.name, status: r.status, stage: r.stage, fraction: r.fraction,
  message: r.message, error: r.error ?? null, createdAt: r.created_at, finishedAt: r.finished_at ?? null,
});

export const jobs = {
  list: (): Job[] => db.prepare('SELECT * FROM jobs ORDER BY created_at DESC LIMIT 20').all().map(toJob),
  get: (id: string): Job | null => {
    const r = db.prepare('SELECT * FROM jobs WHERE id = ?').get(id);
    return r ? toJob(r) : null;
  },
  insert: (id: string, name: string) => db.prepare("INSERT INTO jobs (id, name, status, stage) VALUES (?, ?, 'running', 'queued')").run(id, name),
  progress: (id: string, stage: string, fraction: number, message: string) =>
    db.prepare('UPDATE jobs SET stage = ?, fraction = ?, message = ? WHERE id = ?').run(stage, fraction, message, id),
  finish: (id: string, sceneId: string) =>
    db.prepare("UPDATE jobs SET status = 'done', scene_id = ?, fraction = 1, finished_at = datetime('now') WHERE id = ?").run(sceneId, id),
  fail: (id: string, error: string) =>
    db.prepare("UPDATE jobs SET status = 'failed', error = ?, finished_at = datetime('now') WHERE id = ?").run(error, id),
  /** Jobs left 'running' by a previous server process can never finish. */
  failOrphans: () => db.prepare("UPDATE jobs SET status = 'failed', error = 'Server restarted during the job', finished_at = datetime('now') WHERE status = 'running'").run(),
};
