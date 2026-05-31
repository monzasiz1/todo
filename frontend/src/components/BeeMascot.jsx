/**
 * BeeMascot — niedlicher polierter Bee im BeeQu-Branding.
 *
 * Design-Inspiration: Spond / Headspace / Duolingo — runder Body,
 * grosse glaenzende Augen, kleines Laecheln, weiche Gradients, leicht
 * transluzente Fluegel mit Highlight.
 *
 * Props:
 *   size      — Pixelgroesse (default 56)
 *   variant   — "blue" | "purple" | "gold"  (default "blue")
 *   pose      — "idle" | "happy" | "wink"   (default "happy")
 *   className — fuer Positionierung von aussen
 */
export default function BeeMascot({
  size = 56,
  variant = 'blue',
  pose = 'happy',
  className = '',
  style,
}) {
  // Eindeutige IDs pro Render, damit mehrere Bees auf einer Seite
  // sich nicht gegenseitig die SVG-Gradients ueberschreiben.
  const uid = Math.random().toString(36).slice(2, 9);

  const STRIPE = {
    blue:   { dark: '#0A66CC', mid: '#2D86E5', light: '#5BA8F4' },
    purple: { dark: '#4338CA', mid: '#6366F1', light: '#8B85F5' },
    gold:   { dark: '#C28200', mid: '#F0B429', light: '#FBD060' },
  }[variant] || { dark: '#0A66CC', mid: '#2D86E5', light: '#5BA8F4' };

  const CHEEK = variant === 'gold' ? '#FF8FA3' : '#FFB3C1';

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 100 100"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      style={style}
      aria-hidden="true"
      role="presentation"
    >
      <defs>
        {/* Body-Gradient — warm-weiss mit subtiler 3D-Plastik-Anmutung */}
        <radialGradient id={`bodyGrad-${uid}`} cx="40%" cy="35%" r="75%">
          <stop offset="0%"   stopColor="#FFFFFF" />
          <stop offset="60%"  stopColor="#FAFAFC" />
          <stop offset="100%" stopColor="#E8EBF2" />
        </radialGradient>

        {/* Kopf-Gradient (etwas heller, eigener Highlight-Punkt) */}
        <radialGradient id={`headGrad-${uid}`} cx="38%" cy="32%" r="70%">
          <stop offset="0%"   stopColor="#FFFFFF" />
          <stop offset="65%"  stopColor="#F8FAFD" />
          <stop offset="100%" stopColor="#E4E8F1" />
        </radialGradient>

        {/* Streifen-Gradient — Brand-Farbe mit Tiefe */}
        <linearGradient id={`stripeGrad-${uid}`} x1="0%" y1="0%" x2="0%" y2="100%">
          <stop offset="0%"   stopColor={STRIPE.light} />
          <stop offset="60%"  stopColor={STRIPE.mid} />
          <stop offset="100%" stopColor={STRIPE.dark} />
        </linearGradient>

        {/* Fluegel-Gradient — leicht irisierend */}
        <radialGradient id={`wingGrad-${uid}`} cx="35%" cy="35%" r="80%">
          <stop offset="0%"   stopColor="rgba(255,255,255,0.95)" />
          <stop offset="50%"  stopColor="rgba(230,240,255,0.65)" />
          <stop offset="100%" stopColor="rgba(180,200,230,0.35)" />
        </radialGradient>
      </defs>

      {/* Schatten unter der Biene */}
      <ellipse cx="50" cy="92" rx="22" ry="3.5" fill="rgba(0,0,0,0.18)" />

      {/* ── Fluegel (hinter dem Body) ── */}
      <g>
        <ellipse cx="28" cy="32" rx="16" ry="11"
                 fill={`url(#wingGrad-${uid})`}
                 stroke="rgba(255,255,255,0.6)" strokeWidth="0.5"
                 transform="rotate(-30 28 32)" />
        <ellipse cx="72" cy="32" rx="16" ry="11"
                 fill={`url(#wingGrad-${uid})`}
                 stroke="rgba(255,255,255,0.6)" strokeWidth="0.5"
                 transform="rotate(30 72 32)" />
        {/* Fluegel-Highlights */}
        <ellipse cx="22" cy="28" rx="4" ry="2"
                 fill="rgba(255,255,255,0.7)"
                 transform="rotate(-30 22 28)" />
        <ellipse cx="78" cy="28" rx="4" ry="2"
                 fill="rgba(255,255,255,0.7)"
                 transform="rotate(30 78 28)" />
      </g>

      {/* ── Body (rundlich, plastisch) ── */}
      <ellipse cx="50" cy="62" rx="22" ry="24" fill={`url(#bodyGrad-${uid})`} />

      {/* Streifen — folgen der Body-Kruemmung */}
      <g>
        <ellipse cx="50" cy="54" rx="20" ry="3.2" fill={`url(#stripeGrad-${uid})`} />
        <ellipse cx="50" cy="65" rx="21" ry="3.2" fill={`url(#stripeGrad-${uid})`} />
        <ellipse cx="50" cy="76" rx="18" ry="2.8" fill={`url(#stripeGrad-${uid})`} opacity="0.85" />
      </g>

      {/* Body-Outline subtil */}
      <ellipse cx="50" cy="62" rx="22" ry="24" fill="none"
               stroke="rgba(70,80,100,0.12)" strokeWidth="0.6" />

      {/* ── Kopf ── */}
      <circle cx="50" cy="32" r="16" fill={`url(#headGrad-${uid})`} />
      <circle cx="50" cy="32" r="16" fill="none"
              stroke="rgba(70,80,100,0.12)" strokeWidth="0.6" />

      {/* Antennen */}
      <g>
        <path d="M42 18 Q39 12 35 11"
              stroke="#2A2D3A" strokeWidth="1.6" strokeLinecap="round" fill="none" />
        <path d="M58 18 Q61 12 65 11"
              stroke="#2A2D3A" strokeWidth="1.6" strokeLinecap="round" fill="none" />
        <circle cx="35" cy="11" r="2.2" fill={STRIPE.mid} />
        <circle cx="65" cy="11" r="2.2" fill={STRIPE.mid} />
        <circle cx="34.5" cy="10.3" r="0.7" fill="rgba(255,255,255,0.85)" />
        <circle cx="64.5" cy="10.3" r="0.7" fill="rgba(255,255,255,0.85)" />
      </g>

      {/* Wangen */}
      <ellipse cx="40" cy="36" rx="3" ry="2" fill={CHEEK} opacity="0.55" />
      <ellipse cx="60" cy="36" rx="3" ry="2" fill={CHEEK} opacity="0.55" />

      {/* ── Augen (gross + glaenzend) ── */}
      {pose === 'wink' ? (
        <>
          <circle cx="44" cy="32" r="3.5" fill="#1A1D2A" />
          <circle cx="45" cy="30.8" r="1.3" fill="#FFFFFF" />
          <path d="M52 32 Q56 30 60 32"
                stroke="#1A1D2A" strokeWidth="1.8" strokeLinecap="round" fill="none" />
        </>
      ) : (
        <>
          <circle cx="44" cy="32" r="3.5" fill="#1A1D2A" />
          <circle cx="56" cy="32" r="3.5" fill="#1A1D2A" />
          <circle cx="45" cy="30.8" r="1.3" fill="#FFFFFF" />
          <circle cx="57" cy="30.8" r="1.3" fill="#FFFFFF" />
          <circle cx="43.4" cy="33.4" r="0.5" fill="#FFFFFF" opacity="0.6" />
          <circle cx="55.4" cy="33.4" r="0.5" fill="#FFFFFF" opacity="0.6" />
        </>
      )}

      {/* ── Mund (freundliches Laecheln) ── */}
      {pose === 'idle' ? (
        <circle cx="50" cy="40" r="1" fill="#1A1D2A" />
      ) : (
        <path d="M46 39 Q50 43 54 39"
              stroke="#1A1D2A" strokeWidth="1.6" strokeLinecap="round" fill="none" />
      )}

      {/* Body-Highlight oben links (3D-Look) */}
      <ellipse cx="42" cy="50" rx="6" ry="9" fill="rgba(255,255,255,0.45)" />
    </svg>
  );
}
