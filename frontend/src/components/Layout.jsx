import { Outlet, useLocation, useNavigate } from 'react-router-dom';
import Sidebar from './Sidebar';
import FeedbackToast from './FeedbackToast';
import BottomNav from './BottomNav';
import PremiumBackground from './PremiumBackground';
import { AnimatePresence } from 'framer-motion';
import { lazy, Suspense, useState, useRef, useEffect } from 'react';
import { Menu, X, MessageCircle } from 'lucide-react';
import NotificationBell from './NotificationBell';
import ReminderChecker from './ReminderChecker';
import FocusTimerPin from './FocusTimerPin';
import { lockScroll, unlockScroll } from '../utils/scrollLock';
import { useGroupStore } from '../store/groupStore';
import '../styles/shared-spending.css';

// On-Demand: erst beim Oeffnen laden, reduziert initiales App-Bundle.
const DayCreateModal = lazy(() => import('./DayCreateModal'));
const GroupChatPanel = lazy(() => import('./GroupChatPanel'));
const HelpChat = lazy(() => import('./HelpChat'));

export default function Layout() {
  const location = useLocation();
  const navigate = useNavigate();
  const isNotesRoute = location.pathname === '/app/notes';
  const isCalendarRoute = location.pathname === '/app/calendar';
  const isChatRoute = location.pathname === '/app/chat';
  const isWhiteboardRoute = location.pathname === '/app/whiteboard';
  // Full-Bleed = Whiteboard (eigener Header) ODER Chat (eigene Top-Bar) — beide
  // verstecken die Bottom-Nav. Der Mobile-Header wird NUR auf Whiteboard versteckt,
  // weil Whiteboard einen eigenen Header mitbringt; Chat behält den Mobile-Header.
  const isFullBleedRoute = isChatRoute || isWhiteboardRoute;
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [chatOpen, setChatOpen] = useState(false);
  // Sobald der Chat einmal geoeffnet wurde, bleibt das Panel gemountet -
  // so spielt der Exit-Animation-Cycle korrekt und der Lazy-Import laed
  // erst beim ersten Klick.
  const [chatEverOpened, setChatEverOpened] = useState(false);
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

  // Gruppen einmalig laden, damit TaskCard/TaskDetailModal die eigene Gruppenrolle
  // für die Admin-Erkennung kennen (auch auf Dashboard/Kalender).
  useEffect(() => {
    const { groups, fetchGroups } = useGroupStore.getState();
    if (!groups || groups.length === 0) fetchGroups();
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
        setChatEverOpened(true);
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
    <div className={`app-layout ${sidebarOpen ? 'sidebar-active' : ''} ${isFullBleedRoute ? 'full-bleed-route' : ''}`}>
      <PremiumBackground />
      {/* Scroll-Fade oben: verdunkelt Inhalte die unter den Header laufen */}
      {!isWhiteboardRoute && <div className="mobile-header-scrim" />}

      {/* Mobile Header — nur auf Whiteboard ausgeblendet (eigener Header).
          Auf Chat bleibt der Mobile-Header sichtbar. */}
      {!isWhiteboardRoute && (
      <div className="mobile-header">
        <div className="mobile-header-logo">
            <img src="/icons/icon.png" alt="BeeQu" className="mobile-brand-mark" />
          <div className="mobile-brand-texts">
            <span className="mobile-brand-title">BeeQu</span>
            {/* entfernt: BeeTwice Solution */}
          </div>
        </div>
        <div className="mobile-header-center">
          <FocusTimerPin variant="header" />
        </div>
        <div className="mobile-header-actions">
          <NotificationBell />
          <button
            className="gchat-mobile-trigger"
            onClick={() => window.matchMedia('(min-width: 1025px)').matches ? (setChatOpen(true), setChatEverOpened(true)) : navigate('/app/chat')}
            title="Gruppen-Chat"
          >
            <MessageCircle size={20} />
          </button>
          <button className="hamburger" onClick={() => setSidebarOpen(!sidebarOpen)}>
            {sidebarOpen ? <X size={24} /> : <Menu size={24} />}
          </button>
        </div>
      </div>
      )}

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
        <div className={`app-content-shell ${isNotesRoute ? 'notes-full-width' : ''} ${isCalendarRoute ? 'calendar-full-width' : ''}`}>
          {/* key = pathname → der Seiteninhalt remountet beim Tab-Wechsel und
              spielt die Einblend-Animation neu ab (native-App-Gefühl). */}
          <div key={location.pathname} className="app-route-view">
            <Outlet />
          </div>
        </div>
      </main>

      {/* Scroll-Fade: verdunkelt Inhalte die unter die Nav laufen */}
      {!isFullBleedRoute && <div className="bottom-nav-scrim" />}

      {/* Bottom Navigation (mobile) — auf Full-Bleed-Routen (Chat, Whiteboard) ausgeblendet */}
      {!isFullBleedRoute && <BottomNav onAddClick={handleFabClick} />}

      {/* Universal Quick-Add — DayCreateModal für heute */}
      <AnimatePresence>
        {showQuickAdd && (
          <Suspense fallback={null}>
            <DayCreateModal
              date={new Date()}
              tasks={[]}
              onClose={() => setShowQuickAdd(false)}
              onTaskCreated={() => setShowQuickAdd(false)}
            />
          </Suspense>
        )}
      </AnimatePresence>

      {/* Toast Notifications */}
      <FeedbackToast />

      {/* Client-side Reminder Checker */}
      <ReminderChecker />

      {/* Schwebender Fokus-Timer-Pin (sichtbar beim Seitenwechsel / Scroll) */}
      <FocusTimerPin variant="desktop" />

      {/* Help Chat */}
      <Suspense fallback={null}>
        <HelpChat hideFab={chatOpen} />
      </Suspense>

      {/* Group Chat Panel (desktop) — erst mounten wenn jemals geoeffnet */}
      {chatEverOpened && (
        <Suspense fallback={null}>
          <GroupChatPanel open={chatOpen} onClose={() => setChatOpen(false)} />
        </Suspense>
      )}

      {/* Group Chat FAB — desktop: toggles panel; mobile/tablet: navigates to /app/chat */}
      {!chatOpen && !isFullBleedRoute && (
        <button
          className="gchat-fab"
          onClick={() => window.matchMedia('(min-width: 1025px)').matches ? (setChatOpen(true), setChatEverOpened(true)) : navigate('/app/chat')}
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
