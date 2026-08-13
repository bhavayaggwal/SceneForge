import { Job, Scene, UploadResponse, ExportFormat } from '@/types';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000';

export async function uploadVideo(file: File): Promise<UploadResponse> {
  const formData = new FormData();
  formData.append('file', file);
  
  const response = await fetch(`${API_URL}/api/upload-video`, {
    method: 'POST',
    body: formData,
  });
  
  if (!response.ok) {
    throw new Error('Failed to upload video');
  }
  
  return response.json();
}

export async function getJobStatus(jobId: string): Promise<Job> {
  const response = await fetch(`${API_URL}/api/job/${jobId}/status`);
  
  if (!response.ok) {
    throw new Error('Failed to fetch job status');
  }
  
  return response.json();
}

export async function getScene(sceneId: string): Promise<Scene> {
  const response = await fetch(`${API_URL}/api/scene/${sceneId}`);
  
  if (!response.ok) {
    throw new Error('Failed to fetch scene');
  }
  
  return response.json();
}

export async function exportScene(sceneId: string, format: ExportFormat): Promise<Blob> {
  const response = await fetch(`${API_URL}/api/scene/${sceneId}/export`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ format }),
  });
  
  if (!response.ok) {
    throw new Error('Failed to export scene');
  }
  
  return response.blob();
}
