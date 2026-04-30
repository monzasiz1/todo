import React from 'react';
import { BrowserRouter, Routes, Route, Navigate, useLocation, useNavigate } from 'react-router-dom';
import { useAuthStore } from './store/authStore';
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
import InstallPrompt from './components/InstallPrompt';
import OfflineBanner from './components/OfflineBanner';

function ProtectedRoute({ children }) {
  const { token } = useAuthStore();
  if (!token) return <Navigate to="/login" replace />;
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
      navigate('/login', { replace: true });
    }
  }, [location, navigate]);
  return null;
}

export default function App() {
  return (
    <BrowserRouter>
      <StandaloneRedirector />
      <InstallPrompt />
      <OfflineBanner />
      <Routes>
        {/* Root zeigt LandingPage */}
        <Route path="/" element={<LandingPage />} />
        <Route path="/landing" element={<LandingPage />} />
        <Route path="/login" element={<PublicRoute><Login /></PublicRoute>} />
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
  );
}
