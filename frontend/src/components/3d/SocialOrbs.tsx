"use client";

import { useRef } from "react";
import { useFrame } from "@react-three/fiber";
import { Float, MeshDistortMaterial } from "@react-three/drei";
import * as THREE from "three";

interface OrbProps {
  position: [number, number, number];
  color: string;
  speed?: number;
  distort?: number;
  size?: number;
}

function GlowOrb({ position, color, speed = 1, distort = 0.3, size = 0.5 }: OrbProps) {
  const meshRef = useRef<THREE.Mesh>(null);

  useFrame((state) => {
    if (!meshRef.current) return;
    meshRef.current.rotation.x = state.clock.elapsedTime * speed * 0.2;
    meshRef.current.rotation.y = state.clock.elapsedTime * speed * 0.3;
  });

  return (
    <Float speed={speed} rotationIntensity={0.5} floatIntensity={1}>
      <mesh ref={meshRef} position={position}>
        <sphereGeometry args={[size, 32, 32]} />
        <MeshDistortMaterial
          color={color}
          distort={distort}
          speed={2}
          roughness={0.2}
          metalness={0.8}
          emissive={color}
          emissiveIntensity={0.3}
        />
      </mesh>
    </Float>
  );
}

export function SocialOrbs() {
  return (
    <group>
      {/* Facebook - Blue */}
      <GlowOrb position={[-2.5, 1.5, -1]} color="#1877F2" speed={1.2} size={0.6} />
      {/* TikTok - Cyan */}
      <GlowOrb position={[2.5, -1, -2]} color="#00F2EA" speed={0.8} size={0.45} />
      {/* Instagram - Pink */}
      <GlowOrb position={[1.5, 2, 0]} color="#E4405F" speed={1} size={0.35} />
      {/* Central - Purple */}
      <GlowOrb position={[0, 0, -1]} color="#8B5CF6" speed={0.5} distort={0.5} size={1} />
      {/* Accent - Blue */}
      <GlowOrb position={[-1.5, -1.5, -1.5]} color="#3B82F6" speed={1.5} size={0.3} />
      {/* Accent - Pink */}
      <GlowOrb position={[0.5, -2, 0.5]} color="#EC4899" speed={0.7} size={0.25} />
    </group>
  );
}
