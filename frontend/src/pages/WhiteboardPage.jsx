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
  Grid3x3, Grip, Square, Download, FileText, BookOpen, Undo2, Redo2,
} from 'lucide-react';
import { api } from '../utils/api';

const PEN_COLORS = ['#1f2937', '#ffffff', '#ef4444', '#f59e0b', '#10b981', '#3b82f6', '#a855f7'];
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
  const canvasRef = useRef(null);   // Tinte (oben, transparent)
  const bgCanvasRef = useRef(null); // Hintergrund (unten: Fill + Raster)

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

  // ── Undo/Redo ─────────────────────────────────────────────────────
  // Jede Aktion ist invertierbar:
  //   { type:'add',    strokes:[...] } Strich(e) hinzugefügt (Stift / Pixel-Radierer)
  //   { type:'remove', strokes:[...] } ganze Striche gelöscht (Objekt-Radierer)
  //   { type:'clear',  strokes:[...] } alles geleert
  const undoStackRef = useRef([]);
  const redoStackRef = useRef([]);
  const [histTick, setHistTick] = useState(0); // refresht nur die Undo/Redo-Buttons
  const pushHistory = useCallback((action) => {
    undoStackRef.current.push(action);
    if (undoStackRef.current.length > 100) undoStackRef.current.shift();
    redoStackRef.current = [];
    setHistTick((n) => n + 1);
  }, []);

  // ── Canvas-Resize + DPR-aware (beide Layer gleich groß) ───────────
  const setupCanvasSize = useCallback(() => {
    const canvas = canvasRef.current;
    const wrap = wrapRef.current;
    if (!canvas || !wrap) return;
    const dpr = window.devicePixelRatio || 1;
    const rect = wrap.getBoundingClientRect();
    for (const c of [bgCanvasRef.current, canvas]) {
      if (!c) continue;
      c.width = Math.floor(rect.width * dpr);
      c.height = Math.floor(rect.height * dpr);
      c.style.width = `${rect.width}px`;
      c.style.height = `${rect.height}px`;
      c.getContext('2d').setTransform(dpr, 0, 0, dpr, 0, 0);
    }
  }, []);

  // ── Render-Loop ──────────────────────────────────────────────────
  // Zwei Layer: Hintergrund (bgCanvas) + Tinte (canvas). Der Radierer
  // entfernt mit globalCompositeOperation 'destination-out' echte Pixel
  // aus der Tinten-Ebene — dadurch scheint der Hintergrund durch und es
  // wird pixelgenau (auch nur die halbe Strichbreite) radiert, wie bei Apple.
  const redraw = useCallback(() => {
    const canvas = canvasRef.current;
    const bgCanvas = bgCanvasRef.current;
    if (!canvas) return;
    const dpr = window.devicePixelRatio || 1;
    const w = canvas.width / dpr;
    const h = canvas.height / dpr;

    // ── Hintergrund-Layer ──
    if (bgCanvas) {
      const bctx = bgCanvas.getContext('2d');
      bctx.clearRect(0, 0, w, h);
      const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
      let bgFill, patternColor;
      if (paper === 'blue') {
        bgFill = isDark ? '#0c1f3a' : '#e9f2ff';
        patternColor = isDark ? 'rgba(160, 200, 255, 0.14)' : 'rgba(20, 70, 160, 0.16)';
      } else {
        bgFill = isDark ? '#1a1a1a' : '#ffffff';
        patternColor = isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.08)';
      }
      bctx.fillStyle = bgFill;
      bctx.fillRect(0, 0, w, h);
      const step = 40 * scaleRef.current;
      if (bg === 'grid' && step > 8) {
        bctx.strokeStyle = patternColor;
        bctx.lineWidth = 1;
        const offsetX = ((panRef.current.x % step) + step) % step;
        const offsetY = ((panRef.current.y % step) + step) % step;
        bctx.beginPath();
        for (let x = offsetX; x < w; x += step) { bctx.moveTo(x, 0); bctx.lineTo(x, h); }
        for (let y = offsetY; y < h; y += step) { bctx.moveTo(0, y); bctx.lineTo(w, y); }
        bctx.stroke();
      } else if (bg === 'dots' && step > 8) {
        bctx.fillStyle = patternColor;
        const dotRadius = Math.max(0.8, Math.min(1.8, scaleRef.current));
        const offsetX = ((panRef.current.x % step) + step) % step;
        const offsetY = ((panRef.current.y % step) + step) % step;
        for (let x = offsetX; x < w; x += step) {
          for (let y = offsetY; y < h; y += step) {
            bctx.beginPath();
            bctx.arc(x, y, dotRadius, 0, Math.PI * 2);
            bctx.fill();
          }
        }
      }
    }

    // ── Tinten-Layer (transparent) ──
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, w, h);
    ctx.save();
    ctx.translate(panRef.current.x, panRef.current.y);
    ctx.scale(scaleRef.current, scaleRef.current);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    const drawStroke = (s) => {
      const pts = s.points;
      if (!pts || pts.length < 2) return;
      if (s.erase) {
        // Pixel-Radierer: zieht exakt die überfahrene Fläche ab.
        ctx.globalCompositeOperation = 'destination-out';
        ctx.strokeStyle = 'rgba(0,0,0,1)';
      } else {
        ctx.globalCompositeOperation = 'source-over';
        ctx.strokeStyle = s.color;
      }
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

    ctx.globalCompositeOperation = 'source-over';
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
          erase: s.erase === true,
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

  // Objekt-Radierer: löscht ganze (sichtbare Pen-)Striche unter dem Cursor.
  // Getroffene IDs werden in der Session gesammelt → Batch-Delete am Ende.
  const eraseObjectsAt = useCallback((wx, wy) => {
    const radius = eraserWorldRadius();
    const list = strokesRef.current;
    const sess = eraserSessionRef.current;
    let changed = false;
    const next = [];
    for (let i = 0; i < list.length; i += 1) {
      const s = list[i];
      if (!s.erase && strokeHitByEraser(s, wx, wy, radius)) {
        changed = true;
        if (sess && !sess.removed.some((r) => r.id === s.id)) sess.removed.push(s);
      } else {
        next.push(s);
      }
    }
    if (changed) {
      strokesRef.current = next;
      redraw();
      forceRender((n) => n + 1);
    }
  }, [eraserWorldRadius, redraw]);

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
      if (eraserMode === 'object') {
        // Objekt-Radierer: ganze Striche löschen, Session sammelt die Objekte.
        eraserSessionRef.current = { mode: 'object', removed: [], lastWorld: world };
        eraseObjectsAt(world.x, world.y);
      } else {
        // Pixel-Radierer: wie ein Strich, aber mit erase-Flag (destination-out).
        // Welt-Breite = Screen-Größe / scale → auf dem Bildschirm = Cursor-Kreis.
        drawingRef.current = {
          id: makeId(),
          color: '#000000',
          size: Math.max(1, Number(eraserSize) / scaleRef.current),
          erase: true,
          points: [world],
        };
      }
      return;
    }

    // Pen: neuen Stroke beginnen
    drawingRef.current = {
      id: makeId(),
      color,
      size,
      points: [world],
    };
  }, [tool, color, size, eraserMode, eraserSize, screenToWorld, eraseObjectsAt]);

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

    // Objekt-Radierer-Drag: mit Zwischenpunkten, damit schnelle Bewegungen
    // keine Striche überspringen.
    if (tool === 'eraser' && eraserMode === 'object' && eraserSessionRef.current) {
      const world = screenToWorld(e.clientX, e.clientY);
      const last = eraserSessionRef.current.lastWorld;
      if (last) {
        const dx = world.x - last.x, dy = world.y - last.y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        const step = Math.max(1, eraserWorldRadius() * 0.6);
        const steps = Math.max(1, Math.floor(dist / step));
        for (let i = 1; i <= steps; i += 1) {
          const t = i / steps;
          eraseObjectsAt(last.x + dx * t, last.y + dy * t);
        }
      } else {
        eraseObjectsAt(world.x, world.y);
      }
      eraserSessionRef.current.lastWorld = world;
      return;
    }

    // Pen ODER Pixel-Radierer: Punkt an den aktuellen Stroke anhängen.
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
  }, [redraw, screenToWorld, tool, eraserMode, eraseObjectsAt, eraserWorldRadius, updateEraserCursor]);

  const onPointerUp = useCallback((e) => {
    const canvas = canvasRef.current;
    canvas?.releasePointerCapture?.(e.pointerId);
    activePointersRef.current.delete(e.pointerId);
    if (activePointersRef.current.size < 2) pinchRef.current = null;
    panGestureRef.current = null;

    // Objekt-Radierer-Session beenden: gelöschte Striche per Batch entfernen.
    if (eraserSessionRef.current) {
      const { removed } = eraserSessionRef.current;
      eraserSessionRef.current = null;
      if (removed && removed.length > 0) {
        pushHistory({ type: 'remove', strokes: removed });
        setSaving(true);
        Promise.all(
          removed.map((s) => api.deleteWhiteboardStroke(s.id).catch((err) => {
            console.warn('[Whiteboard] eraser delete failed:', err?.message || err);
          }))
        ).finally(() => setSaving(false));
      }
      return;
    }

    // Pen ODER Pixel-Radierer-Strich abschließen.
    if (drawingRef.current) {
      let stroke = drawingRef.current;
      drawingRef.current = null;
      // Einzel-Tap (1 Punkt): winzigen zweiten Punkt ergänzen, damit ein
      // Punkt-Klecks (bzw. Radier-Punkt) entsteht und persistiert werden kann.
      if (stroke.points.length === 1) {
        const p = stroke.points[0];
        stroke = { ...stroke, points: [p, { x: p.x + 0.1, y: p.y + 0.1 }] };
      }
      strokesRef.current = [...strokesRef.current, stroke];
      redraw();
      forceRender((n) => n + 1);
      pushHistory({ type: 'add', strokes: [stroke] });
      setSaving(true);
      api.createWhiteboardStroke({
        id: stroke.id,
        color: stroke.color,
        size: stroke.size,
        points: stroke.points,
        erase: stroke.erase === true,
      })
        .catch((err) => console.warn('[Whiteboard] create failed:', err?.message || err))
        .finally(() => setSaving(false));
    }
  }, [redraw, pushHistory]);

  // ── Clear All ────────────────────────────────────────────────────
  const handleClear = useCallback(async () => {
    if (strokesRef.current.length === 0) return;
    const ok = window.confirm('Whiteboard komplett leeren? Du kannst es mit Rückgängig wiederherstellen.');
    if (!ok) return;
    const before = strokesRef.current;
    pushHistory({ type: 'clear', strokes: before });
    strokesRef.current = [];
    redraw();
    forceRender((n) => n + 1);
    try {
      await api.clearWhiteboardStrokes();
    } catch (err) {
      console.warn('[Whiteboard] clear failed:', err?.message || err);
    }
  }, [redraw, pushHistory]);

  // ── Undo / Redo ───────────────────────────────────────────────────
  // Persistenz best-effort; Striche behalten ihre IDs, daher sind Create/
  // Delete idempotent (ON CONFLICT DO NOTHING serverseitig).
  const persistCreate = (s) => api.createWhiteboardStroke({
    id: s.id, color: s.color, size: s.size, points: s.points, erase: s.erase === true,
  }).catch((err) => console.warn('[Whiteboard] undo create failed:', err?.message || err));
  const persistDelete = (id) => api.deleteWhiteboardStroke(id)
    .catch((err) => console.warn('[Whiteboard] undo delete failed:', err?.message || err));

  const undo = useCallback(() => {
    const action = undoStackRef.current.pop();
    if (!action) return;
    const ops = [];
    if (action.type === 'add') {
      // hinzugefügte Striche wieder entfernen
      const ids = new Set(action.strokes.map((s) => s.id));
      strokesRef.current = strokesRef.current.filter((s) => !ids.has(s.id));
      action.strokes.forEach((s) => ops.push(persistDelete(s.id)));
    } else if (action.type === 'remove' || action.type === 'clear') {
      // gelöschte/geleerte Striche wiederherstellen
      const existing = new Set(strokesRef.current.map((s) => s.id));
      const restore = action.strokes.filter((s) => !existing.has(s.id));
      strokesRef.current = [...strokesRef.current, ...restore];
      restore.forEach((s) => ops.push(persistCreate(s)));
    }
    redoStackRef.current.push(action);
    setHistTick((n) => n + 1);
    redraw();
    forceRender((n) => n + 1);
    if (ops.length) { setSaving(true); Promise.all(ops).finally(() => setSaving(false)); }
  }, [redraw]);

  const redo = useCallback(() => {
    const action = redoStackRef.current.pop();
    if (!action) return;
    const ops = [];
    if (action.type === 'add') {
      const existing = new Set(strokesRef.current.map((s) => s.id));
      const re = action.strokes.filter((s) => !existing.has(s.id));
      strokesRef.current = [...strokesRef.current, ...re];
      re.forEach((s) => ops.push(persistCreate(s)));
    } else if (action.type === 'remove' || action.type === 'clear') {
      const ids = new Set(action.strokes.map((s) => s.id));
      strokesRef.current = strokesRef.current.filter((s) => !ids.has(s.id));
      action.strokes.forEach((s) => ops.push(persistDelete(s.id)));
    }
    undoStackRef.current.push(action);
    setHistTick((n) => n + 1);
    redraw();
    forceRender((n) => n + 1);
    if (ops.length) { setSaving(true); Promise.all(ops).finally(() => setSaving(false)); }
  }, [redraw]);

  // Tastatur: Ctrl/Cmd+Z = Rückgängig, Ctrl/Cmd+Shift+Z bzw. Ctrl+Y = Wiederholen.
  useEffect(() => {
    const onKey = (e) => {
      const mod = e.metaKey || e.ctrlKey;
      if (!mod) return;
      const k = e.key.toLowerCase();
      if (k === 'z') {
        e.preventDefault();
        if (e.shiftKey) redo(); else undo();
      } else if (k === 'y') {
        e.preventDefault();
        redo();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [undo, redo]);

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
    // Bounding-Box nur aus sichtbarer Tinte (Radierer-Striche zählen nicht).
    const inkStrokes = strokes.filter((s) => !s.erase);
    let minX, minY, maxX, maxY;
    if (inkStrokes.length === 0) {
      minX = 0; minY = 0; maxX = 800; maxY = 600;
    } else {
      minX = Infinity; minY = Infinity; maxX = -Infinity; maxY = -Infinity;
      for (const s of inkStrokes) {
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

    // Tinte auf eigener transparenter Ebene (Radierer via destination-out),
    // danach über den Hintergrund kopieren — sonst würde der Radierer auch
    // den Hintergrund "durchlöchern".
    const ink = document.createElement('canvas');
    ink.width = ex.width;
    ink.height = ex.height;
    const ictx = ink.getContext('2d');
    ictx.scale(dpr, dpr);
    ictx.translate(-minX, -minY);
    ictx.lineCap = 'round';
    ictx.lineJoin = 'round';
    for (const s of strokes) {
      if (!s.points || s.points.length < 2) continue;
      if (s.erase) {
        ictx.globalCompositeOperation = 'destination-out';
        ictx.strokeStyle = 'rgba(0,0,0,1)';
      } else {
        ictx.globalCompositeOperation = 'source-over';
        ictx.strokeStyle = s.color || '#1f2937';
      }
      ictx.lineWidth = Number(s.size) || 3;
      ictx.beginPath();
      ictx.moveTo(s.points[0].x, s.points[0].y);
      for (let i = 1; i < s.points.length; i += 1) {
        ictx.lineTo(s.points[i].x, s.points[i].y);
      }
      ictx.stroke();
    }
    ictx.globalCompositeOperation = 'source-over';
    // Ink-Layer (Device-Pixel) unskaliert über den Hintergrund legen.
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.drawImage(ink, 0, 0);

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
                data-color={c}
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
            <button
              className="wb-btn"
              onClick={undo}
              disabled={undoStackRef.current.length === 0}
              title="Rückgängig (Strg/⌘+Z)"
              aria-label="Rückgängig"
            >
              <Undo2 size={16} />
            </button>
            <button
              className="wb-btn"
              onClick={redo}
              disabled={redoStackRef.current.length === 0}
              title="Wiederholen (Strg/⌘+Umschalt+Z)"
              aria-label="Wiederholen"
            >
              <Redo2 size={16} />
            </button>
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
        {/* Hintergrund-Layer (Fill + Raster) — Tinte liegt darüber, der
            Radierer macht die Tinte transparent und lässt dies durchscheinen. */}
        <canvas
          ref={bgCanvasRef}
          className="wb-canvas wb-canvas-bg"
          aria-hidden="true"
          style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}
        />
        <canvas
          ref={canvasRef}
          className="wb-canvas"
          style={{ cursor, touchAction: 'none', position: 'relative' }}
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
