'use client';

import { useRef, useMemo, useCallback, memo } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import { OrbitControls, Html, Environment } from '@react-three/drei';
import * as THREE from 'three';

/* ─── Types ─── */
interface DamagePin {
  id: string;
  position: [number, number, number];
  label: string;
  severity: string;
  confidence: number;
  bladeId: number;
  zone: string;
}

const SEV_COL: Record<string, string> = {
  S0: '#059669', S1: '#65A30D', S2: '#D97706', S3: '#DC2626', S4: '#7C3AED',
};

/* ════════════════════════════════════════════════════════════════
   PROCEDURAL TEXTURE GENERATORS — Engineering-accurate materials
   ════════════════════════════════════════════════════════════════ */
const R = (s: number) => { s = Math.sin(s) * 43758.5453; return s - Math.floor(s); };

/** Weathered concrete with form lines, bug holes, and staining */
function texConcrete(w: number, h: number, seed: number, tint: [number, number, number] = [145, 140, 132]): THREE.CanvasTexture {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  const x = c.getContext('2d')!;
  // Base
  x.fillStyle = `rgb(${tint[0]},${tint[1]},${tint[2]})`;
  x.fillRect(0, 0, w, h);
  // Aggregate speckle
  for (let i = 0; i < w * h * 0.15; i++) {
    const px = R(i * 1.3 + seed) * w, py = R(i * 2.1 + seed) * h;
    const v = tint[0] * (0.82 + R(i * 3.7 + seed) * 0.36);
    x.fillStyle = `rgb(${v | 0},${(v - 4) | 0},${(v - 8) | 0})`;
    x.fillRect(px, py, 1 + R(i * 5 + seed) * 2, 1 + R(i * 4 + seed) * 2);
  }
  // Formwork pour lines (horizontal)
  for (let y = 0; y < h; y += h / 14) {
    x.strokeStyle = `rgba(40,36,30,${0.04 + R(y + seed) * 0.06})`;
    x.lineWidth = 1.5;
    x.beginPath(); x.moveTo(0, y); x.lineTo(w, y); x.stroke();
  }
  // Bug holes (small dark circles — characteristic of poured concrete)
  for (let i = 0; i < 40; i++) {
    const bx = R(i * 9.1 + seed) * w, by = R(i * 7.3 + seed) * h;
    const br = 1 + R(i * 3.3 + seed) * 3;
    x.fillStyle = `rgba(60,55,45,${0.3 + R(i * 5.7 + seed) * 0.3})`;
    x.beginPath(); x.arc(bx, by, br, 0, Math.PI * 2); x.fill();
  }
  // Water stain streaks
  for (let i = 0; i < 12; i++) {
    const sx = R(i * 7.3 + seed + 100) * w;
    const sy = R(i * 3.1 + seed + 100) * h * 0.15;
    const sh = h * (0.3 + R(i * 11.7 + seed + 100) * 0.5);
    const g = x.createLinearGradient(sx, sy, sx, sy + sh);
    g.addColorStop(0, 'rgba(40,35,25,0.12)');
    g.addColorStop(1, 'rgba(40,35,25,0)');
    x.fillStyle = g; x.fillRect(sx - 3, sy, 6 + R(i * 2 + seed) * 4, sh);
  }
  // Efflorescence patches
  for (let i = 0; i < 5; i++) {
    const ex = R(i * 13 + seed) * w, ey = R(i * 9 + seed) * h;
    const er = 15 + R(i * 5 + seed) * 30;
    const rg = x.createRadialGradient(ex, ey, 0, ex, ey, er);
    rg.addColorStop(0, 'rgba(200,195,185,0.18)');
    rg.addColorStop(1, 'rgba(200,195,185,0)');
    x.fillStyle = rg; x.fillRect(ex - er, ey - er, er * 2, er * 2);
  }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

/** Corrugated rusted steel sheet pile with Z-profile corrugation pattern */
function texSheetPile(w: number, h: number, seed: number): THREE.CanvasTexture {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  const x = c.getContext('2d')!;
  // Dark steel base
  x.fillStyle = '#4a4035';
  x.fillRect(0, 0, w, h);
  // Z-profile corrugation — alternating ridges/valleys
  const corrW = w / 24;
  for (let i = 0; i < 24; i++) {
    const cx = i * corrW;
    const isRidge = i % 2 === 0;
    x.fillStyle = isRidge ? '#5a5045' : '#3a3528';
    x.fillRect(cx, 0, corrW, h);
    // Highlight edge
    x.fillStyle = isRidge ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.06)';
    x.fillRect(cx, 0, 1, h);
  }
  // Rust patches — heavy in splash zone (bottom half)
  for (let i = 0; i < 80; i++) {
    const rx = R(i * 3.1 + seed) * w;
    const ry = h * 0.3 + R(i * 7.2 + seed) * h * 0.7; // concentrated lower
    const rw = 8 + R(i * 5.3 + seed) * 25;
    const rh = 5 + R(i * 4.1 + seed) * 15;
    const rr = 100 + R(i * 2.7 + seed) * 55;
    const rg = 45 + R(i * 6.3 + seed) * 30;
    const rb = 15 + R(i * 8.1 + seed) * 20;
    x.fillStyle = `rgba(${rr | 0},${rg | 0},${rb | 0},${0.2 + R(i * 9.1 + seed) * 0.4})`;
    x.fillRect(rx, ry, rw, rh);
  }
  // Rust runs (vertical streaks from bolt holes)
  for (let i = 0; i < 15; i++) {
    const sx = R(i * 11.3 + seed) * w;
    const g = x.createLinearGradient(sx, 0, sx, h);
    g.addColorStop(0, 'rgba(140,70,25,0.0)');
    g.addColorStop(0.3, 'rgba(140,70,25,0.15)');
    g.addColorStop(1, 'rgba(120,55,20,0.25)');
    x.fillStyle = g; x.fillRect(sx - 2, 0, 4, h);
  }
  // Marine growth band at waterline (green/brown algae)
  const mg = x.createLinearGradient(0, h * 0.65, 0, h * 0.85);
  mg.addColorStop(0, 'rgba(40,60,30,0)');
  mg.addColorStop(0.3, 'rgba(35,55,25,0.3)');
  mg.addColorStop(0.7, 'rgba(30,50,20,0.25)');
  mg.addColorStop(1, 'rgba(40,60,30,0)');
  x.fillStyle = mg; x.fillRect(0, h * 0.65, w, h * 0.2);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

/** Weathered timber texture for pilings */
function texTimber(w: number, h: number, seed: number): THREE.CanvasTexture {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  const x = c.getContext('2d')!;
  x.fillStyle = '#5a4a38';
  x.fillRect(0, 0, w, h);
  // Wood grain (vertical lines)
  for (let i = 0; i < w; i += 2) {
    const v = 0.85 + R(i + seed) * 0.3;
    x.strokeStyle = `rgba(${(90 * v) | 0},${(74 * v) | 0},${(56 * v) | 0},0.4)`;
    x.lineWidth = 1 + R(i * 1.7 + seed) * 1.5;
    x.beginPath(); x.moveTo(i, 0); x.lineTo(i + R(i + seed) * 3, h); x.stroke();
  }
  // Knots
  for (let i = 0; i < 4; i++) {
    const kx = R(i * 13 + seed) * w, ky = R(i * 9 + seed) * h;
    x.fillStyle = 'rgba(50,38,25,0.5)';
    x.beginPath(); x.ellipse(kx, ky, 4 + R(i * 5 + seed) * 6, 3 + R(i * 7 + seed) * 4, 0, 0, Math.PI * 2); x.fill();
  }
  // Creosote / darkening at base
  const dg = x.createLinearGradient(0, h * 0.6, 0, h);
  dg.addColorStop(0, 'rgba(25,20,15,0)');
  dg.addColorStop(1, 'rgba(25,20,15,0.4)');
  x.fillStyle = dg; x.fillRect(0, h * 0.6, w, h * 0.4);
  // Marine growth band
  const mg2 = x.createLinearGradient(0, h * 0.55, 0, h * 0.75);
  mg2.addColorStop(0, 'rgba(30,50,20,0)');
  mg2.addColorStop(0.5, 'rgba(25,55,20,0.35)');
  mg2.addColorStop(1, 'rgba(30,50,20,0)');
  x.fillStyle = mg2; x.fillRect(0, h * 0.55, w, h * 0.2);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

/** Riprap / armor stone texture */
function texRiprap(w: number, h: number, seed: number): THREE.CanvasTexture {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  const x = c.getContext('2d')!;
  x.fillStyle = '#6a6358';
  x.fillRect(0, 0, w, h);
  // Individual stones
  for (let i = 0; i < 60; i++) {
    const sx = R(i * 3.7 + seed) * w, sy = R(i * 5.1 + seed) * h;
    const sw = 12 + R(i * 7.3 + seed) * 25, sh = 8 + R(i * 9.1 + seed) * 18;
    const v = R(i * 2.3 + seed);
    const gray = 85 + v * 60;
    x.fillStyle = `rgb(${gray | 0},${(gray - 3) | 0},${(gray - 8) | 0})`;
    x.beginPath();
    x.moveTo(sx, sy); x.lineTo(sx + sw * 0.3, sy - sh * 0.4);
    x.lineTo(sx + sw * 0.7, sy - sh * 0.3); x.lineTo(sx + sw, sy + sh * 0.2);
    x.lineTo(sx + sw * 0.8, sy + sh); x.lineTo(sx + sw * 0.2, sy + sh * 0.8);
    x.closePath(); x.fill();
    // Shadow edge
    x.strokeStyle = `rgba(30,25,20,0.2)`;
    x.lineWidth = 1; x.stroke();
  }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

/* ════════════════════════════════════════════════════════════════
   SHEET PILE SEAWALL — Full engineering cross-section
   Z-profile steel sheet piles, concrete cap, waler, tie rods, deadman
   ════════════════════════════════════════════════════════════════ */
function SheetPileSeawall({ position, length: len }: { position: [number, number, number]; length: number }) {
  const sheetTex = useMemo(() => texSheetPile(1024, 512, 42), []);
  const capTex = useMemo(() => texConcrete(512, 256, 100, [160, 155, 145]), []);

  return (
    <group position={position}>
      {/* ── Sheet pile wall (main vertical element) ── */}
      {/* Extends from mudline (-1.5) to above MHW (+1.2) — total ~2.7m visible */}
      <mesh position={[0, 0.1, 0]} castShadow receiveShadow>
        <boxGeometry args={[0.12, 3.2, len]} />
        <meshStandardMaterial map={sheetTex} roughness={0.82} metalness={0.55} />
      </mesh>

      {/* ── Concrete cap beam — sits on top of sheet piles ── */}
      {/* Typical: 12" x 18" reinforced concrete */}
      <mesh position={[0.04, 1.72, 0]} castShadow>
        <boxGeometry args={[0.35, 0.22, len + 0.1]} />
        <meshStandardMaterial map={capTex} roughness={0.88} metalness={0.04} />
      </mesh>
      {/* Cap chamfer edge */}
      <mesh position={[0.18, 1.62, 0]}>
        <boxGeometry args={[0.03, 0.03, len + 0.1]} />
        <meshStandardMaterial color="#9a9488" roughness={0.9} />
      </mesh>

      {/* ── Steel waler (horizontal channel beam behind piles) ── */}
      {/* Typically C12x20.7 or similar — bolted to sheet piles */}
      {[0.6, 0.0].map((y, i) => (
        <group key={`waler-${i}`}>
          <mesh position={[0.1, y, 0]}>
            <boxGeometry args={[0.06, 0.1, len]} />
            <meshStandardMaterial color="#4a4035" roughness={0.75} metalness={0.65} />
          </mesh>
          {/* Waler connection bolts */}
          {Array.from({ length: Math.floor(len / 0.8) }).map((_, j) => (
            <mesh key={`bolt-${i}-${j}`} position={[0.07, y, -len / 2 + 0.4 + j * 0.8]}>
              <cylinderGeometry args={[0.012, 0.012, 0.04, 6]} />
              <meshStandardMaterial color="#3a3530" roughness={0.6} metalness={0.8} />
            </mesh>
          ))}
        </group>
      ))}

      {/* ── Tie rods — connect sheet pile to deadman anchor ── */}
      {/* Typical: 1" dia steel rod @ 6ft spacing */}
      {Array.from({ length: Math.floor(len / 1.0) }).map((_, i) => (
        <group key={`tierod-${i}`}>
          {/* Rod */}
          <mesh position={[0.55, 0.6, -len / 2 + 0.5 + i * 1.0]} rotation={[0, 0, 0]}>
            <cylinderGeometry args={[0.015, 0.015, 1.0, 6]} />
            <meshStandardMaterial color="#5a4a3a" roughness={0.65} metalness={0.7} />
          </mesh>
          {/* Turnbuckle (center adjuster) */}
          <mesh position={[0.55, 0.6, -len / 2 + 0.5 + i * 1.0]}>
            <boxGeometry args={[0.03, 0.03, 0.08]} />
            <meshStandardMaterial color="#4a3d30" roughness={0.6} metalness={0.75} />
          </mesh>
        </group>
      ))}

      {/* ── Deadman anchor — buried concrete block behind wall ── */}
      <mesh position={[1.1, 0.3, 0]} castShadow>
        <boxGeometry args={[0.4, 0.5, len * 0.85]} />
        <meshStandardMaterial color="#8a8478" roughness={0.92} metalness={0.04} />
      </mesh>

      {/* ── Backfill (retained soil behind wall) ── */}
      <mesh position={[0.8, 0.7, 0]} receiveShadow>
        <boxGeometry args={[1.4, 1.0, len + 0.3]} />
        <meshStandardMaterial color="#7a7058" roughness={0.98} />
      </mesh>
      {/* Grass/ground surface on top of backfill */}
      <mesh position={[0.8, 1.22, 0]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
        <planeGeometry args={[1.6, len + 0.5]} />
        <meshStandardMaterial color="#4a6838" roughness={0.98} />
      </mesh>

      {/* ── Weep holes (drainage through wall) ── */}
      {Array.from({ length: Math.floor(len / 1.5) }).map((_, i) => (
        <mesh key={`weep-${i}`} position={[-0.06, 0.3, -len / 2 + 0.75 + i * 1.5]}
          rotation={[0, 0, Math.PI / 2]}>
          <cylinderGeometry args={[0.02, 0.02, 0.15, 6]} />
          <meshBasicMaterial color="#1a1612" />
        </mesh>
      ))}

      {/* ── Toe protection (scour apron at base) ── */}
      <mesh position={[-0.25, -1.4, 0]} rotation={[0.15, 0, 0]}>
        <boxGeometry args={[0.6, 0.08, len + 0.5]} />
        <meshStandardMaterial color="#6a6358" roughness={0.95} />
      </mesh>

      {/* ── Tidal zone marking / waterline stain ── */}
      <mesh position={[-0.001, -0.3, 0]}>
        <boxGeometry args={[0.13, 0.15, len]} />
        <meshStandardMaterial color="#2a3a22" roughness={0.95} transparent opacity={0.35} />
      </mesh>
    </group>
  );
}

/* ════════════════════════════════════════════════════════════════
   RIPRAP REVETMENT — Armor stone slope with filter layers
   ════════════════════════════════════════════════════════════════ */
function RiprapRevetment({ position, length: len }: { position: [number, number, number]; length: number }) {
  const ripTex = useMemo(() => texRiprap(512, 512, 200), []);

  // Generate individual armor stones
  const stones = useMemo(() => {
    const arr: { pos: [number, number, number]; rot: [number, number, number]; scale: number }[] = [];
    for (let i = 0; i < 180; i++) {
      const z = (R(i * 3.7) - 0.5) * len;
      const slopeT = R(i * 5.1);
      const x = -0.3 - slopeT * 1.8;
      const y = 0.8 - slopeT * 1.8;
      arr.push({
        pos: [x + R(i * 2.3) * 0.15, y + R(i * 4.1) * 0.1, z],
        rot: [R(i * 7) * 0.5, R(i * 11) * Math.PI, R(i * 13) * 0.4],
        scale: 0.06 + R(i * 9) * 0.1,
      });
    }
    return arr;
  }, [len]);

  return (
    <group position={position}>
      {/* ── Slope base / filter layer (geotextile + graded gravel) ── */}
      <mesh position={[-1.0, -0.2, 0]} rotation={[0, 0, -0.65]} receiveShadow>
        <boxGeometry args={[2.2, 0.08, len]} />
        <meshStandardMaterial color="#8a826e" roughness={0.95} />
      </mesh>

      {/* ── Geotextile fabric visible at edges ── */}
      <mesh position={[-0.2, 0.65, 0]} rotation={[0, 0, -0.65]}>
        <boxGeometry args={[2.0, 0.01, len + 0.1]} />
        <meshStandardMaterial color="#4a4a42" roughness={0.98} transparent opacity={0.3} />
      </mesh>

      {/* ── Individual armor stones (dodecahedrons for irregular shapes) ── */}
      {stones.map((s, i) => (
        <mesh key={i}
          position={s.pos}
          rotation={s.rot}
          castShadow>
          <dodecahedronGeometry args={[s.scale, 0]} />
          <meshStandardMaterial
            color={`hsl(${30 + R(i * 3) * 20}, ${8 + R(i * 7) * 10}%, ${42 + R(i * 11) * 18}%)`}
            roughness={0.92}
            metalness={0.05}
          />
        </mesh>
      ))}

      {/* ── Toe stone (larger stones at base for scour protection) ── */}
      {Array.from({ length: Math.floor(len / 0.3) }).map((_, i) => (
        <mesh key={`toe-${i}`}
          position={[-2.0 + R(i * 3) * 0.15, -1.3 + R(i * 5) * 0.1, -len / 2 + i * 0.3]}
          rotation={[R(i * 7) * 0.5, R(i * 11) * 3, R(i * 13) * 0.4]}>
          <dodecahedronGeometry args={[0.1 + R(i * 9) * 0.08, 0]} />
          <meshStandardMaterial color="#6a655a" roughness={0.95} />
        </mesh>
      ))}

      {/* ── Crest cap (concrete curb at top of revetment) ── */}
      <mesh position={[-0.1, 0.9, 0]} castShadow>
        <boxGeometry args={[0.25, 0.15, len + 0.1]} />
        <meshStandardMaterial color="#9a9488" roughness={0.88} />
      </mesh>
    </group>
  );
}

/* ════════════════════════════════════════════════════════════════
   TIMBER & CONCRETE PIER — Full structural assembly
   Pile caps, stringers, concrete deck, fenders, batter piles
   ════════════════════════════════════════════════════════════════ */
function TimberPier({ position, width, length: pLen }: {
  position: [number, number, number]; width: number; length: number;
}) {
  const timberTex = useMemo(() => texTimber(256, 512, 300), []);
  const deckTex = useMemo(() => texConcrete(1024, 512, 400, [155, 150, 140]), []);

  // Pile grid
  const pileRows = Math.floor(pLen / 1.2);
  const pileCols = 3;

  return (
    <group position={position}>
      {/* ── Concrete deck slab (6" typical) ── */}
      <mesh position={[0, 0.9, -pLen / 2]} castShadow receiveShadow>
        <boxGeometry args={[width, 0.1, pLen]} />
        <meshStandardMaterial map={deckTex} roughness={0.88} metalness={0.04} />
      </mesh>

      {/* ── Deck edge beam / curb ── */}
      {[-1, 1].map(side => (
        <mesh key={`curb-${side}`} position={[side * width / 2, 0.98, -pLen / 2]}>
          <boxGeometry args={[0.08, 0.12, pLen]} />
          <meshStandardMaterial color="#9a9488" roughness={0.9} />
        </mesh>
      ))}

      {/* ── Timber stringers (run length of pier under deck) ── */}
      {[-0.5, 0, 0.5].map((xOff, i) => (
        <mesh key={`stringer-${i}`} position={[xOff * width * 0.7, 0.78, -pLen / 2]}>
          <boxGeometry args={[0.1, 0.15, pLen - 0.2]} />
          <meshStandardMaterial map={timberTex} roughness={0.9} metalness={0.05} color="#6a5842" />
        </mesh>
      ))}

      {/* ── Pile caps (cross beams at each bent) ── */}
      {Array.from({ length: pileRows }).map((_, row) => (
        <mesh key={`cap-${row}`} position={[0, 0.65, -row * 1.2 - 0.6]}>
          <boxGeometry args={[width + 0.15, 0.12, 0.12]} />
          <meshStandardMaterial map={timberTex} roughness={0.9} color="#5a4a38" />
        </mesh>
      ))}

      {/* ── Timber piles (vertical — plumb piles) ── */}
      {Array.from({ length: pileRows }).map((_, row) =>
        Array.from({ length: pileCols }).map((_, col) => {
          const xPos = (-1 + col) * (width * 0.4);
          const zPos = -row * 1.2 - 0.6;
          return (
            <mesh key={`pile-${row}-${col}`}
              position={[xPos, -0.4, zPos]}
              castShadow>
              <cylinderGeometry args={[0.06, 0.07, 2.8, 8]} />
              <meshStandardMaterial map={timberTex} roughness={0.92} color="#5a4a38" />
            </mesh>
          );
        })
      )}

      {/* ── Batter piles (angled for lateral loads — every 3rd bent) ── */}
      {Array.from({ length: Math.floor(pileRows / 3) }).map((_, i) => {
        const zPos = -i * 3.6 - 0.6;
        return (
          <group key={`batter-${i}`}>
            <mesh position={[-width * 0.42, -0.3, zPos]}
              rotation={[0, 0, 0.15]} castShadow>
              <cylinderGeometry args={[0.06, 0.07, 2.6, 8]} />
              <meshStandardMaterial map={timberTex} roughness={0.92} color="#4a3a2a" />
            </mesh>
            <mesh position={[width * 0.42, -0.3, zPos]}
              rotation={[0, 0, -0.15]} castShadow>
              <cylinderGeometry args={[0.06, 0.07, 2.6, 8]} />
              <meshStandardMaterial map={timberTex} roughness={0.92} color="#4a3a2a" />
            </mesh>
          </group>
        );
      })}

      {/* ── Cross bracing (X-braces between piles for rigidity) ── */}
      {Array.from({ length: Math.floor(pileRows / 2) }).map((_, i) => {
        const zPos = -i * 2.4 - 1.2;
        return (
          <group key={`brace-${i}`}>
            <mesh position={[0, -0.2, zPos]} rotation={[0.3, 0, 0.6]}>
              <boxGeometry args={[0.04, 0.04, width * 0.7]} />
              <meshStandardMaterial color="#5a4a38" roughness={0.9} metalness={0.1} />
            </mesh>
            <mesh position={[0, -0.2, zPos]} rotation={[-0.3, 0, -0.6]}>
              <boxGeometry args={[0.04, 0.04, width * 0.7]} />
              <meshStandardMaterial color="#5a4a38" roughness={0.9} metalness={0.1} />
            </mesh>
          </group>
        );
      })}

      {/* ── Fender piles (protect pier from vessel impact) ── */}
      {Array.from({ length: Math.floor(pLen / 1.5) }).map((_, i) => (
        <group key={`fender-${i}`}>
          {[-1, 1].map(side => (
            <mesh key={`f-${side}`}
              position={[side * (width / 2 + 0.12), -0.3, -i * 1.5 - 0.5]}
              rotation={[0, 0, side * 0.03]}>
              <cylinderGeometry args={[0.055, 0.065, 2.6, 8]} />
              <meshStandardMaterial map={timberTex} roughness={0.95} color="#3d3025" />
            </mesh>
          ))}
        </group>
      ))}

      {/* ── Rubber fender bumpers (D-type, on fender piles) ── */}
      {Array.from({ length: Math.floor(pLen / 3) }).map((_, i) => (
        <mesh key={`bumper-${i}`}
          position={[width / 2 + 0.16, 0.35, -i * 3 - 1.2]}
          rotation={[Math.PI / 2, 0, 0]}>
          <torusGeometry args={[0.06, 0.025, 8, 12, Math.PI]} />
          <meshStandardMaterial color="#1a1a18" roughness={0.95} metalness={0.05} />
        </mesh>
      ))}

      {/* ── Bollards (for mooring) ── */}
      {Array.from({ length: Math.floor(pLen / 2.5) }).map((_, i) => (
        <group key={`bollard-${i}`}>
          <mesh position={[width / 2 - 0.1, 1.0, -i * 2.5 - 1]}>
            <cylinderGeometry args={[0.04, 0.055, 0.12, 8]} />
            <meshStandardMaterial color="#3a3530" roughness={0.7} metalness={0.65} />
          </mesh>
          <mesh position={[width / 2 - 0.1, 1.06, -i * 2.5 - 1]}>
            <cylinderGeometry args={[0.06, 0.04, 0.02, 8]} />
            <meshStandardMaterial color="#3a3530" roughness={0.7} metalness={0.65} />
          </mesh>
        </group>
      ))}

      {/* ── Safety ladder (recessed into pier face) ── */}
      <group position={[width / 2 + 0.01, 0.2, -pLen * 0.3]}>
        {[0, 0.2, 0.4, 0.6].map((y, i) => (
          <mesh key={`rung-${i}`} position={[0, y, 0]}>
            <boxGeometry args={[0.01, 0.015, 0.2]} />
            <meshStandardMaterial color="#6a6560" roughness={0.7} metalness={0.6} />
          </mesh>
        ))}
      </group>

      {/* ── Deck surface markings ── */}
      <mesh position={[0, 0.96, -pLen / 2]} rotation={[-Math.PI / 2, 0, 0]}>
        <planeGeometry args={[0.04, pLen - 0.3]} />
        <meshBasicMaterial color="#c4beb0" transparent opacity={0.4} />
      </mesh>
    </group>
  );
}

/* ════════════════════════════════════════════════════════════════
   OCEAN — Realistic harbor water with tide level
   ════════════════════════════════════════════════════════════════ */
/** Ocean with throttled wave animation — updates every 3rd frame for performance */
const Ocean = memo(function Ocean() {
  const ref = useRef<THREE.PlaneGeometry | null>(null);
  const frameCount = useRef(0);
  // Reduced resolution: 40x40 instead of 80x80 = 4x fewer vertices to animate
  const geo = useMemo(() => { const g = new THREE.PlaneGeometry(80, 80, 40, 40); ref.current = g; return g; }, []);

  useFrame((state) => {
    frameCount.current++;
    if (frameCount.current % 3 !== 0) return;   // skip 2 of every 3 frames
    if (!ref.current) return;
    const p = ref.current.attributes.position;
    const t = state.clock.elapsedTime;
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i), y = p.getY(i);
      p.setZ(i,
        Math.sin(x * 0.1 + t * 0.5) * 0.04 +
        Math.sin(y * 0.08 + t * 0.35) * 0.03 +
        Math.cos((x + y) * 0.06 + t * 0.2) * 0.02
      );
    }
    p.needsUpdate = true;
    ref.current.computeVertexNormals();
  });

  return (
    <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.6, 0]} geometry={geo} receiveShadow>
      <meshPhysicalMaterial
        color="#15404f"
        metalness={0.65}
        roughness={0.25}
        transparent
        opacity={0.92}
        envMapIntensity={0.6}
      />
    </mesh>
  );
});

/* ════════════════════════════════════════════════════════════════
   MUDLINE / SEABED
   ════════════════════════════════════════════════════════════════ */
function Seabed() {
  return (
    <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -1.8, 0]} receiveShadow>
      <planeGeometry args={[40, 40]} />
      <meshStandardMaterial color="#3a3528" roughness={0.98} />
    </mesh>
  );
}

/* ════════════════════════════════════════════════════════════════
   DAMAGE PIN
   ════════════════════════════════════════════════════════════════ */
const Pin = memo(function Pin({ pin, isSelected, onSelect }: { pin: DamagePin; isSelected: boolean; onSelect: () => void }) {
  const c = SEV_COL[pin.severity] || '#D97706';
  return (
    <group position={pin.position}>
      <mesh position={[0, 0.3, 0]}>
        <cylinderGeometry args={[0.008, 0.008, 0.6, 6]} />
        <meshBasicMaterial color={c} transparent opacity={0.7} />
      </mesh>
      <mesh position={[0, 0.65, 0]} onClick={(e) => { e.stopPropagation(); onSelect(); }}>
        <sphereGeometry args={[isSelected ? 0.12 : 0.065, 16, 16]} />
        <meshPhysicalMaterial color={c} emissive={c} emissiveIntensity={isSelected ? 3 : 0.8}
          metalness={0.3} roughness={0.3} clearcoat={1} clearcoatRoughness={0.1} />
      </mesh>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.01, 0]}>
        <ringGeometry args={[0.08, 0.15, 16]} />
        <meshBasicMaterial color={c} transparent opacity={isSelected ? 0.5 : 0.15} side={THREE.DoubleSide} />
      </mesh>
      {isSelected && (
        <Html distanceFactor={8} position={[0.25, 0.9, 0]} style={{ pointerEvents: 'none' }}>
          <div style={{
            background: 'rgba(2,6,23,0.95)', backdropFilter: 'blur(16px)',
            border: `1px solid ${c}50`, color: 'white', padding: '10px 14px', borderRadius: '10px',
            boxShadow: `0 12px 40px rgba(0,0,0,0.6)`, whiteSpace: 'nowrap',
            fontFamily: 'Inter, system-ui, sans-serif', minWidth: 200,
          }}>
            <div style={{ fontSize: 12, fontWeight: 700, marginBottom: 4 }}>{pin.label}</div>
            <div style={{ fontSize: 9, color: '#94a3b8', marginBottom: 5 }}>{pin.zone}</div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 9 }}>
              <span style={{ background: c + '25', color: c, border: `1px solid ${c}40`, padding: '2px 8px', borderRadius: 5, fontWeight: 700 }}>{pin.severity}</span>
              <span style={{ color: '#64748b' }}>{(pin.confidence * 100).toFixed(0)}%</span>
            </div>
          </div>
        </Html>
      )}
    </group>
  );
});

/* ════════════════════════════════════════════════════════════════
   DAMAGE PINS — Realistic coastal inspection defects
   ════════════════════════════════════════════════════════════════ */
const DEMO_PINS: DamagePin[] = [
  // Seawall — sheet pile (structure 0)
  { id: '1', position: [-0.08, 0.5, -1.5], label: 'Sheet Pile Section Loss', severity: 'S3', confidence: 0.93, bladeId: 0, zone: 'Seawall · Splash Zone · Panel 4' },
  { id: '2', position: [-0.08, -0.3, 0.5], label: 'Through-Wall Corrosion', severity: 'S4', confidence: 0.96, bladeId: 0, zone: 'Seawall · Tidal Zone · Panel 8' },
  { id: '3', position: [0.04, 1.6, 1.0], label: 'Cap Beam Spalling', severity: 'S2', confidence: 0.87, bladeId: 0, zone: 'Seawall · Concrete Cap · Station 6' },
  { id: '4', position: [0.04, 1.6, -2.5], label: 'Tie Rod Corrosion', severity: 'S3', confidence: 0.91, bladeId: 0, zone: 'Seawall · Cap · Tie Rod 3 Exposed' },

  // Riprap revetment (structure 1)
  { id: '5', position: [5.5, 0.2, -1], label: 'Armor Stone Displacement', severity: 'S3', confidence: 0.89, bladeId: 1, zone: 'Revetment · Upper Slope · Section 3' },
  { id: '6', position: [4.5, -0.8, 1.5], label: 'Filter Layer Exposure', severity: 'S4', confidence: 0.94, bladeId: 1, zone: 'Revetment · Mid Slope · Section 5 · Geotextile Visible' },
  { id: '7', position: [5.0, -1.2, 0], label: 'Toe Scour', severity: 'S2', confidence: 0.82, bladeId: 1, zone: 'Revetment · Toe · Station 4' },

  // Pier structure (structure 2)
  { id: '8', position: [-4, 0.0, -2], label: 'Timber Pile Decay', severity: 'S3', confidence: 0.92, bladeId: 2, zone: 'Pier · Pile B-3 · Splash Zone · Marine Borer' },
  { id: '9', position: [-3.5, 0.85, -4], label: 'Deck Slab Delamination', severity: 'S2', confidence: 0.86, bladeId: 2, zone: 'Pier · Deck · Bay 4 · Soffit Spalling' },
  { id: '10', position: [-4.5, 0.6, -1], label: 'Pile Cap Cracking', severity: 'S2', confidence: 0.84, bladeId: 2, zone: 'Pier · Cap Beam · Bent 2' },
  { id: '11', position: [-3, -0.5, -5], label: 'Batter Pile Buckling', severity: 'S4', confidence: 0.95, bladeId: 2, zone: 'Pier · Batter Pile BP-1 · Below MHW' },
  { id: '12', position: [-4.2, 0.3, -3], label: 'Fender Pile Splitting', severity: 'S2', confidence: 0.81, bladeId: 2, zone: 'Pier · Fender F-5 · Impact Zone' },
];

/* ════════════════════════════════════════════════════════════════
   MAIN SCENE
   ════════════════════════════════════════════════════════════════ */
export default function TurbineScene({ selectedPin, onSelectPin }: {
  selectedPin: string | null;
  onSelectPin: (id: string | null) => void;
}) {
  return (
    <Canvas
      camera={{ position: [6, 4, 8], fov: 38 }}
      gl={{ antialias: true, toneMapping: THREE.ACESFilmicToneMapping, toneMappingExposure: 1.05 }}
      shadows
    >
      <Environment preset="city" background={false} />

      <ambientLight intensity={0.3} />
      <directionalLight position={[15, 20, 10]} intensity={1.8} castShadow
        shadow-mapSize={[1024, 1024]} shadow-camera-far={40}
        shadow-camera-left={-12} shadow-camera-right={12}
        shadow-camera-top={12} shadow-camera-bottom={-12}
        color="#fff5e6" />
      <directionalLight position={[-10, 8, -5]} intensity={0.2} color="#8ab4d4" />
      <hemisphereLight intensity={0.35} color="#87ceeb" groundColor="#3d3025" />

      {/* ─── COASTAL INFRASTRUCTURE ─── */}
      <group>
        {/* Sheet pile seawall — runs along waterfront */}
        <SheetPileSeawall position={[0, 0, 0]} length={8} />

        {/* Riprap revetment — adjacent section with stone slope */}
        <RiprapRevetment position={[5.5, 0, 0]} length={6} />

        {/* Timber/concrete pier — extends out from seawall */}
        <TimberPier position={[-4, 0, 0]} width={2.0} length={7} />

        {/* Upland area behind seawall */}
        <mesh position={[2.5, 1.22, 0]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
          <planeGeometry args={[6, 12]} />
          <meshStandardMaterial color="#4a6838" roughness={0.98} />
        </mesh>

        {/* Concrete walkway along cap */}
        <mesh position={[0.2, 1.83, 0]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
          <planeGeometry args={[0.8, 8.2]} />
          <meshStandardMaterial color="#b0a99a" roughness={0.9} />
        </mesh>

        {/* Guardrail along walkway */}
        {Array.from({ length: 16 }).map((_, i) => (
          <group key={`rail-${i}`}>
            <mesh position={[-0.12, 1.95, -3.8 + i * 0.5]}>
              <cylinderGeometry args={[0.008, 0.008, 0.5, 4]} />
              <meshStandardMaterial color="#6a6560" roughness={0.6} metalness={0.6} />
            </mesh>
          </group>
        ))}
        {/* Top rail */}
        <mesh position={[-0.12, 2.2, 0]}>
          <boxGeometry args={[0.015, 0.015, 8]} />
          <meshStandardMaterial color="#6a6560" roughness={0.6} metalness={0.6} />
        </mesh>
        <mesh position={[-0.12, 2.05, 0]}>
          <boxGeometry args={[0.015, 0.015, 8]} />
          <meshStandardMaterial color="#6a6560" roughness={0.6} metalness={0.6} />
        </mesh>

        {/* Damage pins */}
        {DEMO_PINS.map(pin => (
          <Pin key={pin.id} pin={pin} isSelected={pin.id === selectedPin}
            onSelect={() => onSelectPin(pin.id === selectedPin ? null : pin.id)} />
        ))}
      </group>

      <Ocean />
      <Seabed />

      <fog attach="fog" args={['#9aafbf', 20, 50]} />

      <OrbitControls
        enablePan enableZoom enableRotate
        minDistance={2} maxDistance={25}
        minPolarAngle={0.1} maxPolarAngle={Math.PI / 2.05}
        autoRotate={!selectedPin} autoRotateSpeed={0.12}
        target={[0, 0.3, 0]}
      />
    </Canvas>
  );
}

export { DEMO_PINS };
export type { DamagePin };
