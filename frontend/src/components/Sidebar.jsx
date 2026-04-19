import { NavLink, useLocation } from 'react-router-dom';
import { useAuthStore } from '../store/authStore';
import { useTaskStore } from '../store/taskStore';
import { useEffect } from 'react';
import {
  LayoutDashboard,
  CalendarDays,
  CheckSquare,
  LogOut,
  Sparkles,
} from 'lucide-react';

export default function Sidebar({ isOpen, onClose }) {
  const { user, logout } = useAuthStore();
  const { categories, fetchCategories, tasks, filter, setFilter, clearFilters } = useTaskStore();
  const location = useLocation();

  useEffect(() => {
    fetchCategories();
  }, []);

  const navItems = [
    { to: '/', icon: LayoutDashboard, label: 'Dashboard' },
    { to: '/calendar', icon: CalendarDays, label: 'Kalender' },
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
      <div className="sidebar-section-title">Kategorien</div>
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
        <div className="sidebar-user">
          <div className="sidebar-avatar">
            {user?.name?.charAt(0)?.toUpperCase() || '?'}
          </div>
          <div className="sidebar-user-info">
            <div className="sidebar-user-name">{user?.name || 'Benutzer'}</div>
            <div className="sidebar-user-email">{user?.email || ''}</div>
          </div>
          <button className="sidebar-logout" onClick={logout} title="Abmelden">
            <LogOut size={18} />
          </button>
        </div>
      </div>
    </aside>
  );
}
