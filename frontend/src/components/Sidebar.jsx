import { NavLink, useLocation } from 'react-router-dom';
import { useAuthStore } from '../store/authStore';
import { useTaskStore } from '../store/taskStore';
import { useEffect, useState } from 'react';
import {
  LayoutDashboard,
  CalendarDays,
  MessageCircle,
  LogOut,
  Sparkles,
  Users,
  UsersRound,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
} from 'lucide-react';
import FriendsList from './FriendsList';
import CategoryManager from './CategoryManager';
import { useFriendsStore } from '../store/friendsStore';
import AvatarBadge from './AvatarBadge';
import NotificationBell from './NotificationBell';
import { usePlan } from '../hooks/usePlan';

export default function Sidebar({ isOpen, onClose, isCollapsed, onToggleCollapse }) {
  const { user, logout } = useAuthStore();
  const { categories, fetchCategories, tasks, filter, setFilter, clearFilters } = useTaskStore();
  const { pending, fetchFriends } = useFriendsStore();
  const { planId } = usePlan();
  const [showFriends, setShowFriends] = useState(false);
  const [showCategories, setShowCategories] = useState(false);
  const [categoriesCollapsed, setCategoriesCollapsed] = useState(false);
  const location = useLocation();

  useEffect(() => {
    fetchCategories();
    fetchFriends();
  }, []);

  const navItems = [
    { to: '/app', icon: LayoutDashboard, label: 'Dashboard' },
    { to: '/app/calendar', icon: CalendarDays, label: 'Kalender' },
    { to: '/app/notes', icon: Sparkles, label: 'Notes' },
    { to: '/app/groups', icon: UsersRound, label: 'Gruppen' },
    { to: '/app/chat', icon: MessageCircle, label: 'Chat' },
  ];

  const getTaskCount = (categoryId) => {
    return tasks.filter((t) => t.category_id === categoryId && !t.completed).length;
  };

  return (
    <aside className={`app-sidebar ${isOpen ? 'open' : ''} ${isCollapsed ? 'collapsed' : ''}`}>
      {/* Collapse toggle — desktop only, sits at top-right edge of sidebar */}
      <button
        type="button"
        className="sidebar-desktop-toggle"
        onClick={onToggleCollapse}
        aria-label={isCollapsed ? 'Sidebar ausklappen' : 'Sidebar einklappen'}
        title={isCollapsed ? 'Sidebar ausklappen' : 'Sidebar einklappen'}
      >
        {isCollapsed ? <ChevronRight size={15} /> : <ChevronLeft size={15} />}
      </button>

      {/* Logo — never changes */}
      <div className="sidebar-logo">
          <img src="/icons/icon.png" alt="BeeQu" className="sidebar-logo-icon" />
        <div className="sidebar-logo-texts">
          <h1>BeeQu</h1>
          {/* entfernt: BeeTwice Solution */}
        </div>
      </div>

      {/* Navigation */}
      <nav className="sidebar-nav">
        {navItems.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            end={item.to === '/app'}
            className={({ isActive }) => `sidebar-link ${isActive ? 'active' : ''}`}
            onClick={onClose}
            title={isCollapsed ? item.label : undefined}
          >
            <item.icon size={20} />
            <span className="sidebar-link-label">{item.label}</span>
          </NavLink>
        ))}
        <button
          className="sidebar-link"
          onClick={() => setShowFriends(true)}
          title={isCollapsed ? 'Freunde' : undefined}
        >
          <Users size={20} />
          <span className="sidebar-link-label">Freunde</span>
          {pending.filter(p => p.direction === 'incoming').length > 0 && (
            <span className="friends-badge" style={{ marginLeft: 'auto' }}>
              {pending.filter(p => p.direction === 'incoming').length}
            </span>
          )}
        </button>
      </nav>

      {/* KI Feature Hint */}
      <div className="sidebar-notif-row">
        <NotificationBell />
      </div>

      <div className="sidebar-ai-hint">
        <div className="sidebar-ai-hint-head">
          <Sparkles size={16} className="sidebar-ai-hint-icon" />
          <span className="sidebar-ai-hint-title">KI Eingabe</span>
        </div>
        <p className="sidebar-ai-hint-text">
          Schreibe z.B. "Freitag Reinigung 18 Uhr" und die KI erkennt alles automatisch.
        </p>
      </div>

      {/* Categories */}
      <div className="sidebar-section-title sidebar-section-head">
        <span>Kategorien</span>
        <div className="sidebar-section-actions">
          <button
            className="catm-manage-btn"
            onClick={() => setShowCategories(true)}
            title="Kategorien verwalten"
          >
            Verwalten
          </button>
          <button
            className={`sidebar-collapse-btn ${!categoriesCollapsed ? 'open' : ''}`}
            onClick={() => setCategoriesCollapsed((v) => !v)}
            aria-label={categoriesCollapsed ? 'Kategorien ausklappen' : 'Kategorien einklappen'}
            title={categoriesCollapsed ? 'Ausklappen' : 'Einklappen'}
          >
            <ChevronDown size={16} />
          </button>
        </div>
      </div>
      <div className={`sidebar-categories-wrap ${categoriesCollapsed ? 'collapsed' : 'open'}`}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 2, marginBottom: 16 }}>
        <div
          className={`sidebar-category ${!filter.category ? 'active' : ''}`}
          onClick={() => { clearFilters(); onClose?.(); }}
          title={isCollapsed ? 'Alle' : undefined}
        >
          <div className="sidebar-category-dot" style={{ background: 'var(--text-tertiary)' }} />
          <span className="sidebar-category-label">Alle</span>
          <span className="sidebar-category-count">
            {tasks.filter((t) => !t.completed).length}
          </span>
        </div>
        {categories.map((cat) => (
          <div
            key={cat.id}
            className={`sidebar-category ${filter.category === cat.id ? 'active' : ''}`}
            onClick={() => {
              setFilter('category', filter.category === cat.id ? null : cat.id);
              onClose?.();
            }}
            title={isCollapsed ? cat.name : undefined}
          >
            <div className="sidebar-category-dot" style={{ background: cat.color }} />
            <span className="sidebar-category-label">{cat.name}</span>
            <span className="sidebar-category-count">{getTaskCount(cat.id)}</span>
          </div>
        ))}
        </div>
      </div>

      {/* User */}
      <div className="sidebar-bottom">
        <NavLink to="/app/profile" className="sidebar-user" onClick={onClose} style={{ textDecoration: 'none' }}>
          <AvatarBadge
            className="sidebar-avatar"
            name={user?.name}
            color={user?.avatar_color || '#007AFF'}
            avatarUrl={user?.avatar_url}
            size={36}
          />
          <div className="sidebar-user-info">
            <div className="sidebar-user-name">
              {user?.name || 'Benutzer'}
              <span className={`plan-badge ${planId}`} style={{ marginLeft: 6 }}>
                {planId === 'free' ? 'Free' : planId === 'pro' ? 'Pro' : 'Team'}
              </span>
            </div>
            <div className="sidebar-user-email">{user?.email || ''}</div>
          </div>
        </NavLink>
        <NavLink
          to="/app/pricing"
          className="sidebar-pricing-link"
          onClick={onClose}
          title="Pläne & Preise"
        >
          <Sparkles size={13} />
          Upgrade
        </NavLink>
        <button className="sidebar-logout" onClick={logout} title="Abmelden">
          <LogOut size={16} />
          <span className="sidebar-logout-label">Abmelden</span>
        </button>
      </div>

      {/* Friends Panel */}
      {showFriends && <FriendsList onClose={() => setShowFriends(false)} />}
      {showCategories && <CategoryManager onClose={() => setShowCategories(false)} />}
    </aside>
  );
}
