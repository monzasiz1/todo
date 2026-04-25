import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { useAuthStore } from './store/authStore';
import Layout from './components/Layout';
import Dashboard from './pages/Dashboard';
import CalendarPage from './pages/CalendarPage';
import Login from './pages/Login';
import Register from './pages/Register';
import LandingPage from './pages/LandingPage';
import ProfilePage from './pages/ProfilePage';
import GroupsPage from './pages/GroupsPage';
import OrganizationsPage from './pages/OrganizationsPage';
import PricingPage from './pages/PricingPage';
import InstallPrompt from './components/InstallPrompt';
import OfflineBanner from './components/OfflineBanner';
import { useEffect } from 'react';

function ProtectedRoute({ children }) {
  const { token, checkAuth } = useAuthStore();

  useEffect(() => {
    if (token) checkAuth();
  }, []);

  if (!token) return <Navigate to="/login" replace />;
  return children;
}

function PublicRoute({ children }) {
  const { token } = useAuthStore();
  if (token) return <Navigate to="/" replace />;
  return children;
}

export default function App() {
  return (
    <BrowserRouter>
      <InstallPrompt />
      <OfflineBanner />
      <Routes>
        <Route path="/landing" element={<LandingPage />} />
        <Route path="/login" element={<PublicRoute><Login /></PublicRoute>} />
        <Route path="/register" element={<PublicRoute><Register /></PublicRoute>} />
        <Route
          path="/"
          element={
            <ProtectedRoute>
              <Layout />
            </ProtectedRoute>
          }
        >
          <Route index element={<Dashboard />} />
          <Route path="calendar" element={<CalendarPage />} />
          <Route path="groups" element={<GroupsPage />} />
          <Route path="organizations" element={<OrganizationsPage />} />
          <Route path="profile" element={<ProfilePage />} />
          <Route path="pricing" element={<PricingPage />} />
        </Route>
        <Route path="*" element={<Navigate to="/login" replace />} />
      </Routes>
    </BrowserRouter>
  );
}
