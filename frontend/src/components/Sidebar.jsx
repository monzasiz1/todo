import { NavLink, useLocation } from 'react-router-dom';
import { useAuthStore } from '../store/authStore';
import { useTaskStore } from '../store/taskStore';
import { useEffect, useState } from 'react';
import {
  LayoutDashboard,
  CalendarDays,
  CheckSquare,
  LogOut,
  Sparkles,
  Users,
  UsersRound,
} from 'lucide-react';
import FriendsList from './FriendsList';
import CategoryManager from './CategoryManager';
import { useFriendsStore } from '../store/friendsStore';
import AvatarBadge from './AvatarBadge';

export default function Sidebar({ isOpen, onClose }) {
  const { user, logout } = useAuthStore();
  const { categories, fetchCategories, tasks, filter, setFilter, clearFilters } = useTaskStore();
  const { pending, fetchFriends } = useFriendsStore();
  const [showFriends, setShowFriends] = useState(false);
  const [showCategories, setShowCategories] = useState(false);
  const location = useLocation();

  useEffect(() => {
    fetchCategories();
    fetchFriends();
  }, []);

  const navItems = [
    { to: '/', icon: LayoutDashboard, label: 'Dashboard' },
    { to: '/calendar', icon: CalendarDays, label: 'Kalender' },
    { to: '/groups', icon: UsersRound, label: 'Gruppen' },
  ];

  const getTaskCount = (categoryId) => {
    return tasks.filter((t) => t.category_id === categoryId && !t.completed).length;
  };

  return (
    <aside className={`app-sidebar ${isOpen ? 'open' : ''}`}>
      {/* Logo */}
      <div className="sidebar-logo">
        <div className="sidebar-logo-icon">
          <CheckSquare size={22} />
        </div>
        <h1>Taski</h1>
      </div>

      {/* Navigation */}
      <nav className="sidebar-nav">
        {navItems.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            end={item.to === '/'}
            className={({ isActive }) => `sidebar-link ${isActive ? 'active' : ''}`}
            onClick={onClose}
          >
            <item.icon size={20} />
            {item.label}
          </NavLink>
        ))}
        <button
          className="sidebar-link"
          onClick={() => setShowFriends(true)}
        >
          <Users size={20} />
          Freunde
          {pending.filter(p => p.direction === 'incoming').length > 0 && (
            <span className="friends-badge" style={{ marginLeft: 'auto' }}>
              {pending.filter(p => p.direction === 'incoming').length}
            </span>
          )}
        </button>
      </nav>

      {/* KI Feature Hint */}
      <div style={{
        background: 'linear-gradient(135deg, rgba(0,122,255,0.08), rgba(88,86,214,0.08))',
        borderRadius: 12,
        padding: '14px 16px',
        marginBottom: 24,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
          <Sparkles size={16} style={{ color: 'var(--primary)' }} />
          <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--primary)' }}>KI Eingabe</span>
        </div>
        <p style={{ fontSize: 12, color: 'var(--text-secondary)', lineHeight: 1.5 }}>
          Schreibe z.B. "Freitag Reinigung 18 Uhr" und die KI erkennt alles automatisch.
        </p>
      </div>

      {/* Categories */}
      <div className="sidebar-section-title" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        Kategorien
        <button
          className="catm-manage-btn"
          onClick={() => setShowCategories(true)}
          title="Kategorien verwalten"
        >
          Verwalten
        </button>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 2, marginBottom: 16, overflowY: 'auto' }}>
        <div
          className={`sidebar-category ${!filter.category ? 'active' : ''}`}
          onClick={() => { clearFilters(); onClose?.(); }}
        >
          <div className="sidebar-category-dot" style={{ background: 'var(--text-tertiary)' }} />
          Alle
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
          >
            <div className="sidebar-category-dot" style={{ background: cat.color }} />
            {cat.name}
            <span className="sidebar-category-count">{getTaskCount(cat.id)}</span>
          </div>
        ))}
      </div>

      {/* User */}
      <div className="sidebar-bottom">
        <NavLink to="/profile" className="sidebar-user" onClick={onClose} style={{ textDecoration: 'none' }}>
          <AvatarBadge
            className="sidebar-avatar"
            name={user?.name}
            color={user?.avatar_color || '#007AFF'}
            avatarUrl={user?.avatar_url}
            size={36}
          />
          <div className="sidebar-user-info">
            <div className="sidebar-user-name">{user?.name || 'Benutzer'}</div>
            <div className="sidebar-user-email">{user?.email || ''}</div>
          </div>
        </NavLink>
        <button className="sidebar-logout" onClick={logout} title="Abmelden">
          <LogOut size={16} />
          <span>Abmelden</span>
        </button>
      </div>

      {/* Friends Panel */}
      {showFriends && <FriendsList onClose={() => setShowFriends(false)} />}
      {showCategories && <CategoryManager onClose={() => setShowCategories(false)} />}
    </aside>
  );
}
