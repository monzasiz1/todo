import React, { useEffect, useState } from 'react';
import { BrowserRouter, Routes, Route, Navigate, useLocation, useNavigate } from 'react-router-dom';
import { useAuthStore } from './store/authStore';
import { useTaskStore } from './store/taskStore';
import AppLaunchSplash from './components/AppLaunchSplash';
import Layout from './components/Layout';
import Dashboard from './pages/Dashboard';
import CalendarPage from './pages/CalendarPage';
import Login from './pages/Login';
import PasswordChangeConfirmed from './pages/PasswordChangeConfirmed';
import Register from './pages/Register';
import LandingPage from './pages/LandingPage';
import ProfilePage from './pages/ProfilePage';
import GroupsPage from './pages/GroupsPage';
import PricingPage from './pages/PricingPage';
import NotesPage from './pages/NotesPage';
import TaskDetailPage from './pages/TaskDetailPage';
import ChatPage from './pages/ChatPage';
import TermsPage from './pages/TermsPage';
import PrivacyPage from './pages/PrivacyPage';
import InstallPrompt from './components/InstallPrompt';
import OfflineBanner from './components/OfflineBanner';

function ProtectedRoute({ children }) {
  const { token } = useAuthStore();
  if (!token) return <Navigate to="/app/login" replace />;
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
    if (isStandalone && location.pathname === '/') {
      navigate('/app/login', { replace: true });
    }
  }, [location, navigate]);
  return null;
}

export default function App() {
  const token = useAuthStore((s) => s.token);
  const tasksLoading = useTaskStore((s) => s.loading);
  const tasksCount = useTaskStore((s) => s.tasks.length);
  const [baseSplashReady, setBaseSplashReady] = useState(false);
  const [splashHardStop, setSplashHardStop] = useState(false);
  const isInitialDashboardRoute =
    typeof window !== 'undefined' && /^\/app\/?$/.test(window.location.pathname);

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

  const waitForInitialDashboard =
    isInitialDashboardRoute &&
    !!token &&
    tasksLoading &&
    tasksCount === 0 &&
    !splashHardStop;

  const showLaunchSplash = isInitialDashboardRoute && (!baseSplashReady || waitForInitialDashboard);

  return (
    <>
      <BrowserRouter>
        <StandaloneRedirector />
        <InstallPrompt />
        <OfflineBanner />
        <Routes>
          {/* Root zeigt LandingPage */}
          <Route path="/" element={<LandingPage />} />
          <Route path="/landing" element={<LandingPage />} />
          <Route path="/agb" element={<TermsPage />} />
          <Route path="/datenschutz" element={<PrivacyPage />} />
          <Route path="/app/login" element={<PublicRoute><Login /></PublicRoute>} />
          <Route path="/login" element={<Navigate to="/app/login" replace />} />
          <Route path="/confirm-password-change" element={<PasswordChangeConfirmed />} />
          <Route path="/register" element={<PublicRoute><Register /></PublicRoute>} />
          <Route
            path="/app"
            element={
              <ProtectedRoute>
                <Layout />
              </ProtectedRoute>
            }
          >
            <Route index element={<Dashboard />} />
            <Route path="calendar" element={<CalendarPage />} />
            <Route path="notes" element={<NotesPage />} />
            <Route path="groups" element={<GroupsPage />} />
            <Route path="profile" element={<ProfilePage />} />
            <Route path="pricing" element={<PricingPage />} />
            <Route path="tasks/:taskId" element={<TaskDetailPage />} />
            <Route path="chat" element={<ChatPage />} />
          </Route>
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </BrowserRouter>
      <AppLaunchSplash visible={showLaunchSplash} />
    </>
  );
}
