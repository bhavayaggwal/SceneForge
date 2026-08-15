export enum ProcessingStage {
  EXTRACTING = 'EXTRACTING',
  SFM = 'SFM',
  TRAINING = 'TRAINING',
  RENDERING = 'RENDERING',
  COMPLETE = 'COMPLETE',
  FAILED = 'FAILED'
}

export interface Job {
  id: string;
  status: ProcessingStage | string;
  progress: number;
  current_stage: string;
  scene_id?: string;
  created_at: string;
  updated_at?: string;
  error?: string;
}

export interface Scene {
  id: string;
  name: string;
  splat_path: string;
  point_count: number;
  created_at: string;
}

export type ExportFormat = 'gltf' | 'obj';

export interface ProgressUpdate {
  stage: ProcessingStage;
  progress: number;
  estimatedTimeRemaining?: number;
  message: string;
}

export interface ApiError {
  detail: string;
  statusCode?: number;
}

export interface UploadResponse {
  job_id: string;
  message: string;
}
