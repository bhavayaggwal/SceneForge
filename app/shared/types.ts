// Types shared by the server, the browser app and the MCP server.
export type Vec3 = [number, number, number];

export interface Scene {
  id: string;
  name: string;
  file: string;
  format: string;
  source: 'upload' | 'video' | 'sample';
  bytes: number;
  splats: number | null;
  flip: boolean;
  /** Real-world metres per scene unit; null until calibrated. */
  metersPerUnit: number | null;
  view: { position: Vec3; target: Vec3 } | null;
  /** Solved capture cameras (video scenes), in the splat file's own frame. */
  cameras: { position: Vec3; direction: Vec3 }[] | null;
  scanViews: number;
  indexedAt: string | null;
  thumb: string | null;
  createdAt: string;
  objectCount: number;
  pinCount: number;
}

export interface SceneObject {
  id: number;
  label: string;
  position: Vec3;
  /** Apparent extent in scene units, estimated from 2D boxes at the hit depth. */
  width: number;
  height: number;
  /** Indices of the scan views that saw this object. */
  views: number[];
}

/** One object seen in one scan view, before merging. */
export interface Sighting {
  label: string;
  position: Vec3;
  width: number;
  height: number;
  view: number;
}

export interface Pin {
  id: number;
  label: string;
  position: Vec3;
  objectId: number | null;
  createdAt: string;
}

export interface TraceStep {
  tool: string;
  detail: string;
  ms: number;
}

export interface Message {
  id: number;
  role: 'user' | 'agent';
  text: string;
  trace: TraceStep[];
  createdAt: string;
}

export interface Job {
  id: string;
  sceneId: string | null;
  name: string;
  status: 'running' | 'done' | 'failed';
  stage: string;
  fraction: number;
  message: string;
  error: string | null;
  createdAt: string;
  finishedAt: string | null;
}

export type Intent = 'find' | 'count' | 'measure' | 'distance' | 'fit' | 'list' | 'describe';

/** Commands the agent sends to the open viewer through the bridge. */
export type ViewerCommand =
  | { type: 'fly_to'; position: Vec3; distance?: number }
  | { type: 'frame'; positions: Vec3[] }
  | { type: 'pins_changed' }
  | { type: 'messages_changed' }
  | { type: 'index_changed' }
  | { type: 'render_view'; maxSide?: number }
  | { type: 'measure_mode'; reason: string }
  | { type: 'scan'; views?: number };
