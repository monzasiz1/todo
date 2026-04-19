import { useState } from 'react';
import { motion } from 'framer-motion';
import { Lock, Users, UserCheck, Sparkles, ChevronDown } from 'lucide-react';
import { useFriendsStore } from '../store/friendsStore';
import { api } from '../utils/api';

const VISIBILITY_OPTIONS = [
  { value: 'private', label: 'Privat', icon: Lock, color: '#8E8E93' },
  { value: 'shared', label: 'Alle Freunde', icon: Users, color: '#007AFF' },
  { value: 'selected_users', label: 'Auswahl', icon: UserCheck, color: '#34C759' },
];

export default function VisibilityToggle({ value = 'private', selectedUsers = [], onChange }) {
  const { friends } = useFriendsStore();
  const [showUserSelect, setShowUserSelect] = useState(false);
  const [aiInput, setAiInput] = useState('');
  const [aiLoading, setAiLoading] = useState(false);

  const handleVisibilityChange = (newVisibility) => {
    if (newVisibility === 'selected_users') {
      setShowUserSelect(true);
    } else {
      setShowUserSelect(false);
    }
    onChange({ visibility: newVisibility, permissions: newVisibility === 'selected_users' ? selectedUsers : [] });
  };

  const toggleUser = (userId, permission = 'view') => {
    const existing = selectedUsers.find(u => u.user_id === userId);
    let updated;
    if (existing) {
      if (permission === 'remove') {
        updated = selectedUsers.filter(u => u.user_id !== userId);
      } else {
        updated = selectedUsers.map(u =>
          u.user_id === userId
            ? { ...u, can_edit: permission === 'edit' ? !u.can_edit : u.can_edit }
            : u
        );
      }
    } else {
      updated = [...selectedUsers, { user_id: userId, can_view: true, can_edit: false }];
    }
    onChange({ visibility: 'selected_users', permissions: updated });
  };

  const handleAiParse = async () => {
    if (!aiInput.trim()) return;
    setAiLoading(true);
    try {
      const result = await api.parsePermissions(aiInput);
      if (result.data) {
        const d = result.data;
        if (d.visibility === 'private') {
          onChange({ visibility: 'private', permissions: [] });
          setShowUserSelect(false);
        } else if (d.visibility === 'shared') {
          onChange({ visibility: 'shared', permissions: [] });
          setShowUserSelect(false);
        } else {
          const perms = [];
          (d.resolved_visible_to || []).forEach(id => {
            const existing = perms.find(p => p.user_id === id);
            if (!existing) perms.push({ user_id: id, can_view: true, can_edit: false });
          });
          (d.resolved_editable_by || []).forEach(id => {
            const existing = perms.find(p => p.user_id === id);
            if (existing) {
              existing.can_edit = true;
            } else {
              perms.push({ user_id: id, can_view: true, can_edit: true });
            }
          });
          onChange({ visibility: 'selected_users', permissions: perms });
          setShowUserSelect(true);
        }
        setAiInput('');
      }
    } catch (err) {
      console.error('AI parse error:', err);
    }
    setAiLoading(false);
  };

  const current = VISIBILITY_OPTIONS.find(o => o.value === value);

  return (
    <div className="visibility-toggle">
      <div className="visibility-pills">
        {VISIBILITY_OPTIONS.map((opt) => {
          const Icon = opt.icon;
          const isActive = value === opt.value;
          return (
            <motion.button
              key={opt.value}
              className={`visibility-pill ${isActive ? 'active' : ''}`}
              onClick={() => handleVisibilityChange(opt.value)}
              style={isActive ? { background: opt.color, color: '#fff' } : {}}
              whileTap={{ scale: 0.95 }}
            >
              <Icon size={14} />
              <span>{opt.label}</span>
            </motion.button>
          );
        })}
      </div>

      {value === 'selected_users' && (
        <motion.div
          className="visibility-user-select"
          initial={{ opacity: 0, height: 0 }}
          animate={{ opacity: 1, height: 'auto' }}
          exit={{ opacity: 0, height: 0 }}
        >
          <div className="visibility-ai-row">
            <Sparkles size={14} className="ai-icon" />
            <input
              type="text"
              value={aiInput}
              onChange={(e) => setAiInput(e.target.value)}
              placeholder="z.B. 'Max darf bearbeiten, Anna nur sehen'"
              className="visibility-ai-input"
              onKeyDown={(e) => e.key === 'Enter' && handleAiParse()}
            />
            <button
              className="visibility-ai-btn"
              onClick={handleAiParse}
              disabled={aiLoading || !aiInput.trim()}
            >
              {aiLoading ? '...' : 'KI'}
            </button>
          </div>

          {friends.length > 0 ? (
            <div className="visibility-friend-list">
              {friends.map((friend) => {
                const perm = selectedUsers.find(u => u.user_id === friend.friend_user_id);
                const isSelected = !!perm;
                return (
                  <div
                    key={friend.friend_user_id}
                    className={`visibility-friend-item ${isSelected ? 'selected' : ''}`}
                  >
                    <div
                      className="visibility-friend-avatar"
                      style={{ background: friend.avatar_color || '#007AFF' }}
                    >
                      {friend.name?.[0]?.toUpperCase() || '?'}
                    </div>
                    <span className="visibility-friend-name">{friend.name}</span>
                    <div className="visibility-friend-controls">
                      <button
                        className={`perm-btn ${isSelected ? 'active' : ''}`}
                        onClick={() => isSelected ? toggleUser(friend.friend_user_id, 'remove') : toggleUser(friend.friend_user_id)}
                        title={isSelected ? 'Entfernen' : 'Kann sehen'}
                      >
                        👁
                      </button>
                      {isSelected && (
                        <button
                          className={`perm-btn ${perm?.can_edit ? 'active edit' : ''}`}
                          onClick={() => toggleUser(friend.friend_user_id, 'edit')}
                          title={perm?.can_edit ? 'Bearbeiten entfernen' : 'Kann bearbeiten'}
                        >
                          ✏️
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="visibility-no-friends">
              Noch keine Freunde hinzugefügt
            </div>
          )}
        </motion.div>
      )}
    </div>
  );
}
