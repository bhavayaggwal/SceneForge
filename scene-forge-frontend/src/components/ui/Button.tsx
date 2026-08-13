"use client";

import React from 'react';
import { motion } from 'framer-motion';
import { Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'ghost';
  size?: 'sm' | 'md' | 'lg';
  isLoading?: boolean;
}

export default function Button({
  className,
  variant = 'primary',
  size = 'md',
  isLoading,
  disabled,
  children,
  ...props
}: ButtonProps) {
  const baseStyles = "relative inline-flex items-center justify-center font-medium rounded-xl transition-all duration-300 overflow-hidden";
  
  const variants = {
    primary: "bg-gradient-to-r from-cyber-cyan via-neon-purple to-hot-pink text-white hover:neon-glow border border-transparent shadow-[0_0_15px_rgba(139,92,246,0.3)] hover:shadow-[0_0_25px_rgba(139,92,246,0.6)]",
    secondary: "glass text-white hover:bg-white/10 hover:border-white/20",
    ghost: "text-gray-300 hover:text-white hover:bg-white/5",
  };
  
  const sizes = {
    sm: "text-sm px-4 py-2",
    md: "text-base px-6 py-3",
    lg: "text-lg px-8 py-4",
  };

  return (
    <motion.button
      whileHover={{ scale: disabled || isLoading ? 1 : 1.02 }}
      whileTap={{ scale: disabled || isLoading ? 1 : 0.98 }}
      className={cn(
        baseStyles,
        variants[variant],
        sizes[size],
        (disabled || isLoading) && "opacity-60 cursor-not-allowed",
        className
      )}
      disabled={disabled || isLoading}
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      {...(props as any)}
    >
      {isLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
      {children}
    </motion.button>
  );
}
