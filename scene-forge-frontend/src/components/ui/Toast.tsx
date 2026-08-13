"use client";

import React, { createContext, useContext, useState, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, CheckCircle, AlertCircle, AlertTriangle, Info } from 'lucide-react';

export type ToastVariant = 'success' | 'error' | 'warning' | 'info';

export interface Toast {
  id: string;
  message: string;
  variant?: ToastVariant;
  duration?: number;
}

interface ToastContextType {
  toast: (options: Omit<Toast, 'id'>) => void;
}

const ToastContext = createContext<ToastContextType | undefined>(undefined);

export function useToast() {
  const context = useContext(ToastContext);
  if (!context) throw new Error('useToast must be used within a ToastProvider');
  return context;
}

const variantStyles = {
  success: { icon: CheckCircle, color: 'text-green-400', border: 'border-green-400/20', bg: 'bg-green-400/10' },
  error: { icon: AlertCircle, color: 'text-red-400', border: 'border-red-400/20', bg: 'bg-red-400/10' },
  warning: { icon: AlertTriangle, color: 'text-amber-400', border: 'border-amber-400/20', bg: 'bg-amber-400/10' },
  info: { icon: Info, color: 'text-cyber-cyan', border: 'border-cyber-cyan/20', bg: 'bg-cyber-cyan/10' },
};

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const toast = useCallback(({ message, variant = 'info', duration = 3000 }: Omit<Toast, 'id'>) => {
    const id = Math.random().toString(36).substring(2, 9);
    setToasts((prev) => [...prev, { id, message, variant, duration }]);

    if (duration !== Infinity) {
      setTimeout(() => {
        setToasts((prev) => prev.filter((t) => t.id !== id));
      }, duration);
    }
  }, []);

  const removeToast = (id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  };

  return (
    <ToastContext.Provider value={{ toast }}>
      {children}
      <div className="fixed top-24 right-4 z-50 flex flex-col gap-2 w-full max-w-xs pointer-events-none">
        <AnimatePresence>
          {toasts.map((t) => {
            const style = variantStyles[t.variant || 'info'];
            const Icon = style.icon;
            
            return (
              <motion.div
                key={t.id}
                initial={{ opacity: 0, x: 50, scale: 0.9 }}
                animate={{ opacity: 1, x: 0, scale: 1 }}
                exit={{ opacity: 0, scale: 0.9, transition: { duration: 0.2 } }}
                className={`pointer-events-auto flex items-start gap-3 p-4 rounded-xl backdrop-blur-xl border ${style.border} ${style.bg} shadow-lg`}
              >
                <Icon className={`mt-0.5 shrink-0 ${style.color}`} size={18} />
                <p className="text-sm font-medium text-white flex-1">{t.message}</p>
                <button
                  onClick={() => removeToast(t.id)}
                  className="text-gray-400 hover:text-white transition-colors shrink-0"
                >
                  <X size={16} />
                </button>
              </motion.div>
            );
          })}
        </AnimatePresence>
      </div>
    </ToastContext.Provider>
  );
}
