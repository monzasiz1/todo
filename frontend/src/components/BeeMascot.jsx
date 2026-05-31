/**
 * BeeMascot — kleine animierte Biene im BeeQu-Branding.
 *
 * Brand-Code:
 *   - Body / Kopf / Fluegel: warmes Weiss (#FFFFFF)
 *   - Streifen: Brand-Blau (#007AFF) bzw. Brand-Lila (#5856D6) ueber Variante
 *   - Optional: Goldakzent fuer "Premium"-Look (variant="gold")
 *
 * Props:
 *   size      — Pixelgroesse (default 36)
 *   variant   — "blue" | "purple" | "gold"  (default "blue")
 *   className — fuer Positionierung von aussen (motion-Wrapper, top/left etc.)
 */
export default function BeeMascot({ size = 36, variant = 'blue', className = '', style }) {
  const STRIPE = {
    blue:   '#007AFF',
    purple: '#5856D6',
    gold:   '#F0B429',
  }[variant] || '#007AFF';

  // Body warm-weiss, Brand-Touch
  const BODY = '#FFFFFF';

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 64 64"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      style={style}
      aria-hidden="true"
      role="presentation"
    >
      {/* Sanfter Schatten unter der Biene */}
      <ellipse cx="32" cy="58" rx="14" ry="2.4" fill="rgba(0,0,0,0.18)" />

      {/* Fluegel */}
      <g>
        <ellipse cx="22" cy="22" rx="11" ry="6"
                 fill={BODY} opacity="0.86"
                 transform="rotate(-28 22 22)" />
        <ellipse cx="42" cy="20" rx="11" ry="6"
                 fill={BODY} opacity="0.86"
                 transform="rotate(28 42 20)" />
      </g>

      {/* Koerper */}
      <ellipse cx="32" cy="40" rx="13" ry="16" fill={BODY} />

      {/* Streifen (Brand-Farbe, leicht transparent fuer iOS-Soft-Touch) */}
      <rect x="20" y="32" width="24" height="4.2" rx="2.1" fill={STRIPE} opacity="0.55" />
      <rect x="20" y="40" width="24" height="4.2" rx="2.1" fill={STRIPE} opacity="0.55" />
      <rect x="20" y="48" width="24" height="4.2" rx="2.1" fill={STRIPE} opacity="0.45" />

      {/* Kopf */}
      <circle cx="32" cy="22" r="8.5" fill={BODY} />

      {/* Augen */}
      <circle cx="29.2" cy="22" r="1.3" fill="#0A0A0F" />
      <circle cx="34.8" cy="22" r="1.3" fill="#0A0A0F" />

      {/* Antennen */}
      <path d="M28 14 Q26 10 24 9"
            stroke="#0A0A0F" strokeWidth="1.2" strokeLinecap="round" fill="none" />
      <path d="M36 14 Q38 10 40 9"
            stroke="#0A0A0F" strokeWidth="1.2" strokeLinecap="round" fill="none" />
      <circle cx="24" cy="9" r="1.4" fill={STRIPE} />
      <circle cx="40" cy="9" r="1.4" fill={STRIPE} />
    </svg>
  );
}
