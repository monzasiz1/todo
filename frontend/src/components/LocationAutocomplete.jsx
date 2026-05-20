import { useEffect, useRef, useState, useCallback } from 'react';
import { MapPin, ExternalLink, Loader2 } from 'lucide-react';

// ─────────────────────────────────────────────────────────────────────────
// LocationAutocomplete
// ─────────────────────────────────────────────────────────────────────────
// Text-Eingabe fuer Adresse mit Live-Vorschlaegen aus OpenStreetMap
// Nominatim (kostenlos, kein API-Key). Vorschlaege erscheinen als kleines
// Dropdown unterhalb des Inputs.
//
// Hinweise:
//   • Nominatim erlaubt max ~1 req/s pro Client. Wir debouncen 350ms.
//   • Mindestens 3 Zeichen, sonst kein Request.
//   • Falls der Browser offline ist oder Nominatim 429/5xx liefert,
//     verhalten wir uns wie ein normaler Input (Vorschlaege bleiben leer).
//   • Klick auf Vorschlag schreibt nur den display_name in den State —
//     keine Lat/Lng-Speicherung (Backend kennt nur tasks.location TEXT).
// ─────────────────────────────────────────────────────────────────────────

const NOMINATIM_URL = 'https://nominatim.openstreetmap.org/search';

async function fetchSuggestions(query, { signal, lang = 'de' } = {}) {
  const url = `${NOMINATIM_URL}?format=json&addressdetails=1&limit=6&accept-language=${encodeURIComponent(lang)}&q=${encodeURIComponent(query)}`;
  const res = await fetch(url, {
    signal,
    headers: {
      // Nominatim verlangt einen Referer ODER User-Agent. Browser setzt
      // beides automatisch — wir setzen keine zusaetzlichen Header, um
      // keinen CORS-Preflight auszuloesen.
      Accept: 'application/json',
    },
  });
  if (!res.ok) throw new Error(`Nominatim ${res.status}`);
  const data = await res.json();
  return Array.isArray(data) ? data : [];
}

function formatSuggestion(item) {
  // Kompakter Anzeigetext: "Strasse Hausnummer, PLZ Ort, Land"
  const a = item.address || {};
  const street = [a.road, a.house_number].filter(Boolean).join(' ');
  const cityLine = [a.postcode, a.city || a.town || a.village || a.municipality].filter(Boolean).join(' ');
  const country = a.country;
  const parts = [street || a.amenity || a.neighbourhood, cityLine, country].filter(Boolean);
  if (parts.length === 0) return item.display_name;
  return parts.join(', ');
}

export default function LocationAutocomplete({
  value,
  onChange,
  placeholder = 'Adresse, Café, Park...',
  className = '',
  inputClassName = '',
  showOpenButton = true,
}) {
  const [suggestions, setSuggestions] = useState([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [activeIdx, setActiveIdx] = useState(-1);

  const wrapRef = useRef(null);
  const abortRef = useRef(null);
  const debounceRef = useRef(null);
  // Verhindert direktes Re-Suchen nachdem User einen Vorschlag ausgewaehlt hat.
  const suppressNextSearchRef = useRef(false);

  // Debounce + Suche
  useEffect(() => {
    if (suppressNextSearchRef.current) {
      suppressNextSearchRef.current = false;
      return;
    }
    if (debounceRef.current) clearTimeout(debounceRef.current);

    const q = (value || '').trim();
    if (q.length < 3) {
      setSuggestions([]);
      setLoading(false);
      return;
    }

    debounceRef.current = setTimeout(async () => {
      if (abortRef.current) {
        try { abortRef.current.abort(); } catch { /* ignore */ }
      }
      const ctrl = new AbortController();
      abortRef.current = ctrl;
      setLoading(true);
      try {
        const items = await fetchSuggestions(q, { signal: ctrl.signal });
        setSuggestions(items);
        setActiveIdx(-1);
        setOpen(true);
      } catch (err) {
        if (err.name !== 'AbortError') {
          // Stillschweigend: kein Toast, weil das nur ein Convenience-Feature ist.
          setSuggestions([]);
        }
      } finally {
        setLoading(false);
      }
    }, 350);

    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [value]);

  // Aufraeumen beim Unmount
  useEffect(() => () => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (abortRef.current) {
      try { abortRef.current.abort(); } catch { /* ignore */ }
    }
  }, []);

  // Outside-Click schliesst die Liste
  useEffect(() => {
    if (!open) return undefined;
    const onDocClick = (e) => {
      if (!wrapRef.current) return;
      if (!wrapRef.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, [open]);

  const pickSuggestion = useCallback((item) => {
    const text = formatSuggestion(item);
    suppressNextSearchRef.current = true;
    onChange?.(text);
    setOpen(false);
    setSuggestions([]);
  }, [onChange]);

  const onKeyDown = (e) => {
    if (!open || suggestions.length === 0) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActiveIdx((i) => Math.min(i + 1, suggestions.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActiveIdx((i) => Math.max(i - 1, 0));
    } else if (e.key === 'Enter' && activeIdx >= 0) {
      e.preventDefault();
      pickSuggestion(suggestions[activeIdx]);
    } else if (e.key === 'Escape') {
      setOpen(false);
    }
  };

  const trimmed = (value || '').trim();

  return (
    <div className={`task-edit-location-wrap ${className}`} ref={wrapRef}>
      <div className="task-edit-location-row">
        <div className="task-edit-location-input-wrap">
          <input
            type="text"
            value={value || ''}
            onChange={(e) => onChange?.(e.target.value)}
            onFocus={() => { if (suggestions.length > 0) setOpen(true); }}
            onKeyDown={onKeyDown}
            placeholder={placeholder}
            className={`task-edit-input task-edit-location-input ${inputClassName}`}
            autoComplete="off"
            spellCheck={false}
          />
          {loading && (
            <span className="task-edit-location-loading" aria-hidden="true">
              <Loader2 size={14} className="task-edit-location-spin" />
            </span>
          )}
        </div>
        {showOpenButton && trimmed && (
          <a
            href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(trimmed)}`}
            target="_blank"
            rel="noopener noreferrer"
            className="task-edit-location-preview-btn"
            title="In Google Maps öffnen"
          >
            <ExternalLink size={14} />
          </a>
        )}
      </div>

      {open && suggestions.length > 0 && (
        <ul className="task-edit-location-dropdown" role="listbox">
          {suggestions.map((item, idx) => (
            <li
              key={item.place_id || `${item.lat}-${item.lon}-${idx}`}
              role="option"
              aria-selected={idx === activeIdx}
              className={`task-edit-location-option ${idx === activeIdx ? 'is-active' : ''}`}
              // onMouseDown statt onClick, damit der Input nicht vorher
              // den Blur-Outside-Click ausloest und die Liste schliesst.
              onMouseDown={(e) => { e.preventDefault(); pickSuggestion(item); }}
              onMouseEnter={() => setActiveIdx(idx)}
            >
              <MapPin size={13} className="task-edit-location-option-icon" />
              <div className="task-edit-location-option-text">
                {formatSuggestion(item)}
              </div>
            </li>
          ))}
        </ul>
      )}

      {trimmed && (
        <div className="task-edit-location-hint">
          <MapPin size={11} /> Wird in den Aufgaben-Details als Karte angezeigt.
        </div>
      )}
    </div>
  );
}
