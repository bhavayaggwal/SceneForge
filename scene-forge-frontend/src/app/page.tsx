// app/page.tsx
"use client";

import { useState } from 'react';

const VideoUploadForm = () => {
  const [file, setFile] = useState<File | null>(null);
  const [message, setMessage] = useState('');
  const [loading, setLoading] = useState(false);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) {
      setFile(e.target.files[0]);
    }
  };

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!file) {
      setMessage('Please select a video file.');
      return;
    }

    setLoading(true);
    setMessage('Uploading and processing video...');

    const formData = new FormData();
    formData.append('video_file', file);

    try {
      const response = await fetch('http://localhost:8000/upload-video/', {
        method: 'POST',
        body: formData,
      });

      const data = await response.json();
      if (response.ok) {
        setMessage('Processing successful! Check the backend terminal for details.');
        console.log(data);
      } else {
        setMessage(`Error: ${data.detail}`);
      }
    } catch (error) {
      setMessage('Network error. Is the backend server running?');
      console.error('Error:', error);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex flex-col items-center justify-center min-h-screen bg-gray-900 text-white p-4">
      <div className="w-full max-w-lg p-8 space-y-6 bg-gray-800 rounded-lg shadow-lg text-center">
        <h1 className="text-3xl font-bold">SceneForge MVP</h1>
        <p className="text-sm text-gray-400">Upload a short video to perform a depth map estimation.</p>
        <form onSubmit={handleSubmit} className="flex flex-col items-center space-y-4">
          <input
            type="file"
            accept="video/mp4,video/quicktime,video/avi"
            onChange={handleFileChange}
            disabled={loading}
            className="w-full text-gray-400 file:mr-4 file:py-2 file:px-4 file:rounded-full file:border-0 file:text-sm file:font-semibold file:bg-violet-50 file:text-violet-700 hover:file:bg-violet-100"
          />
          <button
            type="submit"
            disabled={!file || loading}
            className="w-full px-4 py-2 font-bold text-white bg-blue-600 rounded-md hover:bg-blue-700 disabled:bg-gray-500 disabled:cursor-not-allowed transition-colors"
          >
            {loading ? 'Processing...' : 'Upload Video'}
          </button>
        </form>
        {message && <p className={`mt-4 text-center ${loading ? 'text-blue-400' : 'text-green-400'}`}>{message}</p>}
        <p className="text-xs text-gray-500 mt-6">
          Note: The actual 3D reconstruction is a complex next step. This demo shows that the video is successfully sent and processed by the ML model on the backend.
        </p>
      </div>
    </div>
  );
};

export default VideoUploadForm;