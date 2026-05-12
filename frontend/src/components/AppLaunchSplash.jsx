import React from 'react';

export default function AppLaunchSplash({ visible }) {
  return (
    <div className={`launch-splash ${visible ? 'is-visible' : 'is-hidden'}`} aria-hidden={!visible}>
      {/* Background */}
      <div className="lsp-bg" />
      <div className="lsp-orb lsp-orb-1" />
      <div className="lsp-orb lsp-orb-2" />
      <div className="lsp-orb lsp-orb-3" />

      {/* Particles */}
      <div className="lsp-particles" aria-hidden="true">
        <span /><span /><span /><span /><span /><span />
        <span /><span /><span /><span /><span /><span />
      </div>

      {/* Floating feature chips */}
      <div className="lsp-floats" aria-hidden="true">
        <div className="lsp-float lf-1">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round">
            <rect x="3.5" y="5" width="17" height="15" rx="3" />
            <path d="M7 3v4M17 3v4M3.5 9h17" />
            <path d="M8 13h2.5M13.5 13h2M8 16.5h2.5" />
          </svg>
          <span>Kalender</span>
        </div>
        <div className="lsp-float lf-2">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round">
            <rect x="5" y="4" width="14" height="16" rx="3" />
            <path d="M8 9h8M8 12.5h8M8 16h5" />
          </svg>
          <span>Notizen</span>
        </div>
        <div className="lsp-float lf-3">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
            <rect x="4" y="4" width="16" height="16" rx="4" />
            <path d="M9 12l2 2 4-4" />
          </svg>
          <span>Aufgaben</span>
        </div>
        <div className="lsp-float lf-4">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round">
            <circle cx="12" cy="12" r="9" />
            <path d="M12 7v5l3 3" />
          </svg>
          <span>Pläne</span>
        </div>
      </div>

      {/* Center content */}
      <div className="lsp-center" role="status" aria-live="polite">
        <div className="lsp-logo-stage" aria-hidden="true">
          <span className="lsp-ring lsp-ring-1" />
          <span className="lsp-ring lsp-ring-2" />
          <span className="lsp-ring lsp-ring-3" />
          <span className="lsp-glow-disc" />
          <div className="lsp-logo-box">
            <svg className="lsp-trace" viewBox="0 0 100 100" aria-hidden="true" focusable="false">
              <rect className="lsp-trace-base" x="3" y="3" width="94" height="94" rx="24" />
              <rect className="lsp-trace-run"  x="3" y="3" width="94" height="94" rx="24" pathLength="100" />
              <rect className="lsp-trace-dot"  x="3" y="3" width="94" height="94" rx="24" pathLength="100" />
            </svg>
            <img src="/icons/icon.png" alt="BeeQu" className="lsp-logo-img" />
          </div>
        </div>

        <h1 className="lsp-title">BeeQu</h1>
        <p className="lsp-sub">Dein Planer wird vorbereitet …</p>

        <div className="lsp-loader" aria-hidden="true">
          <span /><span /><span />
        </div>
      </div>
    </div>
  );
}
