'use client';

import React, { Suspense, useState } from 'react';
import dynamic from 'next/dynamic';
import { useSearchParams } from 'next/navigation';
import { Download, RotateCcw, Grid3X3, Maximize, Loader2 } from 'lucide-react';
import Modal from '@/components/ui/Modal';
import Button from '@/components/ui/Button';
import { useToast } from '@/components/ui/Toast';
import { cn } from '@/lib/utils';

const Scene3D = dynamic(() => import('./Scene3DContent'), { ssr: false, loading: () => <div className="flex h-full w-full items-center justify-center"><Loader2 className="w-8 h-8 animate-spin text-cyber-cyan" /></div> });

function ViewerContent() {
  const searchParams = useSearchParams();
  const sceneId = searchParams.get('sceneId');
  const [showGrid, setShowGrid] = useState(true);
  const [isExportModalOpen, setIsExportModalOpen] = useState(false);
  const [exportFormat, setExportFormat] = useState<'gltf' | 'obj'>('gltf');
  const { toast } = useToast();

  const handleResetView = () => {
    toast({ message: 'Camera reset', variant: 'info' });
  };

  const handleToggleFullscreen = () => {
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen().catch(() => {});
    } else {
      document.exitFullscreen().catch(() => {});
    }
  };

  const handleExport = () => {
    toast({ message: `Export started for ${exportFormat.toUpperCase()}`, variant: 'success' });
    setIsExportModalOpen(false);
  };

  return (
    <div className="relative w-full" style={{ height: 'calc(100vh - 5rem)' }}>
      {sceneId && (
        <div className="absolute top-4 left-4 z-10 glass px-4 py-2 rounded-full border border-slate-700/50 flex items-center gap-2 shadow-lg">
          <div className="w-2 h-2 rounded-full bg-cyber-cyan animate-pulse" />
          <span className="text-sm font-mono text-slate-300">Scene: {sceneId.substring(0, 8)}</span>
        </div>
      )}

      <Scene3D showGrid={showGrid} />

      <div className="glass rounded-2xl flex flex-row gap-2 p-3 fixed bottom-8 left-1/2 -translate-x-1/2 z-20 border border-slate-700/50 shadow-2xl">
        <button 
          title="Export Scene"
          onClick={() => setIsExportModalOpen(true)}
          className="p-3 rounded-xl hover:bg-slate-800/50 text-slate-300 hover:text-cyber-cyan transition-colors"
        >
          <Download className="w-5 h-5" />
        </button>
        <button 
          title="Reset View"
          onClick={handleResetView}
          className="p-3 rounded-xl hover:bg-slate-800/50 text-slate-300 hover:text-white transition-colors"
        >
          <RotateCcw className="w-5 h-5" />
        </button>
        <button 
          title="Toggle Grid"
          onClick={() => setShowGrid(g => !g)}
          className={cn(
            "p-3 rounded-xl transition-colors",
            showGrid ? "bg-cyber-cyan/20 text-cyber-cyan" : "hover:bg-slate-800/50 text-slate-300 hover:text-white"
          )}
        >
          <Grid3X3 className="w-5 h-5" />
        </button>
        <button 
          title="Fullscreen"
          onClick={handleToggleFullscreen}
          className="p-3 rounded-xl hover:bg-slate-800/50 text-slate-300 hover:text-white transition-colors"
        >
          <Maximize className="w-5 h-5" />
        </button>
      </div>

      <Modal isOpen={isExportModalOpen} onClose={() => setIsExportModalOpen(false)} title="Export Scene">
        <div className="flex flex-col gap-4">
          <div 
            onClick={() => setExportFormat('gltf')}
            className={cn(
              "p-4 rounded-xl border cursor-pointer transition-all",
              exportFormat === 'gltf' ? "border-cyber-cyan bg-cyber-cyan/10" : "border-slate-800 bg-slate-900/50 hover:bg-slate-800"
            )}
          >
            <h3 className="font-medium text-white mb-1">GLTF/GLB</h3>
            <p className="text-sm text-slate-400">Web-optimized format, compatible with Three.js and Blender</p>
          </div>
          
          <div 
            onClick={() => setExportFormat('obj')}
            className={cn(
              "p-4 rounded-xl border cursor-pointer transition-all",
              exportFormat === 'obj' ? "border-cyber-cyan bg-cyber-cyan/10" : "border-slate-800 bg-slate-900/50 hover:bg-slate-800"
            )}
          >
            <h3 className="font-medium text-white mb-1">OBJ + MTL</h3>
            <p className="text-sm text-slate-400">Universal 3D format, widely supported</p>
          </div>

          <Button variant="primary" className="w-full mt-4" onClick={handleExport}>
            Export
          </Button>
        </div>
      </Modal>
    </div>
  );
}

export default function ViewerPage() {
  return (
    <Suspense fallback={
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-cyber-cyan" />
      </div>
    }>
      <ViewerContent />
    </Suspense>
  );
}
