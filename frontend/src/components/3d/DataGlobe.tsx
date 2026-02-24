"use client";

import { useRef, useMemo } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";

// Brand colors
const ARC_COLORS = [
  "#00AAFF", // Cyan
  "#7C5CFF", // Purple
  "#FF3366", // Pink
  "#FFAA00", // Orange
  "#00AAFF",
  "#7C5CFF",
  "#FF3366",
  "#FFAA00",
];

// Connection node positions distributed across the globe surface
const NODE_POSITIONS: [number, number, number][] = [
  [1.2, 1.2, 1.0],
  [-0.5, 1.5, 1.2],
  [1.8, 0.2, -0.8],
  [-1.0, -0.8, 1.5],
  [0.3, -1.2, 1.5],
  [-1.5, 0.8, -1.0],
  [0.8, 1.6, -0.6],
  [-1.3, -1.3, -0.8],
];

// Pairs of node indices that are connected by arcs
const ARC_PAIRS: [number, number][] = [
  [0, 1],
  [1, 2],
  [2, 3],
  [0, 4],
  [3, 5],
  [4, 6],
  [5, 7],
  [6, 1],
];

function Globe() {
  const globeRef = useRef<THREE.Group>(null);
  const pointsRef = useRef<THREE.Points>(null);

  // Create wireframe line segments object (memoized to avoid re-creation on render)
  const wireframe = useMemo(() => {
    const sphere = new THREE.SphereGeometry(2, 32, 32);
    const edges = new THREE.EdgesGeometry(sphere);
    sphere.dispose();
    const material = new THREE.LineBasicMaterial({
      color: "#2a4a7f",
      transparent: true,
      opacity: 0.15,
    });
    return new THREE.LineSegments(edges, material);
  }, []);

  // Create arc curves between connected nodes
  const arcs = useMemo(() => {
    const curves: THREE.QuadraticBezierCurve3[] = [];
    ARC_PAIRS.forEach(([a, b]) => {
      const start = new THREE.Vector3(...NODE_POSITIONS[a]);
      const end = new THREE.Vector3(...NODE_POSITIONS[b]);
      // Midpoint raised outward for a nice arc above the globe surface
      const mid = new THREE.Vector3().addVectors(start, end).multiplyScalar(0.5);
      mid.normalize().multiplyScalar(3.2);
      curves.push(new THREE.QuadraticBezierCurve3(start, mid, end));
    });
    return curves;
  }, []);

  // Pre-build arc line objects (using THREE.Line directly for TypeScript compat)
  const arcLines = useMemo(() => {
    return arcs.map((arc, i) => {
      const curvePoints = arc.getPoints(40);
      const geometry = new THREE.BufferGeometry().setFromPoints(curvePoints);
      const material = new THREE.LineBasicMaterial({
        color: ARC_COLORS[i % ARC_COLORS.length],
        transparent: true,
        opacity: 0.3,
      });
      const line = new THREE.Line(geometry, material);
      return line;
    });
  }, [arcs]);

  // Particle position buffer for flowing dots along arcs
  const particlePositions = useMemo(() => {
    return new Float32Array(arcs.length * 3);
  }, [arcs]);

  // Animation loop: rotate globe, move particles
  useFrame((state) => {
    const t = state.clock.elapsedTime;

    // Slow rotation + gentle tilt
    if (globeRef.current) {
      globeRef.current.rotation.y = t * 0.08;
      globeRef.current.rotation.x = Math.sin(t * 0.05) * 0.1;
    }

    // Move each particle along its arc
    if (pointsRef.current) {
      const positions = pointsRef.current.geometry.attributes.position;
      if (positions) {
        arcs.forEach((arc, i) => {
          const param = (t * 0.3 + i * 0.15) % 1;
          const point = arc.getPoint(param);
          positions.setXYZ(i, point.x, point.y, point.z);
        });
        positions.needsUpdate = true;
      }
    }
  });

  return (
    <group ref={globeRef}>
      {/* Wireframe sphere */}
      <primitive object={wireframe} />

      {/* Inner glow sphere */}
      <mesh>
        <sphereGeometry args={[1.95, 32, 32]} />
        <meshBasicMaterial color="#0a1628" transparent opacity={0.6} />
      </mesh>

      {/* Connection arcs (using primitive to avoid JSX <line> SVG conflict) */}
      {arcLines.map((line, i) => (
        <primitive key={i} object={line} />
      ))}

      {/* Node points on the globe surface */}
      {NODE_POSITIONS.map((pos, i) => (
        <mesh key={i} position={pos}>
          <sphereGeometry args={[0.06, 8, 8]} />
          <meshBasicMaterial
            color={ARC_COLORS[i % ARC_COLORS.length]}
            transparent
            opacity={0.8}
          />
        </mesh>
      ))}

      {/* Flowing data particles along arcs */}
      <points ref={pointsRef}>
        <bufferGeometry>
          <bufferAttribute
            attach="attributes-position"
            count={arcs.length}
            array={particlePositions}
            itemSize={3}
          />
        </bufferGeometry>
        <pointsMaterial
          color="#00AAFF"
          size={0.08}
          transparent
          opacity={0.9}
          sizeAttenuation
          blending={THREE.AdditiveBlending}
          depthWrite={false}
        />
      </points>
    </group>
  );
}

export function DataGlobe() {
  return <Globe />;
}
