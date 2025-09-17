"use client";

import { useState, FormEvent, ChangeEvent } from 'react';

const VideoUploadForm = () => {
  const [file, setFile] = useState<File | null>(null);
  const [message, setMessage] = useState<string>('');
  const [error, setError] = useState<string>('');
  const [loading, setLoading] = useState<boolean>(false);

  const handleFileChange = (e: ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) {
      setFile(e.target.files[0]);
      setMessage(''); // Clear message when new file is selected
      setError(''); // Clear error when new file is selected
    }
  };

  const handleSubmit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!file) {
      setError('Please select a video file.');
      return;
    }

    setLoading(true);
    setMessage('Uploading and processing video...');
    setError('');

    const formData = new FormData();
    formData.append('video_file', file);

    const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000';

    try {
      const response = await fetch(`${apiUrl}/upload-video/`, {
        method: 'POST',
        body: formData,
      });

      const data = await response.json();
      if (response.ok) {
        setMessage('Processing successful! Check the backend terminal for details.');
        console.log(data);
      } else {
        setError(`Error: ${data.detail || 'Something went wrong'}`);
        setMessage('');
      }
    } catch (err) {
      setError('Network error. Is the backend server running?');
      setMessage('');
      console.error('Error:', err);
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
        {message && <p className="mt-4 text-center text-blue-400">{message}</p>}
        {error && <p className="mt-4 text-center text-red-500">{error}</p>}
        <p className="text-xs text-gray-500 mt-6">
          Note: The actual 3D reconstruction is a complex next step. This demo shows that the video is successfully sent and processed by the ML model on the backend.
        </p>
      </div>
    </div>
  );
};

export default VideoUploadForm;
