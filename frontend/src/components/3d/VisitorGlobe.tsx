"use client";

import { Suspense, useRef, useMemo } from "react";
import { Canvas, useFrame, useLoader } from "@react-three/fiber";
import { OrbitControls } from "@react-three/drei";
import * as THREE from "three";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface VisitorGeo {
  lat?: number;
  lon?: number;
  city?: string;
  country?: string;
  country_code?: string;
}

interface VisitorPin {
  vid: string;
  geo: VisitorGeo;
  ts: number;
  path?: string;
}

export interface VisitorGlobeProps {
  visitors: VisitorPin[];
  className?: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const RADIUS = 2;

/** Convert geographic lat/lon to a 3D position on a sphere. */
function latLonToVec3(lat: number, lon: number, r: number): THREE.Vector3 {
  const phi = (90 - lat) * (Math.PI / 180);
  const theta = (lon + 180) * (Math.PI / 180);
  return new THREE.Vector3(
    -(r * Math.sin(phi) * Math.cos(theta)),
    r * Math.cos(phi),
    r * Math.sin(phi) * Math.sin(theta),
  );
}

function hasCoords(v: VisitorPin): boolean {
  return (
    typeof v.geo.lat === "number" &&
    typeof v.geo.lon === "number" &&
    (v.geo.lat !== 0 || v.geo.lon !== 0)
  );
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

/** Dark night-Earth textured sphere. */
function EarthSphere() {
  const texture = useLoader(THREE.TextureLoader, "/images/earth-night.jpg");

  return (
    <mesh>
      <sphereGeometry args={[RADIUS, 64, 64]} />
      <meshStandardMaterial
        map={texture}
        emissiveMap={texture}
        emissive={new THREE.Color(0xffffff)}
        emissiveIntensity={0.8}
        roughness={0.9}
        metalness={0.1}
      />
    </mesh>
  );
}

/** Subtle blue atmospheric glow halo. */
function AtmosphereGlow() {
  return (
    <mesh>
      <sphereGeometry args={[RADIUS * 1.03, 64, 64]} />
      <meshBasicMaterial
        color="#4488ff"
        transparent
        opacity={0.07}
        side={THREE.BackSide}
      />
    </mesh>
  );
}

/** Pulsing glowing dots at each visitor location (instanced for perf). */
function VisitorPins({ visitors }: { visitors: VisitorPin[] }) {
  const meshRef = useRef<THREE.InstancedMesh>(null);
  const dummy = useMemo(() => new THREE.Object3D(), []);

  const valid = useMemo(() => visitors.filter(hasCoords), [visitors]);

  useFrame((state) => {
    if (!meshRef.current) return;
    const t = state.clock.elapsedTime;

    valid.forEach((v, i) => {
      const pos = latLonToVec3(v.geo.lat!, v.geo.lon!, RADIUS + 0.02);
      dummy.position.copy(pos);
      dummy.lookAt(0, 0, 0);
      const pulse = 1 + Math.sin(t * 3 + i * 0.7) * 0.35;
      dummy.scale.setScalar(pulse);
      dummy.updateMatrix();
      meshRef.current!.setMatrixAt(i, dummy.matrix);
    });

    meshRef.current.count = valid.length;
    meshRef.current.instanceMatrix.needsUpdate = true;
  });

  return (
    <instancedMesh ref={meshRef} args={[undefined, undefined, 200]}>
      <sphereGeometry args={[0.035, 8, 8]} />
      <meshBasicMaterial
        color="#00AAFF"
        transparent
        opacity={0.95}
        blending={THREE.AdditiveBlending}
        depthWrite={false}
      />
    </instancedMesh>
  );
}

/** Expanding ring ripple per visitor pin. */
function PinGlowRings({ visitors }: { visitors: VisitorPin[] }) {
  const meshRef = useRef<THREE.InstancedMesh>(null);
  const dummy = useMemo(() => new THREE.Object3D(), []);

  const valid = useMemo(() => visitors.filter(hasCoords), [visitors]);

  useFrame((state) => {
    if (!meshRef.current) return;
    const t = state.clock.elapsedTime;

    valid.forEach((v, i) => {
      const pos = latLonToVec3(v.geo.lat!, v.geo.lon!, RADIUS + 0.015);
      dummy.position.copy(pos);
      dummy.lookAt(0, 0, 0);
      const cycle = ((t * 0.6 + i * 0.4) % 2.5) / 2.5;
      dummy.scale.setScalar(0.6 + cycle * 2.5);
      dummy.updateMatrix();
      meshRef.current!.setMatrixAt(i, dummy.matrix);
    });

    meshRef.current.count = valid.length;
    meshRef.current.instanceMatrix.needsUpdate = true;
  });

  return (
    <instancedMesh ref={meshRef} args={[undefined, undefined, 200]}>
      <ringGeometry args={[0.025, 0.045, 16]} />
      <meshBasicMaterial
        color="#00AAFF"
        transparent
        opacity={0.2}
        side={THREE.DoubleSide}
        blending={THREE.AdditiveBlending}
        depthWrite={false}
      />
    </instancedMesh>
  );
}

/** Curved arcs from a center origin to each visitor location. */
function VisitorArcs({ visitors }: { visitors: VisitorPin[] }) {
  const valid = useMemo(() => visitors.filter(hasCoords), [visitors]);

  // Use Kuala Lumpur, Malaysia as "home base" (SocyBase origin)
  const centerPos = useMemo(() => latLonToVec3(3.14, 101.69, RADIUS), []);

  const arcLines = useMemo(() => {
    return valid.map((v) => {
      const end = latLonToVec3(v.geo.lat!, v.geo.lon!, RADIUS);
      const mid = new THREE.Vector3().addVectors(centerPos, end).multiplyScalar(0.5);
      const dist = centerPos.distanceTo(end);
      mid.normalize().multiplyScalar(RADIUS + dist * 0.35);
      const curve = new THREE.QuadraticBezierCurve3(centerPos, mid, end);
      const points = curve.getPoints(40);
      const geometry = new THREE.BufferGeometry().setFromPoints(points);
      const material = new THREE.LineBasicMaterial({
        color: "#7C5CFF",
        transparent: true,
        opacity: 0.2,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      });
      return new THREE.Line(geometry, material);
    });
  }, [valid, centerPos]);

  return (
    <group>
      {arcLines.map((line, i) => (
        <primitive key={i} object={line} />
      ))}
    </group>
  );
}

// ---------------------------------------------------------------------------
// Main scene
// ---------------------------------------------------------------------------

function GlobeScene({ visitors }: { visitors: VisitorPin[] }) {
  return (
    <>
      <ambientLight intensity={0.15} />

      <OrbitControls
        enablePan={false}
        enableZoom={true}
        autoRotate={true}
        autoRotateSpeed={0.5}
        minDistance={3}
        maxDistance={8}
        enableDamping
        dampingFactor={0.05}
      />

      <EarthSphere />
      <AtmosphereGlow />

      <VisitorPins visitors={visitors} />
      <PinGlowRings visitors={visitors} />
      <VisitorArcs visitors={visitors} />
    </>
  );
}

export function VisitorGlobe({ visitors, className }: VisitorGlobeProps) {
  return (
    <div className={className}>
      <Canvas
        camera={{ position: [0, 0, 5], fov: 45 }}
        dpr={[1, 1.5]}
        gl={{ antialias: true, alpha: true }}
        style={{ background: "transparent" }}
      >
        <Suspense fallback={null}>
          <GlobeScene visitors={visitors} />
        </Suspense>
      </Canvas>
    </div>
  );
}
