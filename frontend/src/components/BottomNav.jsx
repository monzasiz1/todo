import { NavLink } from 'react-router-dom';
import { LayoutDashboard, CalendarDays, User, Plus, UsersRound } from 'lucide-react';

export default function BottomNav({ onAddClick }) {
  return (
    <nav className="bottom-nav">
      <NavLink to="/app" end={true} className={({ isActive }) => `bottom-nav-item ${isActive ? 'active' : ''}`}>
        <LayoutDashboard size={22} />
        <span>Home</span>
      </NavLink>
      <NavLink to="/app/calendar" className={({ isActive }) => `bottom-nav-item ${isActive ? 'active' : ''}`}>
        <CalendarDays size={22} />
        <span>Kalender</span>
      </NavLink>

      <button className="bottom-nav-fab" onClick={onAddClick}>
        <Plus size={26} strokeWidth={2.5} />
      </button>

      <NavLink to="/app/groups" className={({ isActive }) => `bottom-nav-item ${isActive ? 'active' : ''}`}>
        <UsersRound size={22} />
        <span>Gruppen</span>
      </NavLink>
      <NavLink to="/app/profile" className={({ isActive }) => `bottom-nav-item ${isActive ? 'active' : ''}`}>
        <User size={22} />
        <span>Profil</span>
      </NavLink>
    </nav>
  );
}
