import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import {
  ArrowLeft,
  ArrowRight,
  LifeBuoy,
  Download,
  Loader2,
  RefreshCw,
  CheckCircle2,
} from 'lucide-react';

// Discord-artige Custom-Titlebar fuer die Electron-Desktop-App.
// - Drag-Region (window-drag) ueber den freien Bereich
// - Back / Forward Navigation (Browser-History)
// - Aktueller Seiten-Titel basierend auf Route
// - Hilfe-Button: triggert das vorhandene HelpChat ueber CustomEvent
// - Update-Indikator: zeigt Status aus electronApp.getUpdateState() und
//   reagiert per onUpdateStateChanged. Klick fuehrt "Pruefen" oder "Installieren" aus.

const ROUTE_TITLES = [
  { match: /^\/app\/?$/, title: 'Dashboard' },
  { match: /^\/app\/calendar/, title: 'Kalender' },
  { match: /^\/app\/notes/, title: 'Notes' },
  { match: /^\/app\/groups/, title: 'Gruppen' },
  { match: /^\/app\/profile/, title: 'Profil' },
  { match: /^\/app\/pricing/, title: 'Pro' },
  { match: /^\/app\/tasks\//, title: 'Aufgabe' },
  { match: /^\/app\/chat/, title: 'Chat' },
  { match: /^\/app\/login/, title: 'Anmelden' },
];

function getTitleForPath(pathname) {
  const entry = ROUTE_TITLES.find((r) => r.match.test(pathname));
  return entry ? entry.title : 'BeeQu';
}

export default function DesktopTitleBar() {
  const location = useLocation();
  const navigate = useNavigate();
  const isElectron =
    typeof window !== 'undefined' &&
    !!window.electronApp &&
    typeof window.electronApp.getUpdateState === 'function';

  const [historyState, setHistoryState] = useState({ canBack: false, canForward: false });
  const [update, setUpdate] = useState({ state: 'idle', progress: 0, version: '' });
  const [busy, setBusy] = useState(false);

  // History-Status (rein clientseitig - es gibt keine API fuer canGoForward,
  // wir verfolgen das selbst ueber popstate/length).
  useEffect(() => {
    if (!isElectron) return undefined;
    const update = () => {
      // length nimmt zu wenn man navigiert; back ist immer moeglich wenn length > 1
      setHistoryState((prev) => ({
        canBack: window.history.length > 1,
        // forward koennen wir nicht zuverlaessig ermitteln - bleibt heuristisch
        canForward: prev.canForward,
      }));
    };
    update();
    window.addEventListener('popstate', update);
    return () => window.removeEventListener('popstate', update);
  }, [isElectron]);

  // Aktuellen Update-Status laden + abonnieren
  useEffect(() => {
    if (!isElectron) return undefined;
    let alive = true;
    window.electronApp.getUpdateState().then((s) => {
      if (alive && s) setUpdate((prev) => ({ ...prev, ...s }));
    }).catch(() => {});
    const off = window.electronApp.onUpdateStateChanged?.((data) => {
      if (alive && data) setUpdate((prev) => ({ ...prev, ...data }));
    });
    return () => {
      alive = false;
      if (typeof off === 'function') off();
    };
  }, [isElectron]);

  const title = useMemo(() => getTitleForPath(location.pathname), [location.pathname]);

  const handleBack = useCallback(() => {
    if (window.history.length > 1) {
      navigate(-1);
      setHistoryState((p) => ({ ...p, canForward: true }));
    }
  }, [navigate]);

  const handleForward = useCallback(() => {
    navigate(1);
  }, [navigate]);

  const handleHelp = useCallback(() => {
    try {
      window.dispatchEvent(new Event('open-help-chat'));
    } catch {}
  }, []);

  const handleUpdateClick = useCallback(async () => {
    if (busy) return;
    setBusy(true);
    try {
      // installUpdate erledigt jetzt alles in einem Rutsch:
      // pruefen → downloaden → installieren → neustarten.
      // Der State 'downloading' wird kurz angezeigt und endet im automatischen
      // Restart sobald der Download fertig ist.
      await window.electronApp.installUpdate?.();
    } finally {
      setBusy(false);
    }
  }, [busy]);

  if (!isElectron) return null;

  // Bezeichnung + Optik fuer Update-Badge
  const renderUpdateBadge = () => {
    const baseClass = 'desktop-titlebar-update';
    if (update.state === 'ready') {
      return (
        <button
          className={`${baseClass} is-ready`}
          onClick={handleUpdateClick}
          title="Update bereit - jetzt neu starten"
        >
          <CheckCircle2 size={14} />
          <span>Update bereit</span>
        </button>
      );
    }
    if (update.state === 'downloading') {
      return (
        <button
          className={`${baseClass} is-progress`}
          onClick={handleUpdateClick}
          title={`Update wird heruntergeladen (${update.progress || 0}%)`}
        >
          <Loader2 size={14} className="desktop-titlebar-spin" />
          <span>{`Update ${update.progress || 0}%`}</span>
        </button>
      );
    }
    if (update.state === 'available') {
      return (
        <button
          className={`${baseClass} is-available`}
          onClick={handleUpdateClick}
          title="Update verfuegbar"
        >
          <Download size={14} />
          <span>Update verfuegbar</span>
        </button>
      );
    }
    if (update.state === 'checking') {
      return (
        <button className={`${baseClass} is-checking`} disabled>
          <Loader2 size={14} className="desktop-titlebar-spin" />
          <span>Pruefe...</span>
        </button>
      );
    }
    // idle / none / error → kleiner Refresh-Button (manueller Check)
    return (
      <button
        className={`${baseClass} is-idle`}
        onClick={handleUpdateClick}
        title="Nach Updates suchen"
      >
        <RefreshCw size={14} />
      </button>
    );
  };

  return (
    <div className="desktop-titlebar" role="banner">
      <div className="desktop-titlebar-left">
        <button
          className="desktop-titlebar-navbtn"
          onClick={handleBack}
          disabled={!historyState.canBack}
          title="Zurueck"
          aria-label="Zurueck"
        >
          <ArrowLeft size={16} />
        </button>
        <button
          className="desktop-titlebar-navbtn"
          onClick={handleForward}
          title="Vor"
          aria-label="Vor"
        >
          <ArrowRight size={16} />
        </button>
        <span className="desktop-titlebar-title">{title}</span>
      </div>

      <div className="desktop-titlebar-right">
        {renderUpdateBadge()}
        <button
          className="desktop-titlebar-iconbtn"
          onClick={handleHelp}
          title="BeeQu Hilfecenter"
          aria-label="BeeQu Hilfecenter"
        >
          <LifeBuoy size={15} />
          <span className="desktop-titlebar-iconbtn-label">Hilfecenter</span>
        </button>
      </div>
    </div>
  );
}
