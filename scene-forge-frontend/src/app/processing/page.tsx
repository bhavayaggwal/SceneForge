'use client';

import React, { Suspense, useEffect, useState, useRef } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import { motion, AnimatePresence } from 'framer-motion';
import { Film, Crosshair, Box, Eye, Loader2, CheckCircle, AlertTriangle } from 'lucide-react';
import Card from '@/components/ui/Card';
import ProgressBar from '@/components/ui/ProgressBar';
import Button from '@/components/ui/Button';
import { useToast } from '@/components/ui/Toast';
import { cn } from '@/lib/utils';
import { getJobStatus, createJobWebSocket } from '@/lib/api';
import { ProcessingStage } from '@/types';

const STAGES = [
  { id: ProcessingStage.EXTRACTING, label: 'Extracting Frames', icon: Film },
  { id: ProcessingStage.SFM, label: 'Estimating Camera Poses', icon: Crosshair },
  { id: ProcessingStage.TRAINING, label: 'Training 3D Scene', icon: Box },
  { id: ProcessingStage.RENDERING, label: 'Rendering Preview', icon: Eye },
];

function ProcessingContent() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const { toast } = useToast();
  const jobId = searchParams.get('jobId') || '';
  
  const [progress, setProgress] = useState(0);
  const [stage, setStage] = useState<string>('');
  const [sceneId, setSceneId] = useState<string>('');
  const [status, setStatus] = useState<string>('pending');
  const [errorMsg, setErrorMsg] = useState<string>('');
  
  const pollingRef = useRef<NodeJS.Timeout | null>(null);
  const statusRef = useRef<string>('pending');

  useEffect(() => {
    if (!jobId) return;

    let ws: WebSocket | null = null;
    let isActive = true;
    
    const startPolling = () => {
      if (pollingRef.current) return;
      pollingRef.current = setInterval(async () => {
        try {
          const job = await getJobStatus(jobId);
          if (isActive) handleJobUpdate(job);
          if (job.status === ProcessingStage.COMPLETE || job.status === ProcessingStage.FAILED) {
            if (pollingRef.current) clearInterval(pollingRef.current);
          }
        } catch (err) {
          console.error('Polling error', err);
        }
      }, 2000);
    };

    const handleJobUpdate = (job: import('@/types').Job) => {
      setProgress(job.progress || 0);
      setStage(job.status);
      setStatus(job.status);
      statusRef.current = job.status;
      if (job.scene_id) setSceneId(job.scene_id);
      if (job.error) setErrorMsg(job.error);
      
      if (job.status === ProcessingStage.FAILED) {
        toast({ message: job.error || 'Processing failed', variant: 'error' });
      }
    };

    try {
      ws = createJobWebSocket(
        jobId,
        (data: import('@/types').Job) => {
          if (isActive) handleJobUpdate(data);
        },
        () => {
          if (isActive) startPolling();
        },
        () => {
          if (isActive && statusRef.current !== ProcessingStage.COMPLETE && statusRef.current !== ProcessingStage.FAILED) {
            startPolling();
          }
        }
      );
    } catch (_) {
      startPolling();
    }

    return () => {
      isActive = false;
      if (ws) ws.close();
      if (pollingRef.current) clearInterval(pollingRef.current);
    };
  }, [jobId, toast]);

  const isComplete = status === ProcessingStage.COMPLETE;
  const isFailed = status === ProcessingStage.FAILED;
  
  const getStageStatus = (stageId: string, index: number) => {
    if (isComplete) return 'complete';
    if (isFailed) return 'pending';
    
    const currentIndex = STAGES.findIndex(s => s.id === stage);
    if (index < currentIndex) return 'complete';
    if (index === currentIndex) return 'active';
    return 'pending';
  };

  return (
    <div className="min-h-screen flex items-center justify-center p-4 relative overflow-hidden">
      <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[600px] bg-cyber-cyan/20 rounded-full blur-[120px] pointer-events-none" />
      
      <Card glow className="w-full max-w-xl z-10 relative">
        <div className="text-center mb-8">
          <h1 className="text-3xl font-bold gradient-text mb-2">Processing Your Scene</h1>
          <p className="text-slate-400 font-mono text-sm">Job: {jobId.substring(0, 8)}</p>
        </div>

        <div className="mb-8">
          <ProgressBar progress={progress} />
          <div className="flex justify-between items-center mt-2 text-sm text-slate-400">
            <span>{Math.round(progress)}% Complete</span>
            {isFailed && <span className="text-red-400">Failed</span>}
          </div>
        </div>

        <div className="flex flex-col gap-4 mb-8">
          {STAGES.map((stageItem, index) => {
            const stageStatus = getStageStatus(stageItem.id, index);
            const Icon = stageItem.icon;
            
            return (
              <motion.div
                key={stageItem.id}
                initial={false}
                animate={{
                  scale: stageStatus === 'active' ? 1.02 : 1,
                  opacity: stageStatus === 'pending' ? 0.5 : 1
                }}
                className={cn(
                  "flex items-center gap-4 p-4 rounded-xl border transition-all duration-300",
                  stageStatus === 'active' ? "border-cyber-cyan bg-cyber-cyan/10 neon-glow" : "border-slate-800 bg-slate-900/50"
                )}
              >
                <div className={cn(
                  "p-2 rounded-lg",
                  stageStatus === 'complete' ? "text-green-400 bg-green-400/10" :
                  stageStatus === 'active' ? "text-cyber-cyan bg-cyber-cyan/20" :
                  "text-slate-500 bg-slate-800"
                )}>
                  {stageStatus === 'complete' ? <CheckCircle className="w-6 h-6" /> :
                   stageStatus === 'active' ? <Loader2 className="w-6 h-6 animate-spin" /> :
                   <Icon className="w-6 h-6" />}
                </div>
                
                <span className={cn(
                  "font-medium flex-1",
                  stageStatus === 'active' ? "text-white" : "text-slate-300"
                )}>
                  {stageItem.label}
                </span>
              </motion.div>
            );
          })}
        </div>

        <AnimatePresence>
          {isComplete && sceneId && (
            <motion.div
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              className="flex justify-center"
            >
              <Button 
                variant="primary" 
                size="lg" 
                className="w-full"
                onClick={() => router.push(`/viewer?sceneId=${sceneId}`)}
              >
                View Scene
              </Button>
            </motion.div>
          )}
          
          {isFailed && (
            <motion.div
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              className="flex flex-col items-center gap-4"
            >
              <div className="flex items-center gap-2 text-red-400 bg-red-400/10 p-4 rounded-lg w-full border border-red-500/20">
                <AlertTriangle className="w-5 h-5 flex-shrink-0" />
                <span className="text-sm">{errorMsg || 'An error occurred during processing.'}</span>
              </div>
              <Button 
                variant="secondary" 
                size="lg" 
                className="w-full"
                onClick={() => router.push('/upload')}
              >
                Try Again
              </Button>
            </motion.div>
          )}
        </AnimatePresence>
      </Card>
    </div>
  );
}

export default function ProcessingPage() {
  return (
    <Suspense fallback={
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-cyber-cyan" />
      </div>
    }>
      <ProcessingContent />
    </Suspense>
  );
}
