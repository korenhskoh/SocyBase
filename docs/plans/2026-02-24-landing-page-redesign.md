# Landing Page Premium Redesign — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Redesign the SocyBase landing page with a hybrid Anthropic/OpenAI aesthetic — clean typography with dramatic visual effects including a 3D globe, animated data extraction, and refined gradient waves.

**Architecture:** Replace the current hero with a layered composition: abstract gradient wave background → 3D wireframe globe with connection arcs → data extraction particle animation → bold typography overlay. Redesign features as alternating horizontal showcases with mini animated mockups. Refine How it Works into a horizontal timeline with animated connecting line. Polish pricing and CTA with softer glassmorphism.

**Tech Stack:** Next.js 14, React Three Fiber + Drei (already installed), Framer Motion (already installed), Tailwind CSS

---

### Task 1: Add New Tailwind Animations & CSS Utilities

**Files:**
- Modify: `frontend/tailwind.config.ts` (add new keyframes and animations)
- Modify: `frontend/src/app/globals.css` (add new utility classes)

**Step 1: Update tailwind.config.ts with new animations**

Add these keyframes and animations to the existing `extend` block:

```ts
// Add to keyframes:
meshFloat: {
  "0%, 100%": { transform: "translate(0, 0) scale(1)" },
  "33%": { transform: "translate(30px, -20px) scale(1.05)" },
  "66%": { transform: "translate(-20px, 15px) scale(0.95)" },
},
fadeInUp: {
  from: { opacity: "0", transform: "translateY(30px)" },
  to: { opacity: "1", transform: "translateY(0)" },
},
drawLine: {
  from: { strokeDashoffset: "100%" },
  to: { strokeDashoffset: "0%" },
},
dataFlow: {
  "0%": { transform: "translateX(0) scale(0)", opacity: "0" },
  "10%": { transform: "translateX(10%) scale(1)", opacity: "1" },
  "90%": { transform: "translateX(90%) scale(1)", opacity: "1" },
  "100%": { transform: "translateX(100%) scale(0)", opacity: "0" },
},
cardReveal: {
  from: { opacity: "0", transform: "translateY(10px) scale(0.95)" },
  to: { opacity: "1", transform: "translateY(0) scale(1)" },
},
ticker: {
  from: { transform: "translateY(100%)", opacity: "0" },
  to: { transform: "translateY(0)", opacity: "1" },
},

// Add to animation:
"mesh-float": "meshFloat 20s ease-in-out infinite",
"fade-in-up": "fadeInUp 0.6s ease-out both",
"draw-line": "drawLine 1.5s ease-out both",
"data-flow": "dataFlow 3s ease-in-out infinite",
"card-reveal": "cardReveal 0.5s ease-out both",
"ticker": "ticker 0.4s ease-out both",
```

**Step 2: Add new CSS utility classes to globals.css**

Add inside `@layer components`:

```css
/* Refined glassmorphism — softer version */
.glass-card-soft {
  @apply rounded-2xl border border-white/[0.05] bg-white/[0.02] backdrop-blur-xl;
}

/* Gradient mesh background — hero atmospheric layer */
.gradient-mesh-bg {
  background:
    radial-gradient(ellipse 80% 60% at 20% 30%, rgba(0,170,255,0.08) 0%, transparent 60%),
    radial-gradient(ellipse 60% 80% at 75% 20%, rgba(124,92,255,0.07) 0%, transparent 55%),
    radial-gradient(ellipse 70% 50% at 50% 80%, rgba(255,51,102,0.05) 0%, transparent 50%),
    radial-gradient(ellipse 50% 60% at 85% 70%, rgba(255,170,0,0.04) 0%, transparent 50%);
}

/* Subtle dot grid pattern */
.dot-grid {
  background-image: radial-gradient(circle, rgba(255,255,255,0.03) 1px, transparent 1px);
  background-size: 32px 32px;
}

/* Refined button — less saturated glow */
.btn-glow-refined {
  @apply relative overflow-hidden rounded-xl px-6 py-3 text-white font-semibold transition-all duration-300
         hover:scale-[1.02] hover:shadow-[0_8px_30px_rgba(124,92,255,0.3)];
  background: linear-gradient(135deg, #0090dd 0%, #6a4de0 50%, #dd2a56 100%);
  background-size: 200% 200%;
  animation: gradientX 8s ease infinite;
}

/* Ghost button — refined */
.btn-ghost {
  @apply relative rounded-xl px-6 py-3 font-medium transition-all duration-300
         border border-white/[0.08] text-white/70 hover:text-white hover:border-white/20
         hover:bg-white/[0.03];
}

/* Section accent line */
.accent-line {
  @apply h-[2px] w-12 rounded-full;
}
```

**Step 3: Verify dev server compiles**

Run: `cd frontend && npm run dev`
Expected: No compilation errors

---

### Task 2: Create the 3D Globe Component

**Files:**
- Create: `frontend/src/components/3d/DataGlobe.tsx`

**Step 1: Create the DataGlobe component**

This is a wireframe globe with glowing connection arcs and pulsing node points. Uses existing Three.js + React Three Fiber setup.

```tsx
"use client";

import { useRef, useMemo } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";

function Globe() {
  const globeRef = useRef<THREE.Group>(null);
  const pointsRef = useRef<THREE.Points>(null);

  // Create wireframe sphere geometry
  const wireframeGeo = useMemo(() => {
    const geo = new THREE.SphereGeometry(2, 32, 32);
    return new THREE.EdgesGeometry(geo);
  }, []);

  // Create connection nodes at "social platform locations"
  const nodes = useMemo(() => {
    const positions: [number, number, number][] = [
      // Spread across globe surface
      [1.2, 1.2, 1.0],    // North America
      [-0.5, 1.5, 1.2],   // Europe
      [1.8, 0.2, -0.8],   // Asia
      [-1.0, -0.8, 1.5],  // South America
      [0.3, -1.2, 1.5],   // Africa
      [-1.5, 0.8, -1.0],  // Pacific
      [0.8, 1.6, -0.6],   // Russia
      [-1.3, -1.3, -0.8], // Australia
    ];
    return positions;
  }, []);

  // Create arc curves between nodes
  const arcs = useMemo(() => {
    const curves: THREE.QuadraticBezierCurve3[] = [];
    const pairs = [[0, 1], [1, 2], [2, 3], [0, 4], [3, 5], [4, 6], [5, 7], [6, 1]];
    pairs.forEach(([a, b]) => {
      const start = new THREE.Vector3(...nodes[a]);
      const end = new THREE.Vector3(...nodes[b]);
      const mid = new THREE.Vector3().addVectors(start, end).multiplyScalar(0.5);
      mid.normalize().multiplyScalar(3.2); // Arc outward
      curves.push(new THREE.QuadraticBezierCurve3(start, mid, end));
    });
    return curves;
  }, [nodes]);

  // Particle data flowing along arcs
  const particlePositions = useMemo(() => {
    const positions = new Float32Array(arcs.length * 3);
    return positions;
  }, [arcs]);

  useFrame((state) => {
    if (globeRef.current) {
      globeRef.current.rotation.y = state.clock.elapsedTime * 0.08;
      globeRef.current.rotation.x = Math.sin(state.clock.elapsedTime * 0.05) * 0.1;
    }

    // Animate particles along arcs
    if (pointsRef.current) {
      const positions = pointsRef.current.geometry.attributes.position;
      arcs.forEach((arc, i) => {
        const t = (state.clock.elapsedTime * 0.3 + i * 0.15) % 1;
        const point = arc.getPoint(t);
        positions.setXYZ(i, point.x, point.y, point.z);
      });
      positions.needsUpdate = true;
    }
  });

  return (
    <group ref={globeRef}>
      {/* Wireframe sphere */}
      <lineSegments geometry={wireframeGeo}>
        <lineBasicMaterial color="#2a4a7f" transparent opacity={0.15} />
      </lineSegments>

      {/* Glow sphere (inner) */}
      <mesh>
        <sphereGeometry args={[1.95, 32, 32]} />
        <meshBasicMaterial
          color="#0a1628"
          transparent
          opacity={0.6}
        />
      </mesh>

      {/* Connection arcs */}
      {arcs.map((arc, i) => {
        const points = arc.getPoints(40);
        const geometry = new THREE.BufferGeometry().setFromPoints(points);
        const colors = ["#00AAFF", "#7C5CFF", "#FF3366", "#FFAA00", "#00AAFF", "#7C5CFF", "#FF3366", "#FFAA00"];
        return (
          <line key={i} geometry={geometry}>
            <lineBasicMaterial color={colors[i % colors.length]} transparent opacity={0.3} />
          </line>
        );
      })}

      {/* Node points */}
      {nodes.map((pos, i) => {
        const colors = ["#00AAFF", "#7C5CFF", "#FF3366", "#FFAA00", "#00AAFF", "#7C5CFF", "#FF3366", "#FFAA00"];
        return (
          <mesh key={i} position={pos}>
            <sphereGeometry args={[0.06, 8, 8]} />
            <meshBasicMaterial color={colors[i % colors.length]} transparent opacity={0.8} />
          </mesh>
        );
      })}

      {/* Flowing particles */}
      <points ref={pointsRef}>
        <bufferGeometry>
          <bufferAttribute
            attach="attributes-position"
            count={arcs.length}
            array={particlePositions}
            itemSize={3}
          />
        </bufferGeometry>
        <pointsMaterial color="#00AAFF" size={0.08} transparent opacity={0.9} sizeAttenuation />
      </points>
    </group>
  );
}

export function DataGlobe() {
  return <Globe />;
}
```

**Step 2: Verify the component compiles**

Import it temporarily in page.tsx and check for errors. Remove after verification.

---

### Task 3: Create the Hero Data Extraction Animation

**Files:**
- Create: `frontend/src/components/landing/HeroDataCards.tsx`

**Step 1: Build the animated data cards component**

These are the structured data field cards that appear on the right side of the hero, with staggered fade-in animation using Framer Motion:

```tsx
"use client";

import { motion } from "framer-motion";

const dataFields = [
  { name: "Full Name", value: "John Doe", color: "#00AAFF" },
  { name: "Location", value: "New York, US", color: "#7C5CFF" },
  { name: "Education", value: "MIT '18", color: "#FF3366" },
  { name: "Work", value: "Google Inc.", color: "#FFAA00" },
  { name: "Position", value: "Sr. Engineer", color: "#00AAFF" },
  { name: "Gender", value: "Male", color: "#7C5CFF" },
];

const containerVariants = {
  hidden: {},
  visible: {
    transition: { staggerChildren: 0.15, delayChildren: 0.5 },
  },
};

const cardVariants = {
  hidden: { opacity: 0, x: 20, scale: 0.9 },
  visible: {
    opacity: 1,
    x: 0,
    scale: 1,
    transition: { duration: 0.5, ease: "easeOut" },
  },
};

export function HeroDataCards() {
  return (
    <motion.div
      className="flex flex-col gap-2"
      variants={containerVariants}
      initial="hidden"
      animate="visible"
    >
      {dataFields.map((field) => (
        <motion.div
          key={field.name}
          variants={cardVariants}
          className="flex items-center gap-3 px-4 py-2.5 rounded-xl border border-white/[0.06] bg-white/[0.03] backdrop-blur-sm"
        >
          <div
            className="h-2 w-2 rounded-full shrink-0"
            style={{ background: field.color, boxShadow: `0 0 8px ${field.color}40` }}
          />
          <span className="text-xs text-white/40 w-20 shrink-0">{field.name}</span>
          <span className="text-sm text-white/80 font-medium">{field.value}</span>
        </motion.div>
      ))}
    </motion.div>
  );
}
```

---

### Task 4: Create Feature Section Mini Mockup Animations

**Files:**
- Create: `frontend/src/components/landing/FeatureMockups.tsx`

**Step 1: Build animated mini mockups for each feature**

Four small animated UI mockups using Framer Motion `whileInView`:

```tsx
"use client";

import { motion } from "framer-motion";

/* Profile Extraction — data fields highlighting one by one */
export function MockupProfileExtraction() {
  const fields = [
    { label: "Full Name", w: "70%", color: "#00AAFF" },
    { label: "Education", w: "55%", color: "#7C5CFF" },
    { label: "Work", w: "60%", color: "#FF3366" },
    { label: "Location", w: "50%", color: "#FFAA00" },
    { label: "Gender", w: "30%", color: "#00AAFF" },
  ];

  return (
    <div className="glass-card-soft p-4 w-full max-w-[280px]">
      {/* Profile header */}
      <div className="flex items-center gap-3 mb-4">
        <div className="h-8 w-8 rounded-full bg-gradient-to-br from-[#00AAFF]/30 to-[#7C5CFF]/30" />
        <div>
          <div className="h-2.5 w-20 rounded bg-white/10 mb-1.5" />
          <div className="h-2 w-14 rounded bg-white/5" />
        </div>
      </div>
      {/* Extracting fields */}
      {fields.map((f, i) => (
        <motion.div
          key={f.label}
          className="flex items-center gap-2 py-1.5"
          initial={{ opacity: 0.3 }}
          whileInView={{ opacity: 1 }}
          transition={{ delay: i * 0.2, duration: 0.4 }}
          viewport={{ once: true }}
        >
          <div className="h-1.5 w-1.5 rounded-full" style={{ background: f.color }} />
          <span className="text-[10px] text-white/30 w-16">{f.label}</span>
          <motion.div
            className="h-2 rounded"
            style={{ width: f.w, background: `${f.color}15` }}
            initial={{ scaleX: 0 }}
            whileInView={{ scaleX: 1 }}
            transition={{ delay: i * 0.2 + 0.1, duration: 0.5 }}
            viewport={{ once: true }}
          />
        </motion.div>
      ))}
    </div>
  );
}

/* Comment Scraping — scrolling comment feed */
export function MockupCommentScraping() {
  const comments = [
    { name: "Sarah K.", color: "#00AAFF", w: "80%" },
    { name: "Mike R.", color: "#FF3366", w: "65%" },
    { name: "Lisa P.", color: "#7C5CFF", w: "75%" },
    { name: "Alex T.", color: "#FFAA00", w: "55%" },
  ];

  return (
    <div className="glass-card-soft p-4 w-full max-w-[280px] overflow-hidden">
      <div className="flex items-center gap-2 mb-3">
        <div className="h-2 w-2 rounded-full bg-[#7C5CFF]" />
        <span className="text-[10px] text-white/30 uppercase tracking-wider">Live Feed</span>
      </div>
      {comments.map((c, i) => (
        <motion.div
          key={c.name}
          className="flex items-start gap-2 py-2 border-t border-white/[0.04]"
          initial={{ opacity: 0, y: 10 }}
          whileInView={{ opacity: 1, y: 0 }}
          transition={{ delay: i * 0.15, duration: 0.4 }}
          viewport={{ once: true }}
        >
          <div className="h-5 w-5 rounded-full shrink-0 mt-0.5" style={{ background: `${c.color}20` }} />
          <div className="flex-1">
            <div className="h-2 w-12 rounded bg-white/10 mb-1.5" />
            <div className="h-1.5 rounded bg-white/5" style={{ width: c.w }} />
          </div>
          <motion.div
            className="shrink-0 mt-1"
            initial={{ scale: 0 }}
            whileInView={{ scale: 1 }}
            transition={{ delay: i * 0.15 + 0.3, duration: 0.3 }}
            viewport={{ once: true }}
          >
            <svg className="h-3 w-3 text-[#7C5CFF]/50" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
            </svg>
          </motion.div>
        </motion.div>
      ))}
    </div>
  );
}

/* Bulk Processing — progress bar + counter */
export function MockupBulkProcessing() {
  return (
    <div className="glass-card-soft p-4 w-full max-w-[280px]">
      <div className="flex items-center justify-between mb-3">
        <span className="text-[10px] text-white/30 uppercase tracking-wider">Batch Job</span>
        <span className="text-[10px] text-[#FF3366]/60">Processing</span>
      </div>
      {/* Progress bar */}
      <div className="h-2 rounded-full bg-white/[0.05] mb-3 overflow-hidden">
        <motion.div
          className="h-full rounded-full"
          style={{ background: "linear-gradient(90deg, #FF3366, #FFAA00)" }}
          initial={{ width: "0%" }}
          whileInView={{ width: "73%" }}
          transition={{ duration: 2, ease: "easeOut" }}
          viewport={{ once: true }}
        />
      </div>
      <div className="flex items-center justify-between">
        <motion.span
          className="text-lg font-bold text-white/80"
          initial={{ opacity: 0 }}
          whileInView={{ opacity: 1 }}
          transition={{ delay: 0.5, duration: 0.5 }}
          viewport={{ once: true }}
        >
          7,342
        </motion.span>
        <span className="text-[10px] text-white/30">/ 10,000 profiles</span>
      </div>
      {/* Mini rows */}
      <div className="mt-3 space-y-1.5">
        {[70, 45, 60].map((w, i) => (
          <motion.div
            key={i}
            className="flex items-center gap-2"
            initial={{ opacity: 0 }}
            whileInView={{ opacity: 1 }}
            transition={{ delay: 0.8 + i * 0.1 }}
            viewport={{ once: true }}
          >
            <div className="h-1 w-1 rounded-full bg-[#FF3366]/40" />
            <div className="h-1.5 rounded bg-white/5" style={{ width: `${w}%` }} />
          </motion.div>
        ))}
      </div>
    </div>
  );
}

/* Export Anywhere — file format cards fanning out */
export function MockupExportAnywhere() {
  const formats = [
    { name: "CSV", color: "#00AAFF", delay: 0 },
    { name: "Excel", color: "#7C5CFF", delay: 0.15 },
    { name: "FB Ads", color: "#FF3366", delay: 0.3 },
  ];

  return (
    <div className="glass-card-soft p-4 w-full max-w-[280px]">
      <div className="flex items-center gap-2 mb-4">
        <div className="h-2 w-2 rounded-full bg-[#FFAA00]" />
        <span className="text-[10px] text-white/30 uppercase tracking-wider">Export Ready</span>
      </div>
      <div className="flex gap-2 justify-center">
        {formats.map((f) => (
          <motion.div
            key={f.name}
            className="flex flex-col items-center gap-1.5 p-3 rounded-xl border border-white/[0.06] bg-white/[0.02]"
            initial={{ opacity: 0, y: 15, rotate: -5 }}
            whileInView={{ opacity: 1, y: 0, rotate: 0 }}
            transition={{ delay: f.delay, duration: 0.5, ease: "easeOut" }}
            viewport={{ once: true }}
          >
            <div className="h-8 w-8 rounded-lg flex items-center justify-center" style={{ background: `${f.color}10` }}>
              <svg className="h-4 w-4" style={{ color: f.color }} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m2.25 0H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z" />
              </svg>
            </div>
            <span className="text-[10px] font-medium" style={{ color: `${f.color}99` }}>{f.name}</span>
          </motion.div>
        ))}
      </div>
      {/* Download indicator */}
      <motion.div
        className="mt-3 mx-auto h-1 w-16 rounded-full"
        style={{ background: "linear-gradient(90deg, #00AAFF, #FFAA00)" }}
        initial={{ scaleX: 0 }}
        whileInView={{ scaleX: 1 }}
        transition={{ delay: 0.6, duration: 0.8 }}
        viewport={{ once: true }}
      />
    </div>
  );
}
```

---

### Task 5: Redesign the Full Landing Page (page.tsx)

**Files:**
- Modify: `frontend/src/app/page.tsx` (complete rewrite of the page)

This is the main task. Replace the entire page content with the new premium design. The page structure:

1. **Navbar** — Keep existing but refine styling (softer borders)
2. **Hero** — Gradient mesh BG + 3D Globe (left) + Data Cards (right) + Bold typography
3. **Trusted Platforms** — Keep but refine
4. **Features** — Alternating horizontal showcases with mini mockups
5. **How It Works** — Horizontal timeline with connecting animated line
6. **Data Fields Preview** — Keep structure, refine styling
7. **Pricing** — Polish cards with softer glassmorphism, refined "Popular" glow
8. **Final CTA** — Full-width gradient mesh echo with floating particles
9. **Footer** — Minimal single row

**Step 1: Rewrite page.tsx with the new design**

The full implementation of the redesigned page. Key changes:
- Hero: Remove orbiting icons and hard orbs. Add `gradient-mesh-bg` + `dot-grid` as atmosphere. Split into two columns — left has 3D globe (using `Scene` + `DataGlobe`), right has typography + `HeroDataCards`. Stats moved below hero.
- Features: Replace 2x2 grid with alternating rows. Each row has text on one side and a `FeatureMockup` component on the other. Use `whileInView` for scroll reveal.
- How It Works: Horizontal 3-step timeline with SVG connecting line that draws itself. Step mockups above, text below.
- Pricing: More padding, softer borders, `glass-card-soft` base, refined popular card with radial gradient glow behind it.
- CTA: `gradient-mesh-bg` background echoing the hero, subtle floating dot particles.
- Footer: Single flex row, thinner top border.

See the full code in the implementation — this is the largest single task.

**Step 2: Verify the page renders**

Run: `cd frontend && npm run dev`
Navigate to http://localhost:3000 and verify all sections render.

**Step 3: Verify responsive behavior**

Check at mobile (375px), tablet (768px), and desktop (1280px) widths.

---

### Task 6: Polish & Performance

**Files:**
- Modify: `frontend/src/app/page.tsx` (dynamic imports)

**Step 1: Lazy-load the 3D globe**

Wrap the Scene + DataGlobe in `dynamic(() => import(...), { ssr: false })` to avoid SSR issues and reduce initial bundle size.

**Step 2: Add a fallback for the globe**

Show the `gradient-mesh-bg` background alone as a fallback while the globe loads, so the hero looks complete even before Three.js initializes.

**Step 3: Final visual verification**

Run dev server and do a full scroll-through verifying:
- Hero gradient waves + globe + data cards render
- Features alternate correctly and animate on scroll
- Timeline draws its connecting line
- Pricing cards have refined styling
- CTA echoes the hero atmosphere
- Footer is minimal
- Mobile layout works without 3D globe (hide on mobile for performance)

---

### Task Summary

| Task | Description | Files |
|------|-------------|-------|
| 1 | Tailwind animations + CSS utilities | `tailwind.config.ts`, `globals.css` |
| 2 | 3D DataGlobe component | `components/3d/DataGlobe.tsx` (new) |
| 3 | Hero data extraction cards | `components/landing/HeroDataCards.tsx` (new) |
| 4 | Feature section mini mockups | `components/landing/FeatureMockups.tsx` (new) |
| 5 | Full page.tsx redesign | `app/page.tsx` |
| 6 | Performance polish + lazy loading | `app/page.tsx` |
