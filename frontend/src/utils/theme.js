/**
 * Theme Utility — verwaltet light/dark/system Modus.
 * Persistiert in localStorage unter `beequ:theme`.
 *
 * Werte:
 *   - 'light'  → erzwingt helles Theme
 *   - 'dark'   → erzwingt dunkles Theme
 *   - 'system' → folgt prefers-color-scheme
 */

const STORAGE_KEY = 'beequ:theme';
const MQ = typeof window !== 'undefined' && window.matchMedia
  ? window.matchMedia('(prefers-color-scheme: dark)')
  : null;

let listeners = new Set();
let systemListenerAttached = false;

export function getStoredTheme() {
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    if (v === 'light' || v === 'dark' || v === 'system') return v;
  } catch {}
  return 'system';
}

export function getEffectiveTheme(stored = getStoredTheme()) {
  if (stored === 'system') {
    return MQ && MQ.matches ? 'dark' : 'light';
  }
  return stored;
}

function apply(stored) {
  if (typeof document === 'undefined') return;
  const effective = getEffectiveTheme(stored);
  const root = document.documentElement;
  root.setAttribute('data-theme', effective);
  // Falls jemand prefers-color-scheme spielen will, signalisieren:
  root.style.colorScheme = effective;
}

function attachSystemListener() {
  if (systemListenerAttached || !MQ) return;
  systemListenerAttached = true;
  const handler = () => {
    if (getStoredTheme() === 'system') {
      apply('system');
      listeners.forEach((cb) => {
        try { cb(getStoredTheme()); } catch {}
      });
    }
  };
  if (typeof MQ.addEventListener === 'function') {
    MQ.addEventListener('change', handler);
  } else if (typeof MQ.addListener === 'function') {
    MQ.addListener(handler);
  }
}

export function setTheme(value) {
  if (value !== 'light' && value !== 'dark' && value !== 'system') return;
  try { localStorage.setItem(STORAGE_KEY, value); } catch {}
  apply(value);
  listeners.forEach((cb) => {
    try { cb(value); } catch {}
  });
}

export function subscribeTheme(cb) {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

/**
 * Wird so früh wie möglich in main.jsx aufgerufen, um FOUC zu vermeiden.
 */
export function initTheme() {
  const stored = getStoredTheme();
  apply(stored);
  attachSystemListener();
}
