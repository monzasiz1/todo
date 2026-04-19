import { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { UserPlus, UserCheck, UserX, Copy, Check, X, Mail, Hash, Users, Clock, Trash2 } from 'lucide-react';
import { useFriendsStore } from '../store/friendsStore';
import AvatarBadge from './AvatarBadge';

export default function FriendsList({ onClose }) {
  const { friends, pending, loading, fetchFriends, inviteFriend, acceptFriend, declineFriend, removeFriend, redeemInviteCode } = useFriendsStore();
  const [tab, setTab] = useState('friends');
  const [email, setEmail] = useState('');
  const [inviteCode, setInviteCode] = useState('');
  const [message, setMessage] = useState(null);
  const [sending, setSending] = useState(false);

  useEffect(() => { fetchFriends(); }, []);

  const handleInvite = async (e) => {
    e.preventDefault();
    if (!email.trim()) return;
    setSending(true);
    const result = await inviteFriend(email.trim());
    setSending(false);
    if (result.success) {
      setMessage({ type: 'success', text: 'Einladung gesendet!' });
      setEmail('');
    } else {
      setMessage({ type: 'error', text: result.error || 'Fehler beim Einladen' });
    }
    setTimeout(() => setMessage(null), 3000);
  };

  const handleRedeemCode = async (e) => {
    e.preventDefault();
    if (!inviteCode.trim()) return;
    setSending(true);
    const result = await redeemInviteCode(inviteCode.trim());
    setSending(false);
    if (result.success) {
      setMessage({ type: 'success', text: 'Einladung angenommen!' });
      setInviteCode('');
    } else {
      setMessage({ type: 'error', text: result.error || 'Ungültiger Code' });
    }
    setTimeout(() => setMessage(null), 3000);
  };

  const incomingPending = pending.filter(p => p.direction === 'incoming');
  const outgoingPending = pending.filter(p => p.direction === 'outgoing');

  return createPortal(
    <motion.div
      className="friends-overlay"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      onClick={onClose}
    >
      <motion.div
        className="friends-panel"
        initial={{ x: 300, opacity: 0 }}
        animate={{ x: 0, opacity: 1 }}
        exit={{ x: 300, opacity: 0 }}
        transition={{ type: 'spring', damping: 25 }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="friends-header">
          <h2><Users size={20} /> Freunde</h2>
          <button className="friends-close" onClick={onClose}>
            <X size={20} />
          </button>
        </div>

        <div className="friends-tabs">
          <button
            className={`friends-tab ${tab === 'friends' ? 'active' : ''}`}
            onClick={() => setTab('friends')}
          >
            <UserCheck size={16} />
            Freunde ({friends.length})
          </button>
          <button
            className={`friends-tab ${tab === 'pending' ? 'active' : ''}`}
            onClick={() => setTab('pending')}
          >
            <Clock size={16} />
            Anfragen {incomingPending.length > 0 && <span className="friends-badge">{incomingPending.length}</span>}
          </button>
          <button
            className={`friends-tab ${tab === 'invite' ? 'active' : ''}`}
            onClick={() => setTab('invite')}
          >
            <UserPlus size={16} />
            Einladen
          </button>
        </div>

        <AnimatePresence mode="wait">
          {message && (
            <motion.div
              className={`friends-message ${message.type}`}
              initial={{ opacity: 0, y: -10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
            >
              {message.text}
            </motion.div>
          )}
        </AnimatePresence>

        <div className="friends-content">
          {tab === 'friends' && (
            <div className="friends-list">
              {friends.length === 0 ? (
                <div className="friends-empty">
                  <Users size={40} strokeWidth={1.5} />
                  <p>Noch keine Freunde</p>
                  <span>Lade Freunde ein, um Tasks zu teilen</span>
                </div>
              ) : (
                friends.map((friend) => (
                  <motion.div
                    key={friend.id}
                    className="friend-card"
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    layout
                  >
                    <AvatarBadge
                      className="friend-avatar"
                      name={friend.name}
                      color={friend.avatar_color || '#007AFF'}
                      avatarUrl={friend.avatar_url}
                      size={42}
                    />
                    <div className="friend-info">
                      <span className="friend-name">{friend.name}</span>
                      <span className="friend-email">{friend.email}</span>
                    </div>
                    <button
                      className="friend-action-btn danger"
                      onClick={() => removeFriend(friend.id)}
                      title="Entfernen"
                    >
                      <Trash2 size={16} />
                    </button>
                  </motion.div>
                ))
              )}
            </div>
          )}

          {tab === 'pending' && (
            <div className="friends-list">
              {incomingPending.length > 0 && (
                <>
                  <div className="friends-section-label">Eingehend</div>
                  {incomingPending.map((req) => (
                    <motion.div
                      key={req.id}
                      className="friend-card pending"
                      initial={{ opacity: 0, y: 10 }}
                      animate={{ opacity: 1, y: 0 }}
                    >
                      <AvatarBadge
                        className="friend-avatar"
                        name={req.name}
                        color={req.avatar_color || '#FF9500'}
                        avatarUrl={req.avatar_url}
                        size={42}
                      />
                      <div className="friend-info">
                        <span className="friend-name">{req.name}</span>
                        <span className="friend-email">{req.email}</span>
                      </div>
                      <div className="friend-actions">
                        <button
                          className="friend-action-btn success"
                          onClick={() => acceptFriend(req.id)}
                          title="Annehmen"
                        >
                          <Check size={16} />
                        </button>
                        <button
                          className="friend-action-btn danger"
                          onClick={() => declineFriend(req.id)}
                          title="Ablehnen"
                        >
                          <X size={16} />
                        </button>
                      </div>
                    </motion.div>
                  ))}
                </>
              )}
              {outgoingPending.length > 0 && (
                <>
                  <div className="friends-section-label">Gesendet</div>
                  {outgoingPending.map((req) => (
                    <motion.div
                      key={req.id}
                      className="friend-card outgoing"
                      initial={{ opacity: 0, y: 10 }}
                      animate={{ opacity: 1, y: 0 }}
                    >
                      <AvatarBadge
                        className="friend-avatar"
                        name={req.name}
                        color="#8E8E93"
                        avatarUrl={req.avatar_url}
                        size={42}
                      />
                      <div className="friend-info">
                        <span className="friend-name">{req.name}</span>
                        <span className="friend-email">{req.email}</span>
                      </div>
                      <span className="friend-status-label">Ausstehend</span>
                    </motion.div>
                  ))}
                </>
              )}
              {pending.length === 0 && (
                <div className="friends-empty">
                  <Clock size={40} strokeWidth={1.5} />
                  <p>Keine Anfragen</p>
                </div>
              )}
            </div>
          )}

          {tab === 'invite' && (
            <div className="friends-invite">
              <form onSubmit={handleInvite} className="invite-form">
                <div className="invite-form-label">
                  <Mail size={16} /> Per E-Mail einladen
                </div>
                <div className="invite-input-group">
                  <input
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="freund@email.de"
                    className="invite-input"
                  />
                  <button type="submit" className="invite-btn" disabled={sending || !email.trim()}>
                    {sending ? '...' : 'Einladen'}
                  </button>
                </div>
              </form>

              <div className="invite-divider">
                <span>oder</span>
              </div>

              <form onSubmit={handleRedeemCode} className="invite-form">
                <div className="invite-form-label">
                  <Hash size={16} /> Einladungscode einlösen
                </div>
                <div className="invite-input-group">
                  <input
                    type="text"
                    value={inviteCode}
                    onChange={(e) => setInviteCode(e.target.value)}
                    placeholder="CODE123"
                    className="invite-input"
                    style={{ textTransform: 'uppercase', letterSpacing: '2px' }}
                  />
                  <button type="submit" className="invite-btn" disabled={sending || !inviteCode.trim()}>
                    {sending ? '...' : 'Einlösen'}
                  </button>
                </div>
              </form>
            </div>
          )}
        </div>
      </motion.div>
    </motion.div>,
    document.body
  );
}
