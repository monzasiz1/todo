import { Outlet } from 'react-router-dom';
import Sidebar from './Sidebar';
import FeedbackToast from './FeedbackToast';
import BottomNav from './BottomNav';
import { useState, useRef } from 'react';
import { Menu, X, CheckSquare } from 'lucide-react';
import NotificationBell from './NotificationBell';

export default function Layout() {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const aiInputRef = useRef(null);

  const handleFabClick = () => {
    // Focus the AI input field when FAB is pressed
    const aiInput = document.querySelector('.ai-input-field');
    if (aiInput) {
      aiInput.focus();
      aiInput.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  };

  return (
    <div className="app-layout">
      {/* Mobile Header */}
      <div className="mobile-header">
        <div className="mobile-header-logo">
          <div style={{ width: 32, height: 32, background: 'linear-gradient(135deg, #007AFF, #5856D6)', borderRadius: 8, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'white' }}>
            <CheckSquare size={18} />
          </div>
          Taski
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          <NotificationBell />
          <button className="hamburger" onClick={() => setSidebarOpen(!sidebarOpen)}>
            {sidebarOpen ? <X size={24} /> : <Menu size={24} />}
          </button>
        </div>
      </div>

      {/* Overlay */}
      <div
        className={`sidebar-overlay ${sidebarOpen ? 'open' : ''}`}
        onClick={() => setSidebarOpen(false)}
      />

      {/* Sidebar */}
      <Sidebar isOpen={sidebarOpen} onClose={() => setSidebarOpen(false)} />

      {/* Main Content */}
      <main className="app-main">
        <Outlet />
      </main>

      {/* Bottom Navigation (mobile) */}
      <BottomNav onAddClick={handleFabClick} />

      {/* Toast Notifications */}
      <FeedbackToast />
    </div>
  );
}
