"use client";

import React from 'react';
import { motion } from 'framer-motion';
import { cn } from '@/lib/utils';

interface CardProps extends React.HTMLAttributes<HTMLDivElement> {
  glow?: boolean;
  gradientBorder?: boolean;
}

export default function Card({ 
  className, 
  children, 
  glow = false, 
  gradientBorder = false,
  ...props 
}: CardProps) {
  return (
    <motion.div
      whileHover={{ y: -5 }}
      className={cn(
        "glass-card p-6",
        glow && "hover:neon-glow",
        gradientBorder && "neon-border",
        className
      )}
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      {...(props as any)}
    >
      {children}
    </motion.div>
  );
}
