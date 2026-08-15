'use client';

import React, { Suspense, useState, useEffect } from 'react';
import dynamic from 'next/dynamic';
import { useSearchParams } from 'next/navigation';
import { Download, RotateCcw, Grid3X3, Maximize, Loader2 } from 'lucide-react';
import Modal from '@/components/ui/Modal';
import Button from '@/components/ui/Button';
import { useToast } from '@/components/ui/Toast';
import { cn } from '@/lib/utils';
import { getScene, exportScene } from '@/lib/api';
import { Scene } from '@/types';

const Scene3D = dynamic(() => import('./Scene3DContent'), { ssr: false, loading: () => <div className="flex h-full w-full items-center justify-center"><Loader2 className="w-8 h-8 animate-spin text-cyber-cyan" /></div> });

function ViewerContent() {
  const searchParams = useSearchParams();
  const sceneId = searchParams.get('sceneId');
  const [showGrid, setShowGrid] = useState(true);
  const [isExportModalOpen, setIsExportModalOpen] = useState(false);
  const [exportFormat, setExportFormat] = useState<'gltf' | 'obj'>('gltf');
  const { toast } = useToast();
  
  const [sceneData, setSceneData] = useState<Scene | null>(null);
  const [isLoading, setIsLoading] = useState(!!sceneId);
  const [isExporting, setIsExporting] = useState(false);

  useEffect(() => {
    if (!sceneId) return;
    
    let isMounted = true;
    
    getScene(sceneId).then((data) => {
      if (isMounted) {
        setSceneData(data);
        setIsLoading(false);
      }
    }).catch((err) => {
      console.error(err);
      if (isMounted) {
        toast({ message: err.message || 'Failed to load scene metadata', variant: 'error' });
        setIsLoading(false);
      }
    });
    
    return () => {
      isMounted = false;
    };
  }, [sceneId, toast]);

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

  const handleExport = async () => {
    if (!sceneId) {
      toast({ message: 'No scene to export', variant: 'error' });
      return;
    }
    
    setIsExporting(true);
    try {
      const blob = await exportScene(sceneId, exportFormat);
      
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${sceneData?.name || 'scene'}.${exportFormat}`;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      a.remove();
      
      toast({ message: `Export complete`, variant: 'success' });
      setIsExportModalOpen(false);
    } catch (err: unknown) {
      console.error(err);
      toast({ message: (err as Error).message || 'Export failed', variant: 'error' });
    } finally {
      setIsExporting(false);
    }
  };

  return (
    <div className="relative w-full" style={{ height: 'calc(100vh - 5rem)' }}>
      {sceneId && (
        <div className="absolute top-4 left-4 z-10 glass px-4 py-2 rounded-full border border-slate-700/50 flex items-center gap-2 shadow-lg">
          <div className="w-2 h-2 rounded-full bg-cyber-cyan animate-pulse" />
          <span className="text-sm font-mono text-slate-300">
            {isLoading ? 'Loading scene info...' : (sceneData ? `Scene: ${sceneData.name}` : `Scene: ${sceneId.substring(0, 8)}`)}
          </span>
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

      <Modal isOpen={isExportModalOpen} onClose={() => !isExporting && setIsExportModalOpen(false)} title="Export Scene">
        <div className="flex flex-col gap-4">
          <div 
            onClick={() => !isExporting && setExportFormat('gltf')}
            className={cn(
              "p-4 rounded-xl border cursor-pointer transition-all",
              exportFormat === 'gltf' ? "border-cyber-cyan bg-cyber-cyan/10" : "border-slate-800 bg-slate-900/50 hover:bg-slate-800",
              isExporting && "opacity-50 cursor-not-allowed"
            )}
          >
            <h3 className="font-medium text-white mb-1">GLTF/GLB</h3>
            <p className="text-sm text-slate-400">Web-optimized format, compatible with Three.js and Blender</p>
          </div>
          
          <div 
            onClick={() => !isExporting && setExportFormat('obj')}
            className={cn(
              "p-4 rounded-xl border cursor-pointer transition-all",
              exportFormat === 'obj' ? "border-cyber-cyan bg-cyber-cyan/10" : "border-slate-800 bg-slate-900/50 hover:bg-slate-800",
              isExporting && "opacity-50 cursor-not-allowed"
            )}
          >
            <h3 className="font-medium text-white mb-1">OBJ + MTL</h3>
            <p className="text-sm text-slate-400">Universal 3D format, widely supported</p>
          </div>

          <Button variant="primary" className="w-full mt-4" onClick={handleExport} disabled={isExporting}>
            {isExporting ? <Loader2 className="w-5 h-5 animate-spin mx-auto" /> : 'Export'}
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
