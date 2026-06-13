// Whiteboard - Pan/Zoom Canvas mit Pen/Eraser/Text + persistenten Strokes.
//
// Architektur:
// - Ein einziges <canvas>-Element für die gerenderten Strokes. Wir
//   speichern die Strokes als JS-Array (id, color, size, points[])
//   und rendern bei jedem Pan/Zoom neu (canvas.clearRect + redraw).
// - Aktuell während des Zeichnens entsteht der Stroke imperativ
//   (kein State-Update pro Punkt, sonst rendert React ständig). Erst
//   bei Pointer-Up wird der Stroke in den State gepusht und an die
//   API gesendet.
// - Pan: ALT-Drag oder Touch mit 2 Fingern (Pinch dazu für Zoom).
//   Linkes Maustaste in pen/eraser-Mode zeichnet/löscht.
// - Eraser: erkennt den ersten Stroke unter dem Cursor (Hit-Test in
//   World-Coords) und löscht ihn.
// - Coords: wir trennen sauber zwischen Screen-Pixel (Pointer-Event)
//   und World-Pixel (gespeicherter Punkt). screenToWorld nutzt
//   panRef + scaleRef.

import { useEffect, useRef, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  ArrowLeft, Pencil, Eraser, Hand, Trash2, ZoomIn, ZoomOut, Type, Save,
  Grid3x3, Grip, Square, Download, FileText, BookOpen,
} from 'lucide-react';
import { api } from '../utils/api';

const PEN_COLORS = ['#1f2937', '#ef4444', '#f59e0b', '#10b981', '#3b82f6', '#a855f7'];
const PEN_SIZES = [2, 4, 8, 14];
// Eraser-Größen sind SCREEN-Pixel (Durchmesser) — der Radierer fühlt sich
// damit bei jedem Zoom gleich an (wie bei Apple Notes/Freeform). Die
// Umrechnung in Welt-Koordinaten passiert über den aktuellen Scale.
const ERASER_SIZES = [12, 24, 40, 64];
const MIN_SCALE = 0.2;
const MAX_SCALE = 4;

function makeId() {
  return `s_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

// Punkt-zu-Segment-Distanz für Eraser-Hit-Test.
function distPointSegment(px, py, ax, ay, bx, by) {
  const dx = bx - ax;
  const dy = by - ay;
  const lenSq = dx * dx + dy * dy;
  if (lenSq === 0) {
    const ex = px - ax;
    const ey = py - ay;
    return Math.sqrt(ex * ex + ey * ey);
  }
  let t = ((px - ax) * dx + (py - ay) * dy) / lenSq;
  t = Math.max(0, Math.min(1, t));
  const cx = ax + t * dx;
  const cy = ay + t * dy;
  const ex = px - cx;
  const ey = py - cy;
  return Math.sqrt(ex * ex + ey * ey);
}

// Bounding-Box berechnen + cachen — Vor-Filter im Eraser.
function strokeBounds(stroke) {
  if (stroke._bounds) return stroke._bounds;
  const pts = stroke.points || [];
  if (pts.length === 0) {
    return (stroke._bounds = { minX: 0, minY: 0, maxX: 0, maxY: 0 });
  }
  let minX = pts[0].x, maxX = pts[0].x, minY = pts[0].y, maxY = pts[0].y;
  for (let i = 1; i < pts.length; i += 1) {
    if (pts[i].x < minX) minX = pts[i].x;
    else if (pts[i].x > maxX) maxX = pts[i].x;
    if (pts[i].y < minY) minY = pts[i].y;
    else if (pts[i].y > maxY) maxY = pts[i].y;
  }
  return (stroke._bounds = { minX, minY, maxX, maxY });
}

// Schnittpunkte (t in [0,1]) eines Segments A->B mit dem Eraser-Kreis.
function circleSegmentTs(ex, ey, r, ax, ay, bx, by) {
  const dx = bx - ax, dy = by - ay;
  const a = dx * dx + dy * dy;
  if (a === 0) return [];
  const fx = ax - ex, fy = ay - ey;
  const b = 2 * (fx * dx + fy * dy);
  const c = fx * fx + fy * fy - r * r;
  let disc = b * b - 4 * a * c;
  if (disc < 0) return [];
  disc = Math.sqrt(disc);
  const out = [];
  const t1 = (-b - disc) / (2 * a);
  const t2 = (-b + disc) / (2 * a);
  if (t1 >= 0 && t1 <= 1) out.push(t1);
  if (t2 >= 0 && t2 <= 1 && t2 !== t1) out.push(t2);
  return out;
}

// Pixel-genauer Radierer: zerteilt einen Stroke dort, wo der Eraser-Kreis
// die SICHTBARE Tinte berührt. Originaler Stroke wird *nicht* mutiert.
//
// Apple-Verhalten:
// - tol = eraseRadius + halbe Strichbreite -> radiert, sobald der Cursor-
//   Kreis die Tinte überlappt (nicht erst die unsichtbare Mittellinie).
// - Überlebende Teilstücke werden EXAKT an der Kreisgrenze beschnitten
//   (Schnittpunkt-Interpolation) statt am nächsten Roh-Punkt -> saubere,
//   glatte Radier-Kanten ohne Ausfransen.
function splitStrokeByEraser(stroke, ex, ey, eraseRadius) {
  const tol = eraseRadius + (Number(stroke.size) || 3) / 2;
  const tol2 = tol * tol;
  const pts = stroke.points || [];

  // Schneller Bounds-Reject (inkl. Tintenbreite)
  const b = strokeBounds(stroke);
  if (ex + tol < b.minX || ex - tol > b.maxX || ey + tol < b.minY || ey - tol > b.maxY) {
    return { changed: false, parts: [stroke] };
  }

  const inside = (p) => {
    const dx = p.x - ex, dy = p.y - ey;
    return dx * dx + dy * dy < tol2;
  };
  const lerp = (a2, b2, t) => ({ x: a2.x + (b2.x - a2.x) * t, y: a2.y + (b2.y - a2.y) * t });

  if (pts.length <= 1) {
    if (pts.length === 1 && inside(pts[0])) return { changed: true, parts: [] };
    return { changed: false, parts: [stroke] };
  }

  const ranges = [];
  let current = [];
  const closeRange = () => {
    if (current.length >= 2) ranges.push(current);
    current = [];
  };

  let changed = false;
  let prev = pts[0];
  let prevIn = inside(prev);
  if (prevIn) changed = true;
  else current.push(prev);

  for (let i = 1; i < pts.length; i += 1) {
    const p = pts[i];
    const pIn = inside(p);

    if (!prevIn && !pIn) {
      // Beide Endpunkte draußen — Segment kann den Kreis trotzdem queren.
      const ts = circleSegmentTs(ex, ey, tol, prev.x, prev.y, p.x, p.y);
      if (ts.length === 2) {
        changed = true;
        current.push(lerp(prev, p, Math.min(ts[0], ts[1])));
        closeRange();
        current.push(lerp(prev, p, Math.max(ts[0], ts[1])));
        current.push(p);
      } else {
        current.push(p);
      }
    } else if (!prevIn && pIn) {
      // Eintritt in den Kreis: exakt an der Grenze kappen.
      changed = true;
      const ts = circleSegmentTs(ex, ey, tol, prev.x, prev.y, p.x, p.y);
      current.push(lerp(prev, p, ts.length ? Math.min(...ts) : 0));
      closeRange();
    } else if (prevIn && !pIn) {
      // Austritt aus dem Kreis: neues Teilstück startet an der Grenze.
      changed = true;
      const ts = circleSegmentTs(ex, ey, tol, prev.x, prev.y, p.x, p.y);
      current.push(lerp(prev, p, ts.length ? Math.max(...ts) : 1));
      current.push(p);
    } else {
      // Beide drin — Segment wird komplett radiert.
      changed = true;
    }

    prev = p;
    prevIn = pIn;
  }
  closeRange();

  if (!changed) return { changed: false, parts: [stroke] };

  const parts = ranges.map((range) => ({
    id: makeId(),
    color: stroke.color,
    size: stroke.size,
    points: range,
  }));
  return { changed: true, parts };
}

// Objekt-Radierer (Apple: "Objekt löschen"): trifft der Eraser-Kreis die
// sichtbare Tinte irgendwo, wird der GANZE Stroke entfernt.
function strokeHitByEraser(stroke, ex, ey, eraseRadius) {
  const tol = eraseRadius + (Number(stroke.size) || 3) / 2;
  const b = strokeBounds(stroke);
  if (ex + tol < b.minX || ex - tol > b.maxX || ey + tol < b.minY || ey - tol > b.maxY) {
    return false;
  }
  const pts = stroke.points || [];
  if (pts.length === 1) {
    const dx = pts[0].x - ex, dy = pts[0].y - ey;
    return dx * dx + dy * dy < tol * tol;
  }
  for (let i = 1; i < pts.length; i += 1) {
    if (distPointSegment(ex, ey, pts[i - 1].x, pts[i - 1].y, pts[i].x, pts[i].y) < tol) {
      return true;
    }
  }
  return false;
}

export default function WhiteboardPage() {
  const navigate = useNavigate();
  const wrapRef = useRef(null);
  const canvasRef = useRef(null);

  // Tool-State
  const [tool, setTool] = useState('pen'); // 'pen' | 'eraser' | 'pan'
  const [color, setColor] = useState(PEN_COLORS[0]);
  const [penSize, setPenSize] = useState(4);
  const [eraserSize, setEraserSize] = useState(24); // mittlere Screen-Größe als Default
  // Radierer-Modus wie bei Apple: 'pixel' schneidet exakt heraus,
  // 'object' löscht den ganzen berührten Strich.
  const [eraserMode, setEraserMode] = useState(() => {
    try {
      const v = localStorage.getItem('beequ.whiteboard.eraserMode');
      if (v === 'pixel' || v === 'object') return v;
    } catch { /* ignore */ }
    return 'pixel';
  });
  useEffect(() => {
    try { localStorage.setItem('beequ.whiteboard.eraserMode', eraserMode); } catch { /* ignore */ }
  }, [eraserMode]);
  // Active size + setter abhaengig vom Tool
  const size = tool === 'eraser' ? eraserSize : penSize;
  const setSize = tool === 'eraser' ? setEraserSize : setPenSize;
  const currentSizes = tool === 'eraser' ? ERASER_SIZES : PEN_SIZES;
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  // Hintergrund-Template: 'grid' | 'dots' | 'blank' — persistent via localStorage
  const [bg, setBg] = useState(() => {
    try {
      const v = localStorage.getItem('beequ.whiteboard.bg');
      if (v === 'grid' || v === 'dots' || v === 'blank') return v;
    } catch { /* ignore */ }
    return 'grid';
  });
  // Paper-Color: 'white' | 'blue' — manueller Toggle, unabhaengig vom App-Theme
  const [paper, setPaper] = useState(() => {
    try {
      const v = localStorage.getItem('beequ.whiteboard.paper');
      if (v === 'white' || v === 'blue') return v;
    } catch { /* ignore */ }
    return 'white';
  });
  useEffect(() => {
    try { localStorage.setItem('beequ.whiteboard.bg', bg); } catch { /* ignore */ }
  }, [bg]);
  useEffect(() => {
    try { localStorage.setItem('beequ.whiteboard.paper', paper); } catch { /* ignore */ }
  }, [paper]);
  const cycleBg = useCallback(() => {
    setBg((b) => (b === 'grid' ? 'dots' : b === 'dots' ? 'blank' : 'grid'));
  }, []);
  const togglePaper = useCallback(() => {
    setPaper((p) => (p === 'white' ? 'blue' : 'white'));
  }, []);

  // Strokes-Store (gerendert auf canvas)
  const strokesRef = useRef([]); // {id, color, size, points: [{x,y}, ...]}
  const [, forceRender] = useState(0); // nur um Toolbar/Counter zu refreshen

  // Pan/Zoom
  const panRef = useRef({ x: 0, y: 0 });
  const scaleRef = useRef(1);
  const [scaleUi, setScaleUi] = useState(1); // nur für Anzeige

  // Aktuell gezeichneter Stroke (während Pointer-Down)
  const drawingRef = useRef(null); // {id, color, size, points}
  // Aktive Pan-Geste
  const panGestureRef = useRef(null); // {startX, startY, startPanX, startPanY}
  // Multi-Touch Pinch
  const pinchRef = useRef(null); // {startDist, startScale, centerWorld}
  const activePointersRef = useRef(new Map());
  // Eraser-Session: serverseitig bekannte IDs zu Beginn der Geste, plus
  // letzte World-Position für Zwischenpunkt-Interpolation (smoother Eraser).
  const eraserSessionRef = useRef(null); // {startIds: Set<string>, lastWorld: {x,y}|null}
  // Eraser-Cursor-Overlay: zeigt exakt den Eraser-Radius als Kreis am Pointer.
  // Ref-basiert, um Re-Renders pro Move zu vermeiden.
  const eraserCursorRef = useRef(null);

  // ── Canvas-Resize + DPR-aware ─────────────────────────────────────
  const setupCanvasSize = useCallback(() => {
    const canvas = canvasRef.current;
    const wrap = wrapRef.current;
    if (!canvas || !wrap) return;
    const dpr = window.devicePixelRatio || 1;
    const rect = wrap.getBoundingClientRect();
    canvas.width = Math.floor(rect.width * dpr);
    canvas.height = Math.floor(rect.height * dpr);
    canvas.style.width = `${rect.width}px`;
    canvas.style.height = `${rect.height}px`;
    const ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }, []);

  // ── Render-Loop ──────────────────────────────────────────────────
  const redraw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const dpr = window.devicePixelRatio || 1;
    const w = canvas.width / dpr;
    const h = canvas.height / dpr;
    ctx.clearRect(0, 0, w, h);

    // Hintergrund-Template (subtil) — dark-mode-aware + Paper-Color
    const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
    let bgFill;
    let patternColor;
    if (paper === 'blue') {
      // Blueprint-Look: helles Blau (light) bzw. tiefes Marineblau (dark)
      bgFill = isDark ? '#0c1f3a' : '#e9f2ff';
      patternColor = isDark ? 'rgba(160, 200, 255, 0.14)' : 'rgba(20, 70, 160, 0.16)';
    } else {
      // Pure White / Neutral Dark
      bgFill = isDark ? '#1a1a1a' : '#ffffff';
      patternColor = isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.08)';
    }
    ctx.save();
    ctx.fillStyle = bgFill;
    ctx.fillRect(0, 0, w, h);
    const step = 40 * scaleRef.current;
    if (bg === 'grid' && step > 8) {
      ctx.strokeStyle = patternColor;
      ctx.lineWidth = 1;
      const offsetX = ((panRef.current.x % step) + step) % step;
      const offsetY = ((panRef.current.y % step) + step) % step;
      ctx.beginPath();
      for (let x = offsetX; x < w; x += step) {
        ctx.moveTo(x, 0); ctx.lineTo(x, h);
      }
      for (let y = offsetY; y < h; y += step) {
        ctx.moveTo(0, y); ctx.lineTo(w, y);
      }
      ctx.stroke();
    } else if (bg === 'dots' && step > 8) {
      ctx.fillStyle = patternColor;
      const dotRadius = Math.max(0.8, Math.min(1.8, scaleRef.current));
      const offsetX = ((panRef.current.x % step) + step) % step;
      const offsetY = ((panRef.current.y % step) + step) % step;
      for (let x = offsetX; x < w; x += step) {
        for (let y = offsetY; y < h; y += step) {
          ctx.beginPath();
          ctx.arc(x, y, dotRadius, 0, Math.PI * 2);
          ctx.fill();
        }
      }
    }
    ctx.restore();

    // Strokes (in Welt-Coords; via setTransform skalieren wir)
    ctx.save();
    ctx.translate(panRef.current.x, panRef.current.y);
    ctx.scale(scaleRef.current, scaleRef.current);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    const drawStroke = (s) => {
      const pts = s.points;
      if (!pts || pts.length < 2) return;
      ctx.strokeStyle = s.color;
      ctx.lineWidth = s.size;
      ctx.beginPath();
      ctx.moveTo(pts[0].x, pts[0].y);
      for (let i = 1; i < pts.length; i += 1) {
        ctx.lineTo(pts[i].x, pts[i].y);
      }
      ctx.stroke();
    };

    strokesRef.current.forEach(drawStroke);
    if (drawingRef.current) drawStroke(drawingRef.current);

    ctx.restore();
  }, [bg, paper]);

  // ── Init: Resize-Observer + Load Strokes ─────────────────────────
  useEffect(() => {
    setupCanvasSize();
    redraw();
    const onResize = () => { setupCanvasSize(); redraw(); };
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [setupCanvasSize, redraw]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const data = await api.getWhiteboardStrokes();
        if (cancelled) return;
        const list = Array.isArray(data?.strokes) ? data.strokes : [];
        strokesRef.current = list.map((s) => ({
          id: String(s.id),
          color: s.color || '#1f2937',
          size: Number(s.size) || 3,
          points: Array.isArray(s.points) ? s.points : [],
        }));
        redraw();
      } catch (err) {
        console.error('[Whiteboard] load failed:', err);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [redraw]);

  // ── Coord-Helpers ────────────────────────────────────────────────
  const screenToWorld = useCallback((clientX, clientY) => {
    const rect = canvasRef.current.getBoundingClientRect();
    const sx = clientX - rect.left;
    const sy = clientY - rect.top;
    return {
      x: (sx - panRef.current.x) / scaleRef.current,
      y: (sy - panRef.current.y) / scaleRef.current,
    };
  }, []);

  // ── Zoom (Wheel + Buttons) ───────────────────────────────────────
  const zoomAt = useCallback((factor, centerScreen) => {
    const oldScale = scaleRef.current;
    const newScale = Math.max(MIN_SCALE, Math.min(MAX_SCALE, oldScale * factor));
    if (newScale === oldScale) return;
    const rect = canvasRef.current.getBoundingClientRect();
    const cx = centerScreen ? centerScreen.x - rect.left : rect.width / 2;
    const cy = centerScreen ? centerScreen.y - rect.top : rect.height / 2;
    // Welt-Punkt unter Cursor soll fix bleiben.
    const wx = (cx - panRef.current.x) / oldScale;
    const wy = (cy - panRef.current.y) / oldScale;
    panRef.current = { x: cx - wx * newScale, y: cy - wy * newScale };
    scaleRef.current = newScale;
    setScaleUi(newScale);
    redraw();
  }, [redraw]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return undefined;
    const onWheel = (e) => {
      e.preventDefault();
      const factor = e.deltaY < 0 ? 1.1 : 1 / 1.1;
      zoomAt(factor, { x: e.clientX, y: e.clientY });
    };
    canvas.addEventListener('wheel', onWheel, { passive: false });
    return () => canvas.removeEventListener('wheel', onWheel);
  }, [zoomAt]);

  // Eraser-Radius im Welt-Koordinatensystem. eraserSize ist ein SCREEN-
  // Durchmesser → in Welt-Pixel = (size/2) / scale. So bleibt der Radierer
  // bei jedem Zoom gleich groß auf dem Bildschirm (Apple-Verhalten).
  const eraserWorldRadius = useCallback(() => {
    return (Number(eraserSize) / 2) / scaleRef.current;
  }, [eraserSize]);

  // Cursor-Overlay auf Pointer-Position aktualisieren (Ref-basiert, kein Re-Render).
  const updateEraserCursor = useCallback((clientX, clientY) => {
    const el = eraserCursorRef.current;
    if (!el) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const localX = clientX - rect.left;
    const localY = clientY - rect.top;
    const radiusScreen = eraserWorldRadius() * scaleRef.current;
    const d = radiusScreen * 2;
    el.style.width = `${d}px`;
    el.style.height = `${d}px`;
    el.style.transform = `translate3d(${localX - radiusScreen}px, ${localY - radiusScreen}px, 0)`;
  }, [eraserWorldRadius]);

  // Erase an einer Welt-Position. 'object' löscht ganze Striche, 'pixel'
  // schneidet exakt heraus.
  const eraseAt = useCallback((wx, wy) => {
    const radius = eraserWorldRadius();
    const list = strokesRef.current;
    let changed = false;
    const next = [];
    if (eraserMode === 'object') {
      for (let i = 0; i < list.length; i += 1) {
        if (strokeHitByEraser(list[i], wx, wy, radius)) changed = true;
        else next.push(list[i]);
      }
    } else {
      for (let i = 0; i < list.length; i += 1) {
        const res = splitStrokeByEraser(list[i], wx, wy, radius);
        if (res.changed) changed = true;
        for (let j = 0; j < res.parts.length; j += 1) next.push(res.parts[j]);
      }
    }
    if (changed) {
      strokesRef.current = next;
      redraw();
      forceRender((n) => n + 1);
    }
  }, [eraserWorldRadius, eraserMode, redraw]);

  // ── Pointer-Handling: Pen/Eraser/Pan + Pinch ─────────────────────
  const onPointerDown = useCallback((e) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    canvas.setPointerCapture?.(e.pointerId);
    activePointersRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY });

    // 2-Finger Pinch
    if (activePointersRef.current.size === 2) {
      const [a, b] = Array.from(activePointersRef.current.values());
      const dx = b.x - a.x; const dy = b.y - a.y;
      const startDist = Math.sqrt(dx * dx + dy * dy) || 1;
      const center = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      pinchRef.current = { startDist, startScale: scaleRef.current, center };
      // Aktiven Draw-Stroke abbrechen
      drawingRef.current = null;
      panGestureRef.current = null;
      return;
    }

    // Pan-Mode oder ALT/Mittel-Klick = Pan
    if (tool === 'pan' || e.button === 1 || e.altKey) {
      panGestureRef.current = {
        startX: e.clientX, startY: e.clientY,
        startPanX: panRef.current.x, startPanY: panRef.current.y,
      };
      return;
    }

    const world = screenToWorld(e.clientX, e.clientY);

    if (tool === 'eraser') {
      // Pixel-genauer Radierer: Session starten — alle IDs jetzt sind
      // serverseitig bekannt; was am Ende fehlt -> API-Delete, was neu da ist -> API-Create.
      const startIds = new Set();
      for (const s of strokesRef.current) startIds.add(s.id);
      eraserSessionRef.current = { startIds, lastWorld: world };
      eraseAt(world.x, world.y);
      return;
    }

    // Pen: neuen Stroke beginnen
    drawingRef.current = {
      id: makeId(),
      color,
      size,
      points: [world],
    };
  }, [tool, color, size, screenToWorld, redraw]);

  const onPointerMove = useCallback((e) => {
    if (activePointersRef.current.has(e.pointerId)) {
      activePointersRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    }
    // Cursor-Overlay aktualisieren — immer, wenn Eraser aktiv ist (auch ohne Druck)
    if (tool === 'eraser') updateEraserCursor(e.clientX, e.clientY);

    // Pinch
    if (pinchRef.current && activePointersRef.current.size === 2) {
      const [a, b] = Array.from(activePointersRef.current.values());
      const dx = b.x - a.x; const dy = b.y - a.y;
      const dist = Math.sqrt(dx * dx + dy * dy) || 1;
      const factor = (dist / pinchRef.current.startDist);
      const target = pinchRef.current.startScale * factor;
      const newScale = Math.max(MIN_SCALE, Math.min(MAX_SCALE, target));
      const ratio = newScale / scaleRef.current;
      if (ratio !== 1) {
        const rect = canvasRef.current.getBoundingClientRect();
        const cx = pinchRef.current.center.x - rect.left;
        const cy = pinchRef.current.center.y - rect.top;
        const wx = (cx - panRef.current.x) / scaleRef.current;
        const wy = (cy - panRef.current.y) / scaleRef.current;
        panRef.current = { x: cx - wx * newScale, y: cy - wy * newScale };
        scaleRef.current = newScale;
        setScaleUi(newScale);
        redraw();
      }
      return;
    }

    if (panGestureRef.current) {
      const g = panGestureRef.current;
      panRef.current = {
        x: g.startPanX + (e.clientX - g.startX),
        y: g.startPanY + (e.clientY - g.startY),
      };
      redraw();
      return;
    }

    // Eraser-Drag: an jedem Punkt + Zwischenpunkte (damit schnelle Bewegungen
    // keine Lücken hinterlassen) erasen.
    if (tool === 'eraser' && eraserSessionRef.current) {
      const world = screenToWorld(e.clientX, e.clientY);
      const last = eraserSessionRef.current.lastWorld;
      if (last) {
        const dx = world.x - last.x, dy = world.y - last.y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        const step = eraserWorldRadius() * 0.6; // überlappende Schritte
        const steps = Math.max(1, Math.floor(dist / step));
        for (let i = 1; i <= steps; i += 1) {
          const t = i / steps;
          eraseAt(last.x + dx * t, last.y + dy * t);
        }
      } else {
        eraseAt(world.x, world.y);
      }
      eraserSessionRef.current.lastWorld = world;
      return;
    }

    if (drawingRef.current) {
      const world = screenToWorld(e.clientX, e.clientY);
      const pts = drawingRef.current.points;
      const last = pts[pts.length - 1];
      // Mindest-Distanz, damit Punkte nicht zu eng liegen.
      const dx = world.x - last.x;
      const dy = world.y - last.y;
      if (dx * dx + dy * dy < 1) return;
      pts.push(world);
      redraw();
    }
  }, [redraw, screenToWorld, tool, eraseAt, eraserWorldRadius, updateEraserCursor]);

  const onPointerUp = useCallback((e) => {
    const canvas = canvasRef.current;
    canvas?.releasePointerCapture?.(e.pointerId);
    activePointersRef.current.delete(e.pointerId);
    if (activePointersRef.current.size < 2) pinchRef.current = null;
    panGestureRef.current = null;

    // Eraser-Session beenden: Diff vs. Start-IDs → Delete entfallener,
    // Create neuer Sub-Strokes. Batched, damit nicht pro Pointermove
    // ein API-Call rausgeht.
    if (eraserSessionRef.current) {
      const { startIds } = eraserSessionRef.current;
      eraserSessionRef.current = null;
      const currentIds = new Set();
      for (const s of strokesRef.current) currentIds.add(s.id);
      const toDelete = [];
      for (const id of startIds) {
        if (!currentIds.has(id)) toDelete.push(id);
      }
      const toCreate = strokesRef.current.filter((s) => !startIds.has(s.id));
      if (toDelete.length > 0 || toCreate.length > 0) {
        setSaving(true);
        const ops = [];
        for (const id of toDelete) {
          ops.push(api.deleteWhiteboardStroke(id).catch((err) => {
            console.warn('[Whiteboard] eraser delete failed:', err?.message || err);
          }));
        }
        for (const stroke of toCreate) {
          ops.push(api.createWhiteboardStroke({
            id: stroke.id,
            color: stroke.color,
            size: stroke.size,
            points: stroke.points,
          }).catch((err) => {
            console.warn('[Whiteboard] eraser create failed:', err?.message || err);
          }));
        }
        Promise.all(ops).finally(() => setSaving(false));
      }
      return;
    }

    if (drawingRef.current && drawingRef.current.points.length >= 2) {
      const stroke = drawingRef.current;
      drawingRef.current = null;
      strokesRef.current = [...strokesRef.current, stroke];
      redraw();
      forceRender((n) => n + 1);
      setSaving(true);
      api.createWhiteboardStroke({
        id: stroke.id,
        color: stroke.color,
        size: stroke.size,
        points: stroke.points,
      })
        .catch((err) => console.warn('[Whiteboard] create failed:', err?.message || err))
        .finally(() => setSaving(false));
    } else {
      drawingRef.current = null;
    }
  }, [redraw]);

  // ── Clear All ────────────────────────────────────────────────────
  const handleClear = useCallback(async () => {
    if (strokesRef.current.length === 0) return;
    const ok = window.confirm('Whiteboard komplett leeren? Diese Aktion kann nicht rückgängig gemacht werden.');
    if (!ok) return;
    strokesRef.current = [];
    redraw();
    forceRender((n) => n + 1);
    try {
      await api.clearWhiteboardStrokes();
    } catch (err) {
      console.warn('[Whiteboard] clear failed:', err?.message || err);
    }
  }, [redraw]);

  const handleResetView = useCallback(() => {
    panRef.current = { x: 0, y: 0 };
    scaleRef.current = 1;
    setScaleUi(1);
    redraw();
  }, [redraw]);

  // ── Export als PNG ───────────────────────────────────────────────
  // Rendert ein Off-Screen-Canvas in der Größe der Stroke-Bounding-Box
  // (mit Padding) und triggert einen Download. 2× DPR für crispe Schrift.
  const handleExportPng = useCallback(() => {
    const strokes = strokesRef.current;
    let minX, minY, maxX, maxY;
    if (strokes.length === 0) {
      minX = 0; minY = 0; maxX = 800; maxY = 600;
    } else {
      minX = Infinity; minY = Infinity; maxX = -Infinity; maxY = -Infinity;
      for (const s of strokes) {
        const b = strokeBounds(s);
        const half = (Number(s.size) || 3) / 2;
        if (b.minX - half < minX) minX = b.minX - half;
        if (b.minY - half < minY) minY = b.minY - half;
        if (b.maxX + half > maxX) maxX = b.maxX + half;
        if (b.maxY + half > maxY) maxY = b.maxY + half;
      }
    }
    const pad = 32;
    minX -= pad; minY -= pad; maxX += pad; maxY += pad;
    const width = Math.max(1, Math.ceil(maxX - minX));
    const height = Math.max(1, Math.ceil(maxY - minY));

    const dpr = 2;
    const ex = document.createElement('canvas');
    ex.width = width * dpr;
    ex.height = height * dpr;
    const ctx = ex.getContext('2d');
    ctx.scale(dpr, dpr);

    // Background-Farbe + Pattern (matched aktuellen bg-Modus + Paper-Color)
    const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
    let exFill;
    let exPatternColor;
    if (paper === 'blue') {
      exFill = isDark ? '#0c1f3a' : '#e9f2ff';
      exPatternColor = isDark ? 'rgba(160, 200, 255, 0.14)' : 'rgba(20, 70, 160, 0.16)';
    } else {
      exFill = isDark ? '#1a1a1a' : '#ffffff';
      exPatternColor = isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.08)';
    }
    ctx.fillStyle = exFill;
    ctx.fillRect(0, 0, width, height);

    ctx.translate(-minX, -minY);

    const patternColor = exPatternColor;
    const step = 40;
    if (bg === 'grid') {
      ctx.strokeStyle = patternColor;
      ctx.lineWidth = 1;
      ctx.beginPath();
      const sx = Math.floor(minX / step) * step;
      const sy = Math.floor(minY / step) * step;
      for (let x = sx; x <= maxX; x += step) { ctx.moveTo(x, minY); ctx.lineTo(x, maxY); }
      for (let y = sy; y <= maxY; y += step) { ctx.moveTo(minX, y); ctx.lineTo(maxX, y); }
      ctx.stroke();
    } else if (bg === 'dots') {
      ctx.fillStyle = patternColor;
      const sx = Math.floor(minX / step) * step;
      const sy = Math.floor(minY / step) * step;
      for (let x = sx; x <= maxX; x += step) {
        for (let y = sy; y <= maxY; y += step) {
          ctx.beginPath();
          ctx.arc(x, y, 1.2, 0, Math.PI * 2);
          ctx.fill();
        }
      }
    }

    // Strokes
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    for (const s of strokes) {
      if (!s.points || s.points.length < 2) continue;
      ctx.strokeStyle = s.color || '#1f2937';
      ctx.lineWidth = Number(s.size) || 3;
      ctx.beginPath();
      ctx.moveTo(s.points[0].x, s.points[0].y);
      for (let i = 1; i < s.points.length; i += 1) {
        ctx.lineTo(s.points[i].x, s.points[i].y);
      }
      ctx.stroke();
    }

    ex.toBlob((blob) => {
      if (!blob) return;
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      const ts = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
      a.download = `whiteboard_${ts}.png`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    }, 'image/png');
  }, [bg, paper]);

  const cursor = tool === 'pan' ? 'grab' : tool === 'eraser' ? 'none' : 'crosshair';

  return (
    <div className="wb-page">
      <header className="wb-header">
        <button
          className="wb-btn-back"
          onClick={() => navigate('/app/notes')}
          title="Zurück zu den Notizen"
          aria-label="Zurück zu den Notizen"
        >
          <ArrowLeft size={20} />
        </button>
        <div className="wb-title">
          <Type size={16} aria-hidden="true" />
          <span>Whiteboard</span>
          <span className="wb-count">{strokesRef.current.length} Striche</span>
          {saving && <span className="wb-saving"><Save size={12} /> speichert...</span>}
        </div>
        <div className="wb-toolbar">
          <div className="wb-tool-group" role="radiogroup" aria-label="Werkzeuge">
            <button
              type="button"
              className={`wb-btn ${tool === 'pen' ? 'is-active' : ''}`}
              onClick={() => setTool('pen')}
              aria-pressed={tool === 'pen'}
              title="Stift (P)"
            >
              <Pencil size={16} />
            </button>
            <button
              type="button"
              className={`wb-btn ${tool === 'eraser' ? 'is-active' : ''}`}
              onClick={() => setTool('eraser')}
              aria-pressed={tool === 'eraser'}
              title="Radierer (E)"
            >
              <Eraser size={16} />
            </button>
            <button
              type="button"
              className={`wb-btn ${tool === 'pan' ? 'is-active' : ''}`}
              onClick={() => setTool('pan')}
              aria-pressed={tool === 'pan'}
              title="Verschieben (H)"
            >
              <Hand size={16} />
            </button>
          </div>
          <div className="wb-tool-group wb-colors" role="radiogroup" aria-label="Farbe">
            {PEN_COLORS.map((c) => (
              <button
                key={c}
                type="button"
                className={`wb-color ${color === c ? 'is-active' : ''}`}
                style={{ background: c }}
                onClick={() => setColor(c)}
                aria-label={`Farbe ${c}`}
              />
            ))}
          </div>
          {tool === 'eraser' && (
            <div className="wb-tool-group" role="radiogroup" aria-label="Radierer-Modus">
              <button
                type="button"
                className={`wb-btn ${eraserMode === 'pixel' ? 'is-active' : ''}`}
                onClick={() => setEraserMode('pixel')}
                aria-pressed={eraserMode === 'pixel'}
                title="Pixel-Radierer — schneidet exakt heraus"
              >
                <Eraser size={16} />
              </button>
              <button
                type="button"
                className={`wb-btn ${eraserMode === 'object' ? 'is-active' : ''}`}
                onClick={() => setEraserMode('object')}
                aria-pressed={eraserMode === 'object'}
                title="Objekt-Radierer — löscht ganze Striche"
              >
                <Square size={16} />
              </button>
            </div>
          )}
          <div className="wb-tool-group wb-sizes" role="radiogroup" aria-label={tool === 'eraser' ? 'Radierer-Größe' : 'Strichstärke'}>
            {currentSizes.map((s) => {
              // Vorschau-Punkt: Stift 1:1, Radierer proportional aber gedeckelt.
              const dot = tool === 'eraser'
                ? Math.round(8 + (s / 64) * 14) // 12px→~11, 64px→22
                : Math.min(20, s + 4);
              return (
                <button
                  key={s}
                  type="button"
                  className={`wb-size ${size === s ? 'is-active' : ''}`}
                  onClick={() => setSize(s)}
                  aria-pressed={size === s}
                  title={tool === 'eraser' ? `Radierer ${s}px` : `Stärke ${s}px`}
                >
                  <span
                    className="wb-size-dot"
                    style={{
                      width: dot,
                      height: dot,
                      background: tool === 'eraser' ? 'transparent' : color,
                      border: tool === 'eraser' ? '1.5px solid currentColor' : 'none',
                      borderRadius: '50%',
                    }}
                  />
                </button>
              );
            })}
          </div>
          <div className="wb-tool-group">
            <button className="wb-btn" onClick={() => zoomAt(1 / 1.2, null)} title="Verkleinern">
              <ZoomOut size={16} />
            </button>
            <button className="wb-btn wb-zoom-label" onClick={handleResetView} title="Zoom zurücksetzen">
              {Math.round(scaleUi * 100)}%
            </button>
            <button className="wb-btn" onClick={() => zoomAt(1.2, null)} title="Vergrößern">
              <ZoomIn size={16} />
            </button>
          </div>
          <div className="wb-tool-group">
            <button
              className="wb-btn"
              onClick={cycleBg}
              title={`Hintergrund: ${bg === 'grid' ? 'Raster' : bg === 'dots' ? 'Punkte' : 'Blank'} — Klick wechselt`}
              aria-label="Hintergrund-Template wechseln"
            >
              {bg === 'grid' ? <Grid3x3 size={16} /> : bg === 'dots' ? <Grip size={16} /> : <Square size={16} />}
            </button>
            <button
              className="wb-btn"
              onClick={togglePaper}
              title={`Papier: ${paper === 'white' ? 'Weiß' : 'Blau'} — Klick wechselt`}
              aria-label="Papierfarbe wechseln"
            >
              {paper === 'white' ? <FileText size={16} /> : <BookOpen size={16} />}
            </button>
            <button
              className="wb-btn"
              onClick={handleExportPng}
              title="Als PNG exportieren"
              aria-label="Whiteboard als PNG exportieren"
            >
              <Download size={16} />
            </button>
          </div>
          <button className="wb-btn wb-btn-danger" onClick={handleClear} title="Alles löschen">
            <Trash2 size={16} />
          </button>
        </div>
      </header>

      <div ref={wrapRef} className="wb-canvas-wrap">
        <canvas
          ref={canvasRef}
          className="wb-canvas"
          style={{ cursor, touchAction: 'none' }}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
          onPointerEnter={(e) => {
            if (tool === 'eraser' && eraserCursorRef.current) {
              eraserCursorRef.current.style.display = 'block';
              updateEraserCursor(e.clientX, e.clientY);
            }
          }}
          onPointerLeave={() => {
            if (eraserCursorRef.current) eraserCursorRef.current.style.display = 'none';
          }}
        />
        {/* Eraser-Cursor-Overlay: zeigt exakt den Eraser-Radius am Pointer */}
        <div
          ref={eraserCursorRef}
          className="wb-eraser-cursor"
          aria-hidden="true"
          style={{ display: tool === 'eraser' ? 'block' : 'none' }}
        />
        {loading && (
          <div className="wb-loading">Lade Whiteboard...</div>
        )}
        {!loading && strokesRef.current.length === 0 && (
          <div className="wb-hint">
            Tipp: Stift wählen und einfach losmalen. Pinch oder Mausrad zum Zoomen. Alt-Drag oder Hand-Modus zum Verschieben.
          </div>
        )}
      </div>
    </div>
  );
}
