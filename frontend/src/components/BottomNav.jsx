import { NavLink } from 'react-router-dom';
import { LayoutDashboard, CalendarDays, Users, Plus, UserCircle } from 'lucide-react';
import { useState } from 'react';
import { useFriendsStore } from '../store/friendsStore';
import FriendsList from './FriendsList';

export default function BottomNav({ onAddClick }) {
  const { pending } = useFriendsStore();
  const [showFriends, setShowFriends] = useState(false);
  const incomingCount = pending.filter(p => p.direction === 'incoming').length;

  return (
    <>
      <nav className="bottom-nav">
        <NavLink to="/" end className={({ isActive }) => `bottom-nav-item ${isActive ? 'active' : ''}`}>
          <LayoutDashboard size={22} />
          <span>Home</span>
        </NavLink>

        <NavLink to="/calendar" className={({ isActive }) => `bottom-nav-item ${isActive ? 'active' : ''}`}>
          <CalendarDays size={22} />
          <span>Kalender</span>
        </NavLink>

        <button className="bottom-nav-fab" onClick={onAddClick}>
          <Plus size={26} strokeWidth={2.5} />
        </button>

        <button
          className={`bottom-nav-item`}
          onClick={() => setShowFriends(true)}
        >
          <div className="bottom-nav-icon-wrap">
            <Users size={22} />
            {incomingCount > 0 && <span className="bottom-nav-badge">{incomingCount}</span>}
          </div>
          <span>Freunde</span>
        </button>

        <NavLink to="/profile" className={({ isActive }) => `bottom-nav-item ${isActive ? 'active' : ''}`}>
          <UserCircle size={22} />
          <span>Profil</span>
        </NavLink>
      </nav>

      {showFriends && <FriendsList onClose={() => setShowFriends(false)} />}
    </>
  );
}
