'use client';

import React from 'react';
import { Canvas } from '@react-three/fiber';
import { OrbitControls, Grid, Float, MeshDistortMaterial, Stars } from '@react-three/drei';

interface Scene3DProps {
  showGrid: boolean;
}

export default function Scene3D({ showGrid }: Scene3DProps) {
  return (
    <Canvas camera={{ position: [5, 3, 5], fov: 50 }}>
      <ambientLight intensity={0.3} />
      <directionalLight position={[5, 5, 5]} intensity={1} />
      
      <Stars count={2000} factor={4} saturation={0} fade speed={1} />
      
      {showGrid && (
        <Grid position={[0, -2, 0]} args={[20, 20]} cellColor="#1a1f36" sectionColor="#1a1f36" fadeDistance={30} />
      )}
      
      <OrbitControls enableDamping autoRotate autoRotateSpeed={0.5} />
      
      <Float speed={1.5} rotationIntensity={1} floatIntensity={1}>
        <mesh>
          <torusKnotGeometry args={[1, 0.3, 128, 32]} />
          <MeshDistortMaterial color="#8b5cf6" metalness={0.8} roughness={0.2} speed={2} distort={0.2} />
        </mesh>
      </Float>

      <Float speed={2} rotationIntensity={2} floatIntensity={2}>
        <mesh position={[3, 1, -2]}>
          <sphereGeometry args={[0.5, 32, 32]} />
          <meshStandardMaterial color="#06b6d4" metalness={0.5} />
        </mesh>
      </Float>

      <Float speed={1.2} rotationIntensity={1.5} floatIntensity={1.5}>
        <mesh position={[-3, -0.5, 2]}>
          <icosahedronGeometry args={[0.6, 0]} />
          <meshStandardMaterial color="#ec4899" metalness={0.4} />
        </mesh>
      </Float>
    </Canvas>
  );
}
