"use client";

import React, { useState, useRef, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { motion } from 'framer-motion';
import { Upload as UploadIcon, FileVideo, X } from 'lucide-react';
import Card from '@/components/ui/Card';
import Button from '@/components/ui/Button';
import ProgressBar from '@/components/ui/ProgressBar';
import { useToast } from '@/components/ui/Toast';
import { uploadVideo } from '@/lib/api';

export default function UploadPage() {
  const router = useRouter();
  const { toast } = useToast();
  const [file, setFile] = useState<File | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
  };

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    
    const droppedFile = e.dataTransfer.files[0];
    if (droppedFile && droppedFile.type.startsWith('video/')) {
      setFile(droppedFile);
    } else {
      toast({ message: 'Please upload a valid video file', variant: 'error' });
    }
  }, [toast]);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFile = e.target.files?.[0];
    if (selectedFile) setFile(selectedFile);
  };

  const handleUpload = async () => {
    if (!file) return;
    
    setIsUploading(true);
    setUploadProgress(0);

    try {
      const response = await uploadVideo(file, (progress) => {
        setUploadProgress(progress);
      });
      
      router.push(`/processing?jobId=${response.job_id}`);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Upload failed. Please try again.';
      toast({ message, variant: 'error' });
      setIsUploading(false);
    }
  };

  return (
    <div className="flex-1 flex flex-col items-center justify-center p-6 relative overflow-hidden">
      <div className="absolute top-1/4 left-1/3 w-72 h-72 bg-cyber-cyan/10 rounded-full blur-[100px] animate-float pointer-events-none" />
      
      <motion.div 
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        className="w-full max-w-2xl z-10"
      >
        <div className="text-center mb-10">
          <h1 className="text-4xl font-bold text-white mb-4">Upload Video</h1>
          <p className="text-gray-400">Select a clear, well-lit video moving slowly around your subject.</p>
        </div>

        <Card 
          gradientBorder={isDragging} 
          glow={isDragging}
          className={`
            border-2 border-dashed transition-all duration-300
            ${isDragging ? 'border-cyber-cyan bg-cyber-cyan/5' : 'border-white/20 hover:border-white/40'}
          `}
        >
          {!file ? (
            <div 
              className="flex flex-col items-center justify-center py-20 px-4 text-center cursor-pointer"
              onDragOver={handleDragOver}
              onDragLeave={handleDragLeave}
              onDrop={handleDrop}
              onClick={() => fileInputRef.current?.click()}
            >
              <div className="h-20 w-20 rounded-full glass flex items-center justify-center mb-6 text-cyber-cyan">
                <UploadIcon size={32} />
              </div>
              <h3 className="text-xl font-semibold text-white mb-2">Drag & Drop your video</h3>
              <p className="text-gray-400 mb-6">or click to browse from your device</p>
              <div className="text-xs text-gray-500 font-medium px-4 py-2 rounded-full bg-white/5">
                MP4, MOV, WebM • Up to 500MB
              </div>
            </div>
          ) : (
            <div className="py-12 px-6 flex flex-col items-center">
              <div className="relative mb-6">
                <div className="h-24 w-24 rounded-2xl bg-gradient-to-br from-cyber-cyan to-neon-purple flex items-center justify-center shadow-lg neon-glow">
                  <FileVideo size={40} className="text-white" />
                </div>
                {!isUploading && (
                  <button 
                    onClick={(e) => { e.stopPropagation(); setFile(null); }}
                    className="absolute -top-3 -right-3 h-8 w-8 rounded-full bg-red-500/20 text-red-400 border border-red-500/50 flex items-center justify-center hover:bg-red-500 hover:text-white transition-colors"
                  >
                    <X size={16} />
                  </button>
                )}
              </div>
              
              <h3 className="text-lg font-semibold text-white mb-1">{file.name}</h3>
              <p className="text-gray-400 text-sm mb-10">{(file.size / (1024 * 1024)).toFixed(2)} MB</p>

              {isUploading ? (
                <div className="w-full max-w-md">
                  <ProgressBar progress={uploadProgress} label="Uploading and preparing..." />
                </div>
              ) : (
                <Button size="lg" className="w-full max-w-md" onClick={handleUpload}>
                  Process Video
                </Button>
              )}
            </div>
          )}
          
          <input 
            type="file" 
            ref={fileInputRef} 
            className="hidden" 
            accept="video/*"
            onChange={handleFileChange}
          />
        </Card>
      </motion.div>
    </div>
  );
}
