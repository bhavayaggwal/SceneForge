'use client';

import React, { Suspense, useEffect, useState } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import { motion, AnimatePresence } from 'framer-motion';
import { Film, Crosshair, Box, Eye, Loader2, CheckCircle } from 'lucide-react';
import Card from '@/components/ui/Card';
import ProgressBar from '@/components/ui/ProgressBar';
import Button from '@/components/ui/Button';
import { cn } from '@/lib/utils';

const STAGES = [
  { id: 'extracting', label: 'Extracting Frames', icon: Film, threshold: 25 },
  { id: 'sfm', label: 'Estimating Camera Poses', icon: Crosshair, threshold: 50 },
  { id: 'training', label: 'Training 3D Scene', icon: Box, threshold: 85 },
  { id: 'rendering', label: 'Rendering Preview', icon: Eye, threshold: 100 },
];

function ProcessingContent() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const jobId = searchParams.get('jobId') || 'unknown';
  
  const [progress, setProgress] = useState(0);

  useEffect(() => {
    // MVP: simulate progress over 20 seconds total
    const totalTime = 20000;
    const intervalTime = 100;
    const increment = (100 / (totalTime / intervalTime));

    const timer = setInterval(() => {
      setProgress(p => {
        if (p >= 100) {
          clearInterval(timer);
          return 100;
        }
        return Math.min(100, p + increment);
      });
    }, intervalTime);

    return () => clearInterval(timer);
  }, []);

  const isComplete = progress >= 100;
  
  const getStageStatus = (threshold: number, index: number) => {
    const prevThreshold = index === 0 ? 0 : STAGES[index - 1].threshold;
    if (progress >= threshold) return 'complete';
    if (progress > prevThreshold) return 'active';
    return 'pending';
  };

  const estimatedSeconds = Math.max(0, Math.ceil((20000 - (progress / 100) * 20000) / 1000));

  return (
    <div className="min-h-screen flex items-center justify-center p-4 relative overflow-hidden">
      {/* Decorative background orb */}
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
            {!isComplete && <span>Est. remaining: {estimatedSeconds}s</span>}
          </div>
        </div>

        <div className="flex flex-col gap-4 mb-8">
          {STAGES.map((stage, index) => {
            const status = getStageStatus(stage.threshold, index);
            const Icon = stage.icon;
            
            return (
              <motion.div
                key={stage.id}
                initial={false}
                animate={{
                  scale: status === 'active' ? 1.02 : 1,
                  opacity: status === 'pending' ? 0.5 : 1
                }}
                className={cn(
                  "flex items-center gap-4 p-4 rounded-xl border transition-all duration-300",
                  status === 'active' ? "border-cyber-cyan bg-cyber-cyan/10 neon-glow" : "border-slate-800 bg-slate-900/50"
                )}
              >
                <div className={cn(
                  "p-2 rounded-lg",
                  status === 'complete' ? "text-green-400 bg-green-400/10" :
                  status === 'active' ? "text-cyber-cyan bg-cyber-cyan/20" :
                  "text-slate-500 bg-slate-800"
                )}>
                  {status === 'complete' ? <CheckCircle className="w-6 h-6" /> :
                   status === 'active' ? <Loader2 className="w-6 h-6 animate-spin" /> :
                   <Icon className="w-6 h-6" />}
                </div>
                
                <span className={cn(
                  "font-medium flex-1",
                  status === 'active' ? "text-white" : "text-slate-300"
                )}>
                  {stage.label}
                </span>
              </motion.div>
            );
          })}
        </div>

        <AnimatePresence>
          {isComplete && (
            <motion.div
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              className="flex justify-center"
            >
              <Button 
                variant="primary" 
                size="lg" 
                className="w-full"
                onClick={() => router.push(`/viewer?sceneId=${jobId}`)}
              >
                View Scene
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
