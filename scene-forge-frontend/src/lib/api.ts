import { Job, Scene, UploadResponse, ExportFormat } from '@/types';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000';

export async function uploadVideo(
  file: File,
  onProgress?: (progress: number) => void
): Promise<UploadResponse> {
  return new Promise((resolve, reject) => {
    const formData = new FormData();
    formData.append('video_file', file);
    
    const xhr = new XMLHttpRequest();
    xhr.open('POST', `${API_URL}/api/upload-video`);
    
    if (onProgress) {
      xhr.upload.onprogress = (event) => {
        if (event.lengthComputable) {
          const progress = Math.round((event.loaded * 100) / event.total);
          onProgress(progress);
        }
      };
    }
    
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        try {
          const response = JSON.parse(xhr.responseText);
          resolve(response);
        } catch (_) {
          reject(new Error('Invalid JSON response'));
        }
      } else {
        try {
          const errorResponse = JSON.parse(xhr.responseText);
          reject(new Error(errorResponse.detail || 'Failed to upload video'));
        } catch (_) {
          reject(new Error('Failed to upload video'));
        }
      }
    };
    
    xhr.onerror = () => {
      reject(new Error('Network error during upload'));
    };
    
    xhr.send(formData);
  });
}

async function handleResponse<T>(response: Response): Promise<T> {
  if (!response.ok) {
    let errorMessage = 'API request failed';
    try {
      const errorData = await response.json();
      if (errorData.detail) {
        errorMessage = typeof errorData.detail === 'string' 
          ? errorData.detail 
          : JSON.stringify(errorData.detail);
      }
    } catch (_) {
      // Keep default error message
    }
    throw new Error(errorMessage);
  }
  return response.json();
}

export async function getJobStatus(jobId: string): Promise<Job> {
  const response = await fetch(`${API_URL}/api/job/${jobId}/status`);
  return handleResponse<Job>(response);
}

export async function getScene(sceneId: string): Promise<Scene> {
  const response = await fetch(`${API_URL}/api/scene/${sceneId}`);
  return handleResponse<Scene>(response);
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
    let errorMessage = 'Failed to export scene';
    try {
      const errorData = await response.json();
      if (errorData.detail) {
        errorMessage = typeof errorData.detail === 'string' ? errorData.detail : JSON.stringify(errorData.detail);
      }
    } catch (_) {
      // Keep default error message
    }
    throw new Error(errorMessage);
  }
  
  return response.blob();
}

export function createJobWebSocket(
  jobId: string, 
  onMessage: (data: Job) => void, 
  onError: (err: Event) => void, 
  onClose: () => void
): WebSocket {
  const wsUrl = API_URL.replace(/^http/, 'ws') + `/ws/job/${jobId}`;
  const ws = new WebSocket(wsUrl);
  
  ws.onmessage = (event) => {
    try {
      const data = JSON.parse(event.data);
      onMessage(data);
    } catch (_e) {
      console.error('Failed to parse WebSocket message', _e);
    }
  };
  ws.onerror = onError;
  ws.onclose = onClose;
  
  return ws;
}
