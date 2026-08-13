export enum ProcessingStage {
  EXTRACTING = 'EXTRACTING',
  SFM = 'SFM',
  TRAINING = 'TRAINING',
  RENDERING = 'RENDERING',
  COMPLETE = 'COMPLETE'
}

export interface Job {
  id: string;
  status: 'pending' | 'processing' | 'completed' | 'failed';
  progress: number;
  currentStage: ProcessingStage;
  sceneId?: string;
  createdAt: string;
}

export interface Scene {
  id: string;
  name: string;
  splatUrl: string;
  thumbnailUrl?: string;
  createdAt: string;
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
  jobId: string;
  message: string;
}
