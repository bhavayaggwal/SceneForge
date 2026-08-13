"use client";

import React from 'react';
import { motion } from 'framer-motion';
import { cn } from './Button';

interface ProgressBarProps {
  progress: number;
  label?: string;
  className?: string;
  showPercentage?: boolean;
}

export default function ProgressBar({
  progress,
  label,
  className,
  showPercentage = true,
}: ProgressBarProps) {
  const safeProgress = Math.min(Math.max(progress, 0), 100);

  return (
    <div className={cn("w-full", className)}>
      {(label || showPercentage) && (
        <div className="flex justify-between items-center mb-2">
          {label && <span className="text-sm font-medium text-gray-300">{label}</span>}
          {showPercentage && <span className="text-sm font-medium text-cyber-cyan">{Math.round(safeProgress)}%</span>}
        </div>
      )}
      <div className="h-2 w-full bg-charcoal rounded-full overflow-hidden border border-white/5">
        <motion.div
          initial={{ width: 0 }}
          animate={{ width: `${safeProgress}%` }}
          transition={{ duration: 0.5, ease: "easeOut" }}
          className="h-full bg-gradient-to-r from-cyber-cyan via-neon-purple to-hot-pink animate-shimmer bg-[length:200%_100%]"
        />
      </div>
    </div>
  );
}
