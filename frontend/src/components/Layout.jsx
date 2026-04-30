import { Outlet, useLocation, useNavigate } from 'react-router-dom';
import Sidebar from './Sidebar';
import FeedbackToast from './FeedbackToast';
import BottomNav from './BottomNav';
import DayCreateModal from './DayCreateModal';
import GroupChatPanel from './GroupChatPanel';
import { AnimatePresence } from 'framer-motion';
import { useState, useRef, useEffect } from 'react';
import { Menu, X, MessageCircle } from 'lucide-react';
import NotificationBell from './NotificationBell';
import ReminderChecker from './ReminderChecker';
import HelpChat from './HelpChat';
import { lockScroll, unlockScroll } from '../utils/scrollLock';

export default function Layout() {
  const location = useLocation();
  const navigate = useNavigate();
  const isNotesRoute = location.pathname === '/app/notes';
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [chatOpen, setChatOpen] = useState(false);
  const [showQuickAdd, setShowQuickAdd] = useState(false);
  const [dragGhost, setDragGhost] = useState(null);
  const aiInputRef = useRef(null);

  const handleFabClick = () => setShowQuickAdd(true);

  useEffect(() => {
    try {
      setSidebarCollapsed(localStorage.getItem('beequ_sidebar_collapsed') === 'true');
    } catch {
      // ignore storage access issues
    }
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem('beequ_sidebar_collapsed', sidebarCollapsed ? 'true' : 'false');
    } catch {
      // ignore storage access issues
    }
  }, [sidebarCollapsed]);

  // Scroll-Lock: verhindert Background-Scrolling auf iOS wenn ein Panel offen ist
  useEffect(() => {
    const anyOpen = sidebarOpen || chatOpen || showQuickAdd;
    if (anyOpen) lockScroll();
    else unlockScroll();
    return () => unlockScroll();
  }, [sidebarOpen, chatOpen, showQuickAdd]);

  useEffect(() => {
    const onDragStart = (e) => {
      if (window.matchMedia('(min-width: 1025px)').matches) {
        setChatOpen(true);
      } else {
        navigate('/app/chat');
      }
      const d = e?.detail || {};
      if (d.source !== 'touch') {
        setDragGhost(null);
        return;
      }
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
            <img src="/icons/icon.png" alt="BeeQu" className="mobile-brand-mark" />
          <div className="mobile-brand-texts">
            <span className="mobile-brand-title">BeeQu</span>
            {/* entfernt: BeeTwice Solution */}
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          <NotificationBell />
          <button
            className="gchat-mobile-trigger"
            onClick={() => window.matchMedia('(min-width: 1025px)').matches ? setChatOpen(true) : navigate('/app/chat')}
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
      <Sidebar
        isOpen={sidebarOpen}
        onClose={() => setSidebarOpen(false)}
        isCollapsed={sidebarCollapsed}
        onToggleCollapse={() => setSidebarCollapsed((value) => !value)}
      />

      {/* Main Content */}
      <main className={`app-main ${sidebarCollapsed ? 'desktop-sidebar-collapsed' : ''}`}>
        <div className={`app-content-shell ${isNotesRoute ? 'notes-full-width' : ''}`}>
          <Outlet />
        </div>
      </main>

      {/* Scroll-Fade: verdunkelt Inhalte die unter die Nav laufen */}
      <div className="bottom-nav-scrim" />

      {/* Bottom Navigation (mobile) — hidden on chat page */}
      {location.pathname !== '/app/chat' && <BottomNav onAddClick={handleFabClick} />}

      {/* Universal Quick-Add — DayCreateModal für heute */}
      <AnimatePresence>
        {showQuickAdd && (
          <DayCreateModal
            date={new Date()}
            tasks={[]}
            onClose={() => setShowQuickAdd(false)}
            onTaskCreated={() => setShowQuickAdd(false)}
          />
        )}
      </AnimatePresence>

      {/* Toast Notifications */}
      <FeedbackToast />

      {/* Client-side Reminder Checker */}
      <ReminderChecker />

      {/* Help Chat */}
      <HelpChat hideFab={chatOpen} />

      {/* Group Chat Panel (desktop) */}
      <GroupChatPanel open={chatOpen} onClose={() => setChatOpen(false)} />

      {/* Group Chat FAB — desktop: toggles panel; mobile/tablet: navigates to /app/chat */}
      {!chatOpen && location.pathname !== '/app/chat' && (
        <button
          className="gchat-fab"
          onClick={() => window.matchMedia('(min-width: 1025px)').matches ? setChatOpen(true) : navigate('/app/chat')}
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
