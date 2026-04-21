import { Outlet } from 'react-router-dom';
import Sidebar from './Sidebar';
import FeedbackToast from './FeedbackToast';
import BottomNav from './BottomNav';
import { useState, useRef, useEffect } from 'react';
import { Menu, X, CheckSquare, MessageCircle } from 'lucide-react';
import NotificationBell from './NotificationBell';
import ReminderChecker from './ReminderChecker';
import HelpChat from './HelpChat';
import GroupChatPanel from './GroupChatPanel';

export default function Layout() {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [chatOpen, setChatOpen] = useState(false);
  const [dragGhost, setDragGhost] = useState(null); // { x, y, title, time }
  const aiInputRef = useRef(null);

  const handleFabClick = () => {
    // Focus the AI input field when FAB is pressed
    const aiInput = document.querySelector('.ai-input-field');
    if (aiInput) {
      aiInput.focus();
      aiInput.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  };

  useEffect(() => {
    const onDragStart = (e) => {
      setChatOpen(true);
      const d = e?.detail || {};
      setDragGhost({
        x: d.x || 24,
        y: d.y || 24,
        title: d.title || 'Termin',
        time: d.time || '',
      });
    };
    const onDragMove = (e) => {
      const d = e?.detail || {};
      setDragGhost((prev) => {
        if (!prev) return prev;
        return {
          ...prev,
          x: typeof d.x === 'number' ? d.x : prev.x,
          y: typeof d.y === 'number' ? d.y : prev.y,
        };
      });
    };
    const onDragEnd = () => setDragGhost(null);
    window.addEventListener('task-share-drag-start', onDragStart);
    window.addEventListener('task-share-drag-move', onDragMove);
    window.addEventListener('task-share-drag-end', onDragEnd);
    return () => {
      window.removeEventListener('task-share-drag-start', onDragStart);
      window.removeEventListener('task-share-drag-move', onDragMove);
      window.removeEventListener('task-share-drag-end', onDragEnd);
    };
  }, []);

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
          <button
            className="gchat-mobile-trigger"
            onClick={() => setChatOpen(true)}
            title="Gruppen-Chat"
          >
            <MessageCircle size={20} />
          </button>
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
        <div className="app-content-shell">
          <Outlet />
        </div>
      </main>

      {/* Bottom Navigation (mobile) */}
      <BottomNav onAddClick={handleFabClick} />

      {/* Toast Notifications */}
      <FeedbackToast />

      {/* Client-side Reminder Checker */}
      <ReminderChecker />

      {/* Help Chat */}
      <HelpChat />

      {/* Group Chat Panel */}
      <GroupChatPanel open={chatOpen} onClose={() => setChatOpen(false)} />

      {/* Group Chat FAB (desktop) */}
      {!chatOpen && (
        <button
          className="gchat-fab"
          onClick={() => setChatOpen(true)}
          title="Gruppen-Chat öffnen"
        >
          <MessageCircle size={22} />
        </button>
      )}

      {dragGhost && (
        <div
          className="task-share-drag-ghost"
          style={{ left: dragGhost.x, top: dragGhost.y }}
        >
          <span className="task-share-drag-ghost-dot" />
          <span className="task-share-drag-ghost-text">{dragGhost.title}</span>
          {dragGhost.time && <span className="task-share-drag-ghost-time">{dragGhost.time}</span>}
        </div>
      )}
    </div>
  );
}
