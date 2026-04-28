import { useState, useRef, useEffect, useCallback } from 'react';
import '../notif-clickable.css';
import { useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { Bell, BellRing, X, Clock, Users, CheckCircle2, Sparkles, Settings, ArrowLeft, RefreshCw, AlertCircle, Wifi, WifiOff } from 'lucide-react';
import { useNotificationStore } from '../store/notificationStore';
import { formatDistanceToNow, parseISO } from 'date-fns';
import { de } from 'date-fns/locale';

const TYPE_CONFIG = {
  reminder: { icon: Clock, color: '#FF9500', label: 'Termin-Erinnerungen', desc: 'Automatisch 5 Std. vor Terminbeginn' },
  reminder_created: { icon: Clock, color: '#FFB340', label: 'Erinnerung geplant', desc: 'Beim Setzen einer Erinnerung' },
  daily_tasks: { icon: CheckCircle2, color: '#007AFF', label: 'Tägliche Zusammenfassung', desc: 'Offene Aufgaben am Abend' },
  engagement: { icon: Sparkles, color: '#AF52DE', label: 'Motivations-Tipps', desc: 'Nach längerer Inaktivität' },
  team_task: { icon: Users, color: '#5856D6', label: 'Team-Aufgaben', desc: 'Neue Aufgaben in Gruppen' },
  team_task_created: { icon: Users, color: '#5856D6', label: 'Neue Gruppenaufgabe', desc: 'Sofort bei Erstellung in der Gruppe' },
  group_message: { icon: Users, color: '#2F80ED', label: 'Gruppennachrichten', desc: 'Neue Nachrichten im Gruppenchat' },
  test: { icon: Bell, color: '#34C759', label: 'Test', desc: 'Test-Benachrichtigung' },
};

const SETTINGS_CONFIG = [
  {
    key: 'reminder',
    icon: Clock,
    color: '#FF9500',
    label: 'Erinnerungen',
    desc: 'Termin-Erinnerung (5 Std. vorher) und Erinnerung geplant',
    prefKeys: ['reminder'],
  },
  {
    key: 'group_activity',
    icon: Users,
    color: '#2F80ED',
    label: 'Gruppen-Benachrichtigungen',
    desc: 'Neue Gruppenaufgaben und Gruppennachrichten',
    prefKeys: ['team_task', 'group_message'],
  },
  {
    key: 'daily_tasks',
    icon: CheckCircle2,
    color: '#007AFF',
    label: 'Tägliche Zusammenfassung',
    desc: 'Offene Aufgaben am Abend',
    prefKeys: ['daily_tasks'],
  },
  {
    key: 'engagement',
    icon: Sparkles,
    color: '#AF52DE',
    label: 'Motivations-Tipps',
    desc: 'Nach längerer Inaktivität',
    prefKeys: ['engagement'],
  },
];

export default function NotificationBell() {
  const navigate = useNavigate();
  const {
    permission, subscribed, notifications, prefs, loading,
    subscribe, unsubscribe, fetchLog, checkStatus, updatePref, updatePrefsBatch, deleteNotification, clearAllNotifications,
    markAsSeen, getUnseenNotifications
  } = useNotificationStore();

  const [open, setOpen] = useState(false);
  const [view, setView] = useState('list'); // 'list' | 'settings'
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [lastRefresh, setLastRefresh] = useState(null);
  const ref = useRef(null);
  const pollRef = useRef(null);

  // Aggressive polling: every 8 seconds when open, every 15 seconds when closed
  const startPolling = useCallback((fast = false) => {
    if (pollRef.current) clearInterval(pollRef.current);
    pollRef.current = setInterval(() => {
      fetchLog();
    }, fast ? 8000 : 15000);
  }, [fetchLog]);

  useEffect(() => {
    // Initial load
    checkStatus();
    fetchLog().then(() => setLastRefresh(Date.now()));
    startPolling(false);
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, []);

  useEffect(() => {
    if (open) {
      fetchLog().then(() => setLastRefresh(Date.now()));
      startPolling(true); // faster polling when open
    } else {
      startPolling(false);
    }
  }, [open]);

  // Mark as seen when dropdown closes
  useEffect(() => {
    if (!open && notifications.length > 0) {
      markAsSeen();
    }
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

  const handleManualRefresh = async () => {
    setIsRefreshing(true);
    await fetchLog();
    setLastRefresh(Date.now());
    setTimeout(() => setIsRefreshing(false), 600);
  };

  const handleSubscribeClick = async () => {
    const ok = await subscribe();
    if (ok) {
      // After subscribing, immediately send token to SW
      const token = localStorage.getItem('token');
      if (token && navigator.serviceWorker?.controller) {
        navigator.serviceWorker.controller.postMessage({ type: 'SET_AUTH_TOKEN', token });
      }
    }
  };

  const handleToggleSetting = async (setting) => {
    const prefKeys = Array.isArray(setting.prefKeys) ? setting.prefKeys : [setting.key];
    const isEnabled = prefKeys.every((k) => prefs[k] !== false);
    const nextValue = !isEnabled;

    if (prefKeys.length === 1) {
      await updatePref(prefKeys[0], nextValue);
      return;
    }

    const patch = {};
    for (const k of prefKeys) patch[k] = nextValue;
    await updatePrefsBatch(patch);
  };

  const handleDeleteNotification = async (id) => {
    await deleteNotification(id);
  };

  const handleClearAll = async () => {
    await clearAllNotifications();
  };

  const unseenNotifications = getUnseenNotifications();
  const unseenCount = unseenNotifications.length;
  const allNotifications = notifications || [];

  // Sort: newest first
  const sortedNotifications = [...allNotifications].sort(
    (a, b) => new Date(b.sent_at) - new Date(a.sent_at)
  );

  const pushStatus = (() => {
    if (permission === 'denied') return { ok: false, label: 'Blockiert', color: '#FF3B30' };
    if (!subscribed) return { ok: false, label: 'Nicht aktiviert', color: '#FF9500' };
    return { ok: true, label: 'Aktiv', color: '#34C759' };
  })();

  // Handler für Klick auf Notification
  const handleNotificationClick = (n) => {
    // Routing je nach Typ und ID
    if (n.task_id) {
      navigate(`/app/tasks/${n.task_id}`);
      setOpen(false);
      return;
    }
    if (n.event_id) {
      navigate(`/app/calendar/${n.event_id}`);
      setOpen(false);
      return;
    }
    if (n.chat_id) {
      navigate(`/app/chat/${n.chat_id}`);
      setOpen(false);
      return;
    }
    // Fallback: keine ID, kein Routing
  };

  return (
    <div className="notif-wrap" ref={ref}>
      <button className="notif-bell" onClick={handleToggle} aria-label="Benachrichtigungen">
        {unseenCount > 0 ? <BellRing size={20} /> : <Bell size={20} />}
        {unseenCount > 0 && (
          <span className="notif-badge">{unseenCount > 9 ? '9+' : unseenCount}</span>
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
              <div style={{ display: 'flex', gap: 4, marginLeft: 'auto', alignItems: 'center' }}>
                {view === 'list' && (
                  <>
                    <button
                      className="notif-clear-all"
                      onClick={handleClearAll}
                      aria-label="Alle Benachrichtigungen löschen"
                      title="Alle löschen"
                      disabled={sortedNotifications.length === 0}
                    >
                      Alle löschen
                    </button>
                    <button
                      className="notif-settings-btn"
                      onClick={handleManualRefresh}
                      aria-label="Aktualisieren"
                      title="Jetzt aktualisieren"
                      style={{ opacity: isRefreshing ? 0.5 : 1 }}
                    >
                      <RefreshCw size={15} style={{ animation: isRefreshing ? 'spin 0.6s linear infinite' : 'none' }} />
                    </button>
                    <button className="notif-settings-btn" onClick={() => setView('settings')} aria-label="Einstellungen">
                      <Settings size={16} />
                    </button>
                  </>
                )}
                <button className="notif-close" onClick={() => setOpen(false)}>
                  <X size={16} />
                </button>
              </div>
            </div>

            {/* ─── Settings View ─── */}
            {view === 'settings' && (
              <div className="notif-settings">
                {/* Push Status Banner */}
                <div className="notif-status-banner" style={{
                  background: pushStatus.ok ? '#34C75915' : '#FF950015',
                  border: `1px solid ${pushStatus.ok ? '#34C75940' : '#FF950040'}`,
                  borderRadius: 10,
                  padding: '10px 12px',
                  marginBottom: 12,
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                }}>
                  {pushStatus.ok
                    ? <Wifi size={16} style={{ color: '#34C759', flexShrink: 0 }} />
                    : <WifiOff size={16} style={{ color: '#FF9500', flexShrink: 0 }} />
                  }
                  <div>
                    <div style={{ fontSize: 13, fontWeight: 600, color: pushStatus.color }}>{pushStatus.label}</div>
                    {!pushStatus.ok && permission !== 'denied' && (
                      <div style={{ fontSize: 11, color: 'var(--text-secondary)', marginTop: 2 }}>
                        Aktiviere Push um Benachrichtigungen bei geschlossener App zu erhalten
                      </div>
                    )}
                    {permission === 'denied' && (
                      <div style={{ fontSize: 11, color: 'var(--text-secondary)', marginTop: 2 }}>
                        In Browser-Einstellungen für diese Seite erlauben
                      </div>
                    )}
                  </div>
                </div>

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
                    onClick={() => subscribed ? unsubscribe() : handleSubscribeClick()}
                    disabled={permission === 'denied'}
                  >
                    <span className="notif-toggle-knob" />
                  </button>
                </div>

                {/* Per-Type Toggles */}
                <div className="notif-types-label">Benachrichtigungstypen</div>
                {SETTINGS_CONFIG.map((cfg) => {
                  const Icon = cfg.icon;
                  const prefKeys = Array.isArray(cfg.prefKeys) ? cfg.prefKeys : [cfg.key];
                  const enabled = prefKeys.every((k) => prefs[k] !== false);
                  return (
                    <div key={cfg.key} className={`notif-type-row ${!subscribed ? 'disabled' : ''}`}>
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
                        onClick={() => handleToggleSetting(cfg)}
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
                {/* Subscribe Prompt – shown when not subscribed */}
                {!subscribed && (
                  <div className="notif-perm" style={{
                    background: 'linear-gradient(135deg, #FF950010, #FF600010)',
                    border: '1px solid #FF950030',
                    borderRadius: 12,
                    margin: '0 12px 8px',
                    padding: '10px 12px',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 10,
                  }}>
                    <AlertCircle size={18} style={{ color: '#FF9500', flexShrink: 0 }} />
                    <div style={{ flex: 1 }}>
                      <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 4 }}>Push nicht aktiviert</div>
                      <div style={{ fontSize: 11, color: 'var(--text-secondary)', marginBottom: 6 }}>
                        Ohne Push bekommst du keine Benachrichtigungen bei geschlossener App
                      </div>
                      <button
                        className="notif-perm-btn"
                        onClick={handleSubscribeClick}
                        style={{ fontSize: 12, padding: '5px 12px' }}
                      >
                        Push jetzt aktivieren
                      </button>
                    </div>
                  </div>
                )}

                {/* Notification List */}
                <div className="notif-list">
                  {loading && sortedNotifications.length === 0 ? (
                    <div className="notif-empty">
                      <RefreshCw size={24} strokeWidth={1.5} style={{ animation: 'spin 1s linear infinite', opacity: 0.5 }} />
                      <span>Laden…</span>
                    </div>
                  ) : sortedNotifications.length === 0 ? (
                    <div className="notif-empty">
                      <Bell size={28} strokeWidth={1.5} />
                      <span>Keine Benachrichtigungen</span>
                      <button
                        onClick={handleManualRefresh}
                        style={{
                          marginTop: 8,
                          fontSize: 12,
                          color: 'var(--primary)',
                          background: 'none',
                          border: 'none',
                          cursor: 'pointer',
                          textDecoration: 'underline',
                        }}
                      >
                        Aktualisieren
                      </button>
                    </div>
                  ) : (
                    sortedNotifications.map((n) => {
                      const config = TYPE_CONFIG[n.type] || TYPE_CONFIG.reminder;
                      const Icon = config.icon;
                      const isUnseen = new Date(n.sent_at).getTime() > (useNotificationStore.getState().lastSeenAt || 0);
                      return (
                        <div
                          key={n.id}
                          className={`notif-item ${isUnseen ? 'notif-item-unseen' : ''} ${n.task_id || n.event_id || n.chat_id ? 'notif-item-clickable' : ''}`}
                          style={n.task_id || n.event_id || n.chat_id ? { cursor: 'pointer' } : {}}
                          onClick={() => (n.task_id || n.event_id || n.chat_id) && handleNotificationClick(n)}
                        >
                          <div className="notif-item-icon" style={{ background: `${config.color}15`, color: config.color }}>
                            <Icon size={16} />
                          </div>
                          <div className="notif-item-body">
                            <div className="notif-item-title" style={{ fontSize: 12, fontWeight: 600, marginBottom: 2 }}>
                              {n.title}
                            </div>
                            <div className="notif-item-text">{n.body}</div>
                            <div className="notif-item-time">
                              {formatDistanceToNow(parseISO(n.sent_at), { addSuffix: true, locale: de })}
                            </div>
                          </div>
                          <button
                            className="notif-item-delete"
                            aria-label="Benachrichtigung löschen"
                            title="Löschen"
                            onClick={e => { e.stopPropagation(); handleDeleteNotification(n.id); }}
                          >
                            <X size={12} />
                          </button>
                          {isUnseen && <div className="notif-unseen-dot" />}
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
