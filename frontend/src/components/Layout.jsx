import { Outlet } from 'react-router-dom';
import Sidebar from './Sidebar';
import FeedbackToast from './FeedbackToast';
import BottomNav from './BottomNav';
import DayCreateModal from './DayCreateModal';
import { AnimatePresence } from 'framer-motion';
import { useState, useRef, useEffect } from 'react';
import { Menu, X, CheckSquare, MessageCircle } from 'lucide-react';
import NotificationBell from './NotificationBell';
import ReminderChecker from './ReminderChecker';
import HelpChat from './HelpChat';
import GroupChatPanel from './GroupChatPanel';
import { getWorkspaceLabel, useWorkspaceStore } from '../store/workspaceStore';

export default function Layout() {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [chatOpen, setChatOpen] = useState(false);
  const [showQuickAdd, setShowQuickAdd] = useState(false);
  const [dragGhost, setDragGhost] = useState(null);
  const aiInputRef = useRef(null);
  const { activeWorkspace } = useWorkspaceStore();
  const workspaceLabel = getWorkspaceLabel(activeWorkspace);

  const handleFabClick = () => setShowQuickAdd(true);

  useEffect(() => {
    try {
      setSidebarCollapsed(localStorage.getItem('taski_sidebar_collapsed') === 'true');
    } catch {
      // ignore storage access issues
    }
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem('taski_sidebar_collapsed', sidebarCollapsed ? 'true' : 'false');
    } catch {
      // ignore storage access issues
    }
  }, [sidebarCollapsed]);

  useEffect(() => {
    const onDragStart = (e) => {
      setChatOpen(true);
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
      <Sidebar
        isOpen={sidebarOpen}
        onClose={() => setSidebarOpen(false)}
        isCollapsed={sidebarCollapsed}
        onToggleCollapse={() => setSidebarCollapsed((value) => !value)}
      />

      {/* Main Content */}
      <main className={`app-main ${sidebarCollapsed ? 'desktop-sidebar-collapsed' : ''}`}>
        <div className="app-content-shell">
          <div className="workspace-context-banner">
            <span className="workspace-context-dot" style={{ background: activeWorkspace.color || '#4C7BD9' }} />
            <div className="workspace-context-copy">
              <strong>{workspaceLabel}</strong>
              <small>Kalender, Dashboard und neue Eintraege folgen diesem aktiven Workspace.</small>
            </div>
          </div>
          <Outlet />
        </div>
      </main>

      {/* Bottom Navigation (mobile) */}
      <BottomNav onAddClick={handleFabClick} />

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
