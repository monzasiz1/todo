import { Component } from 'react';
import { isChunkLoadError, recoverFromBrokenCache } from '../utils/recover';

// Fängt Render-/Laufzeitfehler ab und zeigt statt einer weißen Seite einen
// Wiederherstellen-Screen. Chunk-Lade-Fehler (typisch nach einem Deploy)
// lösen automatisch eine Cache-Bereinigung + Reload aus.
export default class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  componentDidCatch(error) {
    if (isChunkLoadError(error)) {
      // Veralteter Chunk → automatisch zurücksetzen und neu laden.
      recoverFromBrokenCache('errorBoundary:chunk');
      return;
    }
    // eslint-disable-next-line no-console
    console.error('[ErrorBoundary]', error);
  }

  handleReload = () => {
    recoverFromBrokenCache('errorBoundary:manual');
  };

  render() {
    if (!this.state.hasError) return this.props.children;

    return (
      <div style={{
        minHeight: '100dvh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 24,
        background: '#0b1220',
        color: '#f4f7ff',
        fontFamily: "'Inter', system-ui, sans-serif",
        textAlign: 'center',
      }}>
        <div style={{ maxWidth: 360 }}>
          <div style={{ fontSize: 40, marginBottom: 12 }}>🐝</div>
          <h1 style={{ fontSize: 20, fontWeight: 700, margin: '0 0 8px' }}>
            Etwas ist schiefgelaufen
          </h1>
          <p style={{ fontSize: 14, lineHeight: 1.5, color: 'rgba(244,247,255,0.65)', margin: '0 0 20px' }}>
            Wahrscheinlich war eine veraltete Version im Zwischenspeicher.
            Tippe auf „Neu laden", dann sollte alles wieder funktionieren.
          </p>
          <button
            type="button"
            onClick={this.handleReload}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 8,
              padding: '12px 22px',
              border: 'none',
              borderRadius: 12,
              background: 'linear-gradient(120deg, #007aff, #5856d6)',
              color: '#fff',
              fontSize: 15,
              fontWeight: 600,
              cursor: 'pointer',
            }}
          >
            Neu laden
          </button>
        </div>
      </div>
    );
  }
}
