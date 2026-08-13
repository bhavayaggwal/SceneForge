"use client";

import React from 'react';
import Link from 'next/link';
import { motion } from 'framer-motion';
import { Camera, Wand2, Download } from 'lucide-react';
import Button from '@/components/ui/Button';
import Card from '@/components/ui/Card';

export default function Home() {
  return (
    <div className="relative min-h-[calc(100vh-5rem)] flex flex-col items-center justify-center overflow-hidden">
      {/* Decorative Orbs */}
      <div className="absolute top-1/4 left-1/4 w-96 h-96 bg-neon-purple/20 rounded-full blur-[128px] animate-float pointer-events-none" />
      <div className="absolute bottom-1/4 right-1/4 w-[30rem] h-[30rem] bg-cyber-cyan/10 rounded-full blur-[128px] animate-float pointer-events-none" style={{ animationDelay: '2s' }} />

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 relative z-10 py-20 text-center">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.8 }}
        >
          <h1 className="text-6xl md:text-8xl font-black tracking-tighter mb-6 gradient-text py-2">
            SceneForge
          </h1>
          <p className="text-xl md:text-2xl text-gray-400 mb-10 max-w-3xl mx-auto">
            Turn phone videos into photorealistic 3D scenes using advanced neural rendering.
          </p>
          
          <div className="flex justify-center gap-6">
            <Link href="/upload">
              <Button size="lg" className="px-8 shadow-xl">
                Start Creating
              </Button>
            </Link>
            <Link href="/viewer">
              <Button variant="secondary" size="lg" className="px-8">
                View Demo
              </Button>
            </Link>
          </div>
        </motion.div>

        <motion.div 
          initial={{ opacity: 0, y: 40 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.8, delay: 0.3 }}
          className="mt-32 grid grid-cols-1 md:grid-cols-3 gap-8 text-left"
        >
          <Card glow gradientBorder>
            <div className="h-12 w-12 rounded-xl bg-gradient-to-br from-cyber-cyan to-neon-purple flex items-center justify-center mb-6">
              <Camera className="text-white" size={24} />
            </div>
            <h3 className="text-xl font-bold text-white mb-3">3D Reconstruction</h3>
            <p className="text-gray-400 leading-relaxed">
              Upload a simple video and watch our AI extract frames, estimate poses, and build a highly detailed 3D environment.
            </p>
          </Card>

          <Card glow gradientBorder>
            <div className="h-12 w-12 rounded-xl bg-gradient-to-br from-neon-purple to-hot-pink flex items-center justify-center mb-6">
              <Wand2 className="text-white" size={24} />
            </div>
            <h3 className="text-xl font-bold text-white mb-3">Smart Editing</h3>
            <p className="text-gray-400 leading-relaxed">
              Clean up artifacts, crop your scene, and manipulate your 3D assets right in the browser with real-time feedback.
            </p>
          </Card>

          <Card glow gradientBorder>
            <div className="h-12 w-12 rounded-xl bg-gradient-to-br from-hot-pink to-cyber-cyan flex items-center justify-center mb-6">
              <Download className="text-white" size={24} />
            </div>
            <h3 className="text-xl font-bold text-white mb-3">Export Anywhere</h3>
            <p className="text-gray-400 leading-relaxed">
              Download your optimized scenes in standard formats like GLTF or OBJ, ready to be dropped into any engine.
            </p>
          </Card>
        </motion.div>
      </div>

      <footer className="w-full text-center py-8 text-gray-500 text-sm mt-auto z-10">
        &copy; {new Date().getFullYear()} SceneForge. All rights reserved.
      </footer>
    </div>
  );
}