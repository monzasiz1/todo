import React, { lazy, Suspense, useEffect, useState } from 'react';
import { BrowserRouter, Routes, Route, Navigate, useLocation, useNavigate } from 'react-router-dom';
import { useAuthStore } from './store/authStore';
import { useTaskStore } from './store/taskStore';
import { useRealtime } from './hooks/useRealtime';
import AppLaunchSplash from './components/AppLaunchSplash';
import Layout from './components/Layout';
import Dashboard from './pages/Dashboard';
import Login from './pages/Login';
import InstallPrompt from './components/InstallPrompt';
import OfflineBanner from './components/OfflineBanner';

// Route-Level Code-Splitting: rarely-used / heavy Seiten werden erst beim
// Aufruf nachgeladen. Reduziert das initiale JS+CSS-Bundle signifikant
// (Lighthouse: ~140 KB nicht genutztes JS, ~72 KB nicht genutztes CSS).
const CalendarPage = lazy(() => import('./pages/CalendarPage'));
const NotesPage = lazy(() => import('./pages/NotesPage'));
const GroupsPage = lazy(() => import('./pages/GroupsPage'));
const ProfilePage = lazy(() => import('./pages/ProfilePage'));
const PricingPage = lazy(() => import('./pages/PricingPage'));
const UpgradeResultPage = lazy(() => import('./pages/UpgradeResultPage'));
const TaskDetailPage = lazy(() => import('./pages/TaskDetailPage'));
const ChatPage = lazy(() => import('./pages/ChatPage'));
const LandingPage = lazy(() => import('./pages/LandingPage'));
const Register = lazy(() => import('./pages/Register'));
const PasswordChangeConfirmed = lazy(() => import('./pages/PasswordChangeConfirmed'));
const TermsPage = lazy(() => import('./pages/TermsPage'));
const PrivacyPage = lazy(() => import('./pages/PrivacyPage'));
const DesktopTitleBar = lazy(() => import('./components/DesktopTitleBar'));

function ProtectedRoute({ children }) {
  const { token } = useAuthStore();
  const location = useLocation();
  if (!token) return <Navigate to="/app/login" replace state={{ from: location }} />;
  return children;
}

function PublicRoute({ children }) {
  const { token } = useAuthStore();
  if (token) return <Navigate to="/app" replace />;
  return children;
}

function StandaloneRedirector() {
  const location = useLocation();
  const navigate = useNavigate();
  // Prüfe nur auf Root-Route und Standalone-Modus
  React.useEffect(() => {
    const isStandalone = window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone;
    const isElectron = typeof window !== 'undefined' && !!window.electronApp;
    // Landing-Page in Electron komplett überspringen.
    if (isElectron && (location.pathname === '/' || location.pathname === '/landing')) {
      navigate('/app/login', { replace: true });
      return;
    }
    if (isStandalone && location.pathname === '/') {
      navigate('/app/login', { replace: true });
    }
  }, [location, navigate]);

  // Electron-Tray-Navigation: Wenn der User im Tray-Menue z.B. "Kalender"
  // klickt, sendet der Hauptprozess uns die Zielroute.
  React.useEffect(() => {
    if (typeof window === 'undefined' || !window.electronApp?.onNavigate) return undefined;
    const off = window.electronApp.onNavigate((targetPath) => {
      if (!targetPath || typeof targetPath !== 'string') return;
      // Nicht navigieren wenn nicht eingeloggt — Login-Screen bleibt.
      const token = useAuthStore.getState().token;
      if (!token && targetPath.startsWith('/app') && targetPath !== '/app/login') {
        navigate('/app/login', { replace: true });
        return;
      }
      navigate(targetPath);
    });
    return () => { if (typeof off === 'function') off(); };
  }, [navigate]);

  return null;
}

export default function App() {
  const token = useAuthStore((s) => s.token);
  const userId = useAuthStore((s) => s.user?.id);
  const tasksLoading = useTaskStore((s) => s.loading);
  const tasksCount = useTaskStore((s) => s.tasks.length);

  // Supabase Realtime: live-Updates fuer Tasks (Phase 1).
  // Aktiviert sich automatisch sobald ein User eingeloggt ist und die
  // VITE_SUPABASE_* Env-Vars vorhanden sind.
  useRealtime({ userId: token ? userId : null, enabled: Boolean(token) });
  const [baseSplashReady, setBaseSplashReady] = useState(false);
  const [splashHardStop, setSplashHardStop] = useState(false);
  const isInitialDashboardRoute =
    typeof window !== 'undefined' && /^\/app\/?$/.test(window.location.pathname);
  // In der Desktop-App soll der Splash auch beim Cold-Start auf /app/login
  // erscheinen — sonst wirkt das Fenster nach dem nativen Vor-Splash schwarz.
  const isElectronColdStart =
    typeof window !== 'undefined' && !!window.electronApp;

  useEffect(() => {
    let minDurationReached = false;
    let loadReady = document.readyState === 'complete';

    const tryHide = () => {
      if (minDurationReached && loadReady) {
        setBaseSplashReady(true);
      }
    };

    const minDurationTimer = window.setTimeout(() => {
      minDurationReached = true;
      tryHide();
    }, 850);

    const onWindowLoad = () => {
      loadReady = true;
      tryHide();
    };

    if (!loadReady) {
      window.addEventListener('load', onWindowLoad, { once: true });
    } else {
      onWindowLoad();
    }

    // Safety fallback: splash never blocks longer than this.
    const hardFallbackTimer = window.setTimeout(() => {
      setBaseSplashReady(true);
    }, 2200);

    // Ensure splash never blocks forever while app data is loading.
    const absoluteMaxTimer = window.setTimeout(() => {
      setSplashHardStop(true);
      setBaseSplashReady(true);
    }, 2200);

    return () => {
      window.clearTimeout(minDurationTimer);
      window.clearTimeout(hardFallbackTimer);
      window.clearTimeout(absoluteMaxTimer);
      window.removeEventListener('load', onWindowLoad);
    };
  }, []);

  // Plan-Sync: nach Login (oder Reload mit Token) den aktuellen Plan vom Server holen,
  // damit limit()-Checks nicht auf veraltetem localStorage-Plan basieren.
  useEffect(() => {
    if (!token) return;
    let cancelled = false;
    (async () => {
      try {
        const { api } = await import('./utils/api');
        const me = await api.getMyPlan();
        if (cancelled || !me?.plan) return;
        const store = useAuthStore.getState();
        const cur = store.user;
        if (cur && cur.plan !== me.plan && typeof store.setUser === 'function') {
          store.setUser({ ...cur, plan: me.plan });
        }
      } catch { /* ignore */ }
    })();
    return () => { cancelled = true; };
  }, [token]);

  const waitForInitialDashboard =
    isInitialDashboardRoute &&
    !!token &&
    tasksLoading &&
    tasksCount === 0 &&
    !splashHardStop;

  const showLaunchSplash =
    (isInitialDashboardRoute || isElectronColdStart) &&
    (!baseSplashReady || waitForInitialDashboard);

  return (
    <>
      <BrowserRouter>
        <StandaloneRedirector />
        <Suspense fallback={null}>
          <DesktopTitleBar />
        </Suspense>
        <InstallPrompt />
        <OfflineBanner />
        <Routes>
          {/* Root zeigt LandingPage */}
          <Route path="/" element={<Suspense fallback={null}><LandingPage /></Suspense>} />
          <Route path="/landing" element={<Suspense fallback={null}><LandingPage /></Suspense>} />
          <Route path="/agb" element={<Suspense fallback={null}><TermsPage /></Suspense>} />
          <Route path="/datenschutz" element={<Suspense fallback={null}><PrivacyPage /></Suspense>} />
          <Route path="/app/login" element={<PublicRoute><Login /></PublicRoute>} />
          <Route path="/login" element={<Navigate to="/app/login" replace />} />
          <Route path="/confirm-password-change" element={<Suspense fallback={null}><PasswordChangeConfirmed /></Suspense>} />
          <Route path="/register" element={<PublicRoute><Suspense fallback={null}><Register /></Suspense></PublicRoute>} />
          <Route
            path="/app"
            element={
              <ProtectedRoute>
                <Layout />
              </ProtectedRoute>
            }
          >
            <Route index element={<Dashboard />} />
            <Route path="calendar" element={<Suspense fallback={null}><CalendarPage /></Suspense>} />
            <Route path="notes" element={<Suspense fallback={null}><NotesPage /></Suspense>} />
            <Route path="groups" element={<Suspense fallback={null}><GroupsPage /></Suspense>} />
            <Route path="profile" element={<Suspense fallback={null}><ProfilePage /></Suspense>} />
            <Route path="pricing" element={<Suspense fallback={null}><PricingPage /></Suspense>} />
            <Route path="upgrade/success" element={<Suspense fallback={null}><UpgradeResultPage mode="success" /></Suspense>} />
            <Route path="upgrade/cancel" element={<Suspense fallback={null}><UpgradeResultPage mode="cancel" /></Suspense>} />
            <Route path="tasks/:taskId" element={<Suspense fallback={null}><TaskDetailPage /></Suspense>} />
            <Route path="chat" element={<Suspense fallback={null}><ChatPage /></Suspense>} />
          </Route>
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </BrowserRouter>
      <AppLaunchSplash visible={showLaunchSplash} />
    </>
  );
}
