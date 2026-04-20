import { useState, useRef, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Bell, BellRing, X, Clock, Users, CheckCircle2, Sparkles, Settings, ArrowLeft } from 'lucide-react';
import { useNotificationStore } from '../store/notificationStore';
import { formatDistanceToNow, parseISO } from 'date-fns';
import { de } from 'date-fns/locale';

const TYPE_CONFIG = {
  reminder: { icon: Clock, color: '#FF9500', label: 'Termin-Erinnerungen', desc: 'Wenn ein Termin ansteht' },
  daily_tasks: { icon: CheckCircle2, color: '#007AFF', label: 'Tägliche Zusammenfassung', desc: 'Offene Aufgaben am Abend' },
  engagement: { icon: Sparkles, color: '#AF52DE', label: 'Motivations-Tipps', desc: 'Nach längerer Inaktivität' },
  team_task: { icon: Users, color: '#5856D6', label: 'Team-Aufgaben', desc: 'Neue Aufgaben in Gruppen' },
};

export default function NotificationBell() {
  const { permission, subscribed, notifications, prefs, subscribe, unsubscribe, fetchLog, checkStatus, updatePref } = useNotificationStore();
  const [open, setOpen] = useState(false);
  const [view, setView] = useState('list'); // 'list' | 'settings'
  const ref = useRef(null);

  useEffect(() => {
    checkStatus();
  }, []);

  useEffect(() => {
    if (open) fetchLog();
  }, [open]);

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    const handler = (e) => {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    document.addEventListener('touchstart', handler);
    return () => {
      document.removeEventListener('mousedown', handler);
      document.removeEventListener('touchstart', handler);
    };
  }, [open]);

  const handleToggle = async () => {
    if (!subscribed && permission !== 'granted') {
      await subscribe();
    }
    setOpen((v) => !v);
    if (!open) setView('list');
  };

  const recentCount = notifications.filter((n) => {
    const sent = new Date(n.sent_at);
    const ago = Date.now() - sent.getTime();
    return ago < 24 * 60 * 60 * 1000; // last 24h
  }).length;

  return (
    <div className="notif-wrap" ref={ref}>
      <button className="notif-bell" onClick={handleToggle} aria-label="Benachrichtigungen">
        {recentCount > 0 ? <BellRing size={20} /> : <Bell size={20} />}
        {recentCount > 0 && (
          <span className="notif-badge">{recentCount > 9 ? '9+' : recentCount}</span>
        )}
      </button>

      <AnimatePresence>
        {open && (
          <motion.div
            className="notif-dropdown"
            initial={{ opacity: 0, y: -8, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -8, scale: 0.95 }}
            transition={{ duration: 0.15 }}
          >
            <div className="notif-header">
              {view === 'settings' && (
                <button className="notif-back" onClick={() => setView('list')}>
                  <ArrowLeft size={16} />
                </button>
              )}
              <span className="notif-title">
                {view === 'settings' ? 'Einstellungen' : 'Benachrichtigungen'}
              </span>
              <div style={{ display: 'flex', gap: 4, marginLeft: 'auto' }}>
                {view === 'list' && (
                  <button className="notif-settings-btn" onClick={() => setView('settings')} aria-label="Einstellungen">
                    <Settings size={16} />
                  </button>
                )}
                <button className="notif-close" onClick={() => setOpen(false)}>
                  <X size={16} />
                </button>
              </div>
            </div>

            {/* ─── Settings View ─── */}
            {view === 'settings' && (
              <div className="notif-settings">
                {/* Master Toggle */}
                <div className="notif-master">
                  <div className="notif-master-info">
                    <BellRing size={18} />
                    <div>
                      <div className="notif-master-label">Push-Benachrichtigungen</div>
                      <div className="notif-master-desc">{subscribed ? 'Aktiv auf diesem Gerät' : 'Nicht aktiviert'}</div>
                    </div>
                  </div>
                  <button
                    className={`notif-toggle-master ${subscribed ? 'active' : ''}`}
                    onClick={() => subscribed ? unsubscribe() : subscribe()}
                  >
                    <span className="notif-toggle-knob" />
                  </button>
                </div>

                {/* Per-Type Toggles */}
                <div className="notif-types-label">Benachrichtigungstypen</div>
                {Object.entries(TYPE_CONFIG).map(([key, cfg]) => {
                  const Icon = cfg.icon;
                  const enabled = prefs[key] !== false;
                  return (
                    <div key={key} className={`notif-type-row ${!subscribed ? 'disabled' : ''}`}>
                      <div className="notif-type-icon" style={{ background: `${cfg.color}15`, color: cfg.color }}>
                        <Icon size={16} />
                      </div>
                      <div className="notif-type-info">
                        <div className="notif-type-name">{cfg.label}</div>
                        <div className="notif-type-desc">{cfg.desc}</div>
                      </div>
                      <button
                        className={`notif-toggle ${enabled ? 'active' : ''}`}
                        disabled={!subscribed}
                        onClick={() => updatePref(key, !enabled)}
                      >
                        <span className="notif-toggle-knob" />
                      </button>
                    </div>
                  );
                })}
              </div>
            )}

            {/* ─── List View ─── */}
            {view === 'list' && (
              <>
                {/* Permission / Subscribe Prompt */}
                {!subscribed && (
                  <div className="notif-perm">
                    <p>Erhalte Erinnerungen direkt auf dein Gerät</p>
                    <button className="notif-perm-btn" onClick={subscribe}>
                      Push aktivieren
                    </button>
                  </div>
                )}

                {/* Notification List */}
                <div className="notif-list">
                  {notifications.length === 0 ? (
                    <div className="notif-empty">
                      <Bell size={28} strokeWidth={1.5} />
                      <span>Noch keine Benachrichtigungen</span>
                    </div>
                  ) : (
                    notifications.map((n) => {
                      const config = TYPE_CONFIG[n.type] || TYPE_CONFIG.reminder;
                      const Icon = config.icon;
                      return (
                        <div key={n.id} className="notif-item">
                          <div className="notif-item-icon" style={{ background: `${config.color}15`, color: config.color }}>
                            <Icon size={16} />
                          </div>
                          <div className="notif-item-body">
                            <div className="notif-item-text">{n.body}</div>
                            <div className="notif-item-time">
                              {formatDistanceToNow(parseISO(n.sent_at), { addSuffix: true, locale: de })}
                            </div>
                          </div>
                        </div>
                      );
                    })
                  )}
                </div>
              </>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
