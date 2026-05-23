// Whiteboard - Pan/Zoom Canvas mit Pen/Eraser/Text + persistenten Strokes.
//
// Architektur:
// - Ein einziges <canvas>-Element fuer die gerenderten Strokes. Wir
//   speichern die Strokes als JS-Array (id, color, size, points[])
//   und rendern bei jedem Pan/Zoom neu (canvas.clearRect + redraw).
// - Aktuell waehrend des Zeichnens entsteht der Stroke imperativ
//   (kein State-Update pro Punkt, sonst rendert React staendig). Erst
//   bei Pointer-Up wird der Stroke in den State gepusht und an die
//   API gesendet.
// - Pan: ALT-Drag oder Touch mit 2 Fingern (Pinch dazu fuer Zoom).
//   Linkes Maustaste in pen/eraser-Mode zeichnet/loescht.
// - Eraser: erkennt den ersten Stroke unter dem Cursor (Hit-Test in
//   World-Coords) und loescht ihn.
// - Coords: wir trennen sauber zwischen Screen-Pixel (Pointer-Event)
//   und World-Pixel (gespeicherter Punkt). screenToWorld nutzt
//   panRef + scaleRef.

import { useEffect, useRef, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  ArrowLeft, Pencil, Eraser, Hand, Trash2, ZoomIn, ZoomOut, Type, Save,
} from 'lucide-react';
import { api } from '../utils/api';

const PEN_COLORS = ['#1f2937', '#ef4444', '#f59e0b', '#10b981', '#3b82f6', '#a855f7'];
const PEN_SIZES = [2, 4, 8, 14];
const MIN_SCALE = 0.2;
const MAX_SCALE = 4;

function makeId() {
  return `s_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

// Punkt-zu-Segment-Distanz fuer Eraser-Hit-Test.
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

// Pixel-genauer Radierer: zerteilt einen Stroke an Stellen, an denen
// der Eraser-Pfad ihn beruehrt — gibt 0..n Sub-Strokes zurueck.
// Originaler Stroke wird *nicht* mutiert.
function splitStrokeByEraser(stroke, ex, ey, eraseRadius) {
  const halfPenWidth = (Number(stroke.size) || 3) / 2;
  const tol = eraseRadius + halfPenWidth;
  const tol2 = tol * tol;
  const pts = stroke.points || [];

  // Schneller Bounds-Reject
  const b = strokeBounds(stroke);
  if (ex + tol < b.minX || ex - tol > b.maxX || ey + tol < b.minY || ey - tol > b.maxY) {
    return { changed: false, parts: [stroke] };
  }

  if (pts.length <= 1) {
    if (pts.length === 1) {
      const dx = pts[0].x - ex, dy = pts[0].y - ey;
      if (dx * dx + dy * dy < tol2) return { changed: true, parts: [] };
    }
    return { changed: false, parts: [stroke] };
  }

  // Markiere Punkte/Segmente, die im Eraser-Radius liegen
  const ranges = [];
  let current = [];
  for (let i = 0; i < pts.length; i += 1) {
    const p = pts[i];
    const dpx = p.x - ex, dpy = p.y - ey;
    let hit = (dpx * dpx + dpy * dpy) < tol2;
    if (!hit && i > 0) {
      const a = pts[i - 1];
      if (distPointSegment(ex, ey, a.x, a.y, p.x, p.y) < tol) hit = true;
    }
    if (hit) {
      if (current.length >= 2) ranges.push(current);
      current = [];
    } else {
      current.push(p);
    }
  }
  if (current.length >= 2) ranges.push(current);

  // Keine Aenderung wenn der einzige Range alle Punkte enthaelt
  if (ranges.length === 1 && ranges[0].length === pts.length) {
    return { changed: false, parts: [stroke] };
  }

  // Neue Sub-Strokes aus den ueberlebenden Ranges erzeugen
  const parts = ranges.map((range) => ({
    id: `s_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
    color: stroke.color,
    size: stroke.size,
    points: range,
  }));
  return { changed: true, parts };
}

export default function WhiteboardPage() {
  const navigate = useNavigate();
  const wrapRef = useRef(null);
  const canvasRef = useRef(null);

  // Tool-State
  const [tool, setTool] = useState('pen'); // 'pen' | 'eraser' | 'pan'
  const [color, setColor] = useState(PEN_COLORS[0]);
  const [size, setSize] = useState(4);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  // Strokes-Store (gerendert auf canvas)
  const strokesRef = useRef([]); // {id, color, size, points: [{x,y}, ...]}
  const [, forceRender] = useState(0); // nur um Toolbar/Counter zu refreshen

  // Pan/Zoom
  const panRef = useRef({ x: 0, y: 0 });
  const scaleRef = useRef(1);
  const [scaleUi, setScaleUi] = useState(1); // nur fuer Anzeige

  // Aktuell gezeichneter Stroke (waehrend Pointer-Down)
  const drawingRef = useRef(null); // {id, color, size, points}
  // Aktive Pan-Geste
  const panGestureRef = useRef(null); // {startX, startY, startPanX, startPanY}
  // Multi-Touch Pinch
  const pinchRef = useRef(null); // {startDist, startScale, centerWorld}
  const activePointersRef = useRef(new Map());
  // Eraser-Session: serverseitig bekannte IDs zu Beginn der Geste, plus
  // letzte World-Position fuer Zwischenpunkt-Interpolation (smoother Eraser).
  const eraserSessionRef = useRef(null); // {startIds: Set<string>, lastWorld: {x,y}|null}

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

    // Hintergrund-Grid (subtil)
    ctx.save();
    ctx.fillStyle = '#fafafa';
    ctx.fillRect(0, 0, w, h);
    const step = 40 * scaleRef.current;
    if (step > 8) {
      ctx.strokeStyle = 'rgba(0,0,0,0.06)';
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
  }, []);

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

  // Eraser-Radius im Welt-Koordinatensystem. Skaliert mit dem aktuellen
  // `size`, aber nie unter ~10 (sonst zu fummelig auf Touch).
  const eraserWorldRadius = useCallback(() => {
    return Math.max(10, Number(size) * 3);
  }, [size]);

  // Pixel-Erase an einer Welt-Position: alle Strokes durchgehen, Treffer splitten.
  const eraseAt = useCallback((wx, wy) => {
    const radius = eraserWorldRadius();
    const list = strokesRef.current;
    let changed = false;
    const next = [];
    for (let i = 0; i < list.length; i += 1) {
      const res = splitStrokeByEraser(list[i], wx, wy, radius);
      if (res.changed) changed = true;
      for (let j = 0; j < res.parts.length; j += 1) next.push(res.parts[j]);
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
        const step = eraserWorldRadius() * 0.6; // ueberlappende Schritte
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
  }, [redraw, screenToWorld, tool, eraseAt, eraserWorldRadius]);

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
    const ok = window.confirm('Whiteboard komplett leeren? Diese Aktion kann nicht rueckgaengig gemacht werden.');
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

  const cursor = tool === 'pan' ? 'grab' : tool === 'eraser' ? 'cell' : 'crosshair';

  return (
    <div className="wb-page">
      <header className="wb-header">
        <button
          className="wb-btn-back"
          onClick={() => navigate('/app/notes')}
          title="Zurueck zu den Notizen"
          aria-label="Zurueck zu den Notizen"
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
          <div className="wb-tool-group wb-sizes" role="radiogroup" aria-label="Strichstaerke">
            {PEN_SIZES.map((s) => (
              <button
                key={s}
                type="button"
                className={`wb-size ${size === s ? 'is-active' : ''}`}
                onClick={() => setSize(s)}
                aria-pressed={size === s}
                title={`Staerke ${s}px`}
              >
                <span className="wb-size-dot" style={{ width: s + 4, height: s + 4, background: color }} />
              </button>
            ))}
          </div>
          <div className="wb-tool-group">
            <button className="wb-btn" onClick={() => zoomAt(1 / 1.2, null)} title="Verkleinern">
              <ZoomOut size={16} />
            </button>
            <button className="wb-btn wb-zoom-label" onClick={handleResetView} title="Zoom zuruecksetzen">
              {Math.round(scaleUi * 100)}%
            </button>
            <button className="wb-btn" onClick={() => zoomAt(1.2, null)} title="Vergroessern">
              <ZoomIn size={16} />
            </button>
          </div>
          <button className="wb-btn wb-btn-danger" onClick={handleClear} title="Alles loeschen">
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
        />
        {loading && (
          <div className="wb-loading">Lade Whiteboard...</div>
        )}
        {!loading && strokesRef.current.length === 0 && (
          <div className="wb-hint">
            Tipp: Stift waehlen und einfach losmalen. Pinch oder Mausrad zum Zoomen. Alt-Drag oder Hand-Modus zum Verschieben.
          </div>
        )}
      </div>
    </div>
  );
}
