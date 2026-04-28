import { useState, useEffect, useRef } from 'react';
import Confetti from '../components/Confetti';
import { useAuthStore } from '../store/authStore';
import { api } from '../utils/api';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Camera, User, Mail, Lock, Shield, ShieldCheck, ShieldOff, Palette, Download,
  Trash2, Check, X, ChevronRight, AlertTriangle, Flame,
  Target, Calendar, CheckCircle2, Clock, TrendingUp,
  Award, Star, Edit3, Eye, EyeOff, ArrowLeft, MessageCircleQuestion, Video, QrCode
} from 'lucide-react';
import { format, parseISO } from 'date-fns';
import { de } from 'date-fns/locale';

const PROFILE_CACHE_KEY = 'beequ_profile_cache_v1';

function readProfileCache() {
  try {
    const raw = localStorage.getItem(PROFILE_CACHE_KEY);
    const parsed = raw ? JSON.parse(raw) : null;
    if (!parsed || typeof parsed !== 'object') return null;
    return {
      profile: parsed.profile || null,
      stats: parsed.stats || null,
    };
  } catch {
    return null;
  }
}

function writeProfileCache(profile, stats) {
  try {
    localStorage.setItem(PROFILE_CACHE_KEY, JSON.stringify({ profile: profile || null, stats: stats || null }));
  } catch {
    // ignore
  }
}

const AVATAR_COLORS = [
  '#007AFF', '#5856D6', '#AF52DE', '#FF2D55', '#FF3B30',
  '#FF9500', '#FFCC00', '#34C759', '#00C7BE', '#30B0C7',
  '#5AC8FA', '#FF6482', '#8E8E93', '#1C1C1E',
];

export default function ProfilePage() {
  const { user, logout, setUser } = useAuthStore();
  const initialCached = readProfileCache();
  const [profile, setProfile] = useState(initialCached?.profile || user || null);
  const [stats, setStats] = useState(initialCached?.stats || null);
  const [loading, setLoading] = useState(!(initialCached?.profile || user));

  // Level-Up Animation State
  const [showConfetti, setShowConfetti] = useState(false);
  const [glowLevel, setGlowLevel] = useState(false);
  const prevLevelRef = useRef(null);

  // Edit states
  const [editName, setEditName] = useState(false);
  const [nameValue, setNameValue] = useState('');
  const [editBio, setEditBio] = useState(false);
  const [bioValue, setBioValue] = useState('');

  // Password
  const [showPasswordForm, setShowPasswordForm] = useState(false);
  const [currentPw, setCurrentPw] = useState('');
  const [newPw, setNewPw] = useState('');
  const [confirmPw, setConfirmPw] = useState('');
  const [showCurrentPw, setShowCurrentPw] = useState(false);
  const [showNewPw, setShowNewPw] = useState(false);

  // 2FA
  const [twofa, setTwofa]               = useState({ enabled: false });
  const [show2FASetup, setShow2FASetup] = useState(false);
  const [show2FADisable, setShow2FADisable] = useState(false);
  const [tfaSetupData, setTfaSetupData] = useState(null); // { secret, otpauth }
  const [tfaCode, setTfaCode]           = useState('');
  const [tfaLoading, setTfaLoading]     = useState(false);
  const [tfaError, setTfaError]         = useState('');

  // Delete
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [deletePw, setDeletePw] = useState('');

  // Visibility
  const [visibility, setVisibility] = useState('everyone');
  const [savingVisibility, setSavingVisibility] = useState(false);

  // Teams
  const [teamsConnected, setTeamsConnected] = useState(null);
  const [teamsConnecting, setTeamsConnecting] = useState(false);

  // Feedback
  const [toast, setToast] = useState(null);
  const [saving, setSaving] = useState(false);

  const fileInputRef = useRef(null);

  const { refreshUser } = useAuthStore.getState();
  useEffect(() => {
    // Nach jedem Mount: User-Status frisch laden
    (async () => {
      await refreshUser();
      await loadProfile();
    })();
    api.getTeamsStatus().then((d) => setTeamsConnected(d.connected)).catch(() => setTeamsConnected(false));

    // Handle OAuth callback result
    const params = new URLSearchParams(window.location.search);
    if (params.get('teams_connected')) {
      showToast('✅ Microsoft-Konto erfolgreich verbunden');
      setTeamsConnected(true);
      window.history.replaceState({}, '', window.location.pathname);
    } else if (params.get('teams_error')) {
      showToast('❌ Microsoft-Verbindung fehlgeschlagen: ' + params.get('teams_error'), 'error');
      window.history.replaceState({}, '', window.location.pathname);
    }
  }, []);

  const showToast = (message, type = 'success') => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 3000);
  };

  const start2FASetup = async () => {
    setTfaLoading(true); setTfaError('');
    try {
      const data = await api.setup2FA();
      setTfaSetupData(data);
      setShow2FASetup(true);
      setTfaCode('');
      // Nach Setup: User-Status frisch laden
      await refreshUser();
    } catch (e) { setTfaError(e.message); }
    finally { setTfaLoading(false); }
  };

  const confirm2FA = async () => {
    if (tfaCode.length !== 6) { setTfaError('Bitte 6-stelligen Code eingeben'); return; }
    setTfaLoading(true); setTfaError('');
    try {
      await api.confirm2FA(tfaCode);
      setTwofa({ enabled: true });
      setShow2FASetup(false);
      setTfaSetupData(null);
      setTfaCode('');
      showToast('✅ 2FA erfolgreich aktiviert');
      // Nach Bestätigung: User-Status frisch laden
      await refreshUser();
    } catch (e) { setTfaError(e.message); }
    finally { setTfaLoading(false); }
  };

  const disable2FA = async () => {
    if (tfaCode.length !== 6) { setTfaError('Bitte 6-stelligen Code eingeben'); return; }
    setTfaLoading(true); setTfaError('');
    try {
      await api.disable2FA(tfaCode);
      setTwofa({ enabled: false });
      setShow2FADisable(false);
      setTfaCode('');
      showToast('2FA deaktiviert');
      // Nach Deaktivierung: User-Status frisch laden
      await refreshUser();
    } catch (e) { setTfaError(e.message); }
    finally { setTfaLoading(false); }
  };

  const loadProfile = async () => {
    try {
      const data = await api.getProfile();
      setProfile(data.user);
      setStats(data.stats);
      writeProfileCache(data.user, data.stats);
      setNameValue(data.user.name || '');
      setBioValue(data.user.bio || '');
      setVisibility(data.user.profile_visibility || 'everyone');
      setTwofa({ enabled: !!data.user.twofa_enabled });
    } catch (err) {
      showToast('Profil konnte nicht geladen werden', 'error');
    } finally {
      setLoading(false);
    }
  };

  const handleAvatarUpload = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!file.type.startsWith('image/')) {
      showToast('Bitte wähle ein Bild aus', 'error');
      return;
    }

    if (file.size > 10 * 1024 * 1024) {
      showToast('Bild zu groß (max. 10MB)', 'error');
      return;
    }

    const reader = new FileReader();
    reader.onload = async () => {
      try {
        setSaving(true);
        // Resize image to max 200x200
        const resized = await resizeImage(reader.result, 400);
        await api.updateAvatar(resized);
        setProfile(prev => {
          const next = { ...prev, avatar_url: resized };
          setUser(next);
          writeProfileCache(next, stats);
          return next;
        });
        showToast('Profilbild aktualisiert');
      } catch (err) {
        showToast(err.message, 'error');
      } finally {
        setSaving(false);
      }
    };
    reader.readAsDataURL(file);
  };

  const resizeImage = (dataUrl, maxSize) => {
    return new Promise((resolve) => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement('canvas');
        let w = img.width, h = img.height;
        if (w > h) { h = (h / w) * maxSize; w = maxSize; }
        else { w = (w / h) * maxSize; h = maxSize; }
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, w, h);
        resolve(canvas.toDataURL('image/jpeg', 0.85));
      };
      img.src = dataUrl;
    });
  };

  const removeAvatar = async () => {
    try {
      setSaving(true);
      await api.updateAvatar(null);
      setProfile(prev => {
        const next = { ...prev, avatar_url: null };
        setUser(next);
        writeProfileCache(next, stats);
        return next;
      });
      showToast('Profilbild entfernt');
    } catch (err) {
      showToast(err.message, 'error');
    } finally {
      setSaving(false);
    }
  };

  const saveName = async () => {
    if (!nameValue.trim()) return;
    try {
      setSaving(true);
      const data = await api.updateProfile({ name: nameValue.trim() });
      setProfile(prev => {
        const next = { ...prev, name: data.user.name };
        writeProfileCache(next, stats);
        return next;
      });
      setUser(data.user);
      if (data.token) localStorage.setItem('token', data.token);
      setEditName(false);
      showToast('Name aktualisiert');
    } catch (err) {
      showToast(err.message, 'error');
    } finally {
      setSaving(false);
    }
  };

  const saveBio = async () => {
    try {
      setSaving(true);
      const data = await api.updateProfile({ bio: bioValue });
      setProfile(prev => {
        const next = { ...prev, bio: data.user.bio };
        writeProfileCache(next, stats);
        return next;
      });
      setEditBio(false);
      showToast('Bio aktualisiert');
    } catch (err) {
      showToast(err.message, 'error');
    } finally {
      setSaving(false);
    }
  };

  const changeColor = async (color) => {
    try {
      const data = await api.updateProfile({ avatar_color: color });
      setProfile(prev => {
        const next = { ...prev, avatar_color: color };
        writeProfileCache(next, stats);
        return next;
      });
      setUser(data.user);
      if (data.token) localStorage.setItem('token', data.token);
    } catch (err) {
      showToast(err.message, 'error');
    }
  };

  const changePassword = async (e) => {
    e.preventDefault();
    if (newPw !== confirmPw) {
      showToast('Passwörter stimmen nicht überein', 'error');
      return;
    }
    try {
      setSaving(true);
      const res = await api.changePassword(currentPw, newPw);
      setShowPasswordForm(false);
      setCurrentPw('');
      setNewPw('');
      setConfirmPw('');
      if (res && res.success) {
        showToast('Bitte bestätige die Änderung per Link in deiner E-Mail.');
      } else {
        showToast(res?.message || 'Bitte bestätige die Änderung per E-Mail.', 'info');
      }
    } catch (err) {
      showToast(err.message, 'error');
    } finally {
      setSaving(false);
    }
  };

  const exportData = async () => {
    try {
      const data = await api.exportProfile();
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `beequ-export-${format(new Date(), 'yyyy-MM-dd')}.json`;
      a.click();
      URL.revokeObjectURL(url);
      showToast('Daten exportiert');
    } catch (err) {
      showToast(err.message, 'error');
    }
  };

  const saveVisibility = async (val) => {
    setVisibility(val);
    setSavingVisibility(true);
    try {
      await api.updateVisibility(val);
      setProfile((prev) => {
        const next = prev ? { ...prev, profile_visibility: val } : prev;
        writeProfileCache(next, stats);
        return next;
      });
      showToast('Sichtbarkeit gespeichert');
    } catch (err) {
      showToast(err.message, 'error');
    } finally {
      setSavingVisibility(false);
    }
  };

  const deleteAccount = async () => {
    if (!deletePw) {
      showToast('Passwort eingeben', 'error');
      return;
    }
    try {
      setSaving(true);
      await api.deleteAccount(deletePw);
      logout();
    } catch (err) {
      showToast(err.message, 'error');
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="profile-loading">
        <div className="spinner" />
        <p>Profil laden...</p>
      </div>
    );
  }

  const memberSince = profile?.created_at
    ? format(parseISO(profile.created_at), 'd. MMMM yyyy', { locale: de })
    : '';

  const level = stats ? Math.floor(stats.completed_tasks / 10) + 1 : 1;
  const xpProgress = stats ? (stats.completed_tasks % 10) * 10 : 0;

  // Level-Up Effekt: Konfetti, Sound, Glow
  useEffect(() => {
    if (prevLevelRef.current === null) {
      prevLevelRef.current = level;
      return;
    }
    if (level > prevLevelRef.current) {
      setShowConfetti(true);
      setGlowLevel(true);
      // Sound abspielen
      try {
        const audio = new Audio('/levelup.mp3');
        audio.volume = 0.5;
        audio.play();
      } catch {}
      setTimeout(() => setGlowLevel(false), 1800);
    }
    prevLevelRef.current = level;
  }, [level]);

  /* ─── NEW RETURN ─── */
  return (
    <div className="pv2">

      {/* ═══ LEFT PANEL ═══ */}
      <aside className="pv2-left">

        {/* Hero card — avatar + name + bio */}
        <div className="pv2-card pv2-hero">
          <motion.div className="pv2-avatar-wrap" whileTap={{ scale: 0.95 }}
            onClick={() => fileInputRef.current?.click()}>
            {profile?.avatar_url
              ? <img src={profile.avatar_url} alt="Avatar" className="pv2-avatar-img" />
              : <div className="pv2-avatar-placeholder" style={{ background: profile?.avatar_color || '#007AFF' }}>
                  {profile?.name?.[0]?.toUpperCase() || '?'}
                </div>
            }
            <div className="pv2-avatar-overlay"><Camera size={18} /></div>
            <input ref={fileInputRef} type="file" accept="image/*"
              onChange={handleAvatarUpload} style={{ display: 'none' }} />
          </motion.div>
          {profile?.avatar_url && (
            <button className="pv2-remove-avatar" onClick={removeAvatar}>Entfernen</button>
          )}

          {editName ? (
            <div className="pv2-inline-edit">
              <input value={nameValue} onChange={e => setNameValue(e.target.value)}
                className="pv2-inline-input" maxLength={50} autoFocus
                onKeyDown={e => e.key === 'Enter' && saveName()} />
              <button className="pv2-inline-btn save" onClick={saveName} disabled={saving}><Check size={15} /></button>
              <button className="pv2-inline-btn cancel" onClick={() => { setEditName(false); setNameValue(profile.name); }}><X size={15} /></button>
            </div>
          ) : (
            <div className="pv2-name-row">
              <h2 className="pv2-name">{profile?.name}</h2>
              <button className="pv2-edit-btn" onClick={() => setEditName(true)}><Edit3 size={13} /></button>
            </div>
          )}

          <div className="pv2-email"><Mail size={13} />{profile?.email}</div>

          {editBio ? (
            <div className="pv2-inline-edit">
              <textarea value={bioValue} onChange={e => setBioValue(e.target.value)}
                className="pv2-inline-input bio" maxLength={200} rows={2}
                placeholder="Kurze Bio..." autoFocus />
              <button className="pv2-inline-btn save" onClick={saveBio} disabled={saving}><Check size={15} /></button>
              <button className="pv2-inline-btn cancel" onClick={() => { setEditBio(false); setBioValue(profile?.bio || ''); }}><X size={15} /></button>
            </div>
          ) : (
            <div className="pv2-bio-row" onClick={() => setEditBio(true)}>
              <p className="pv2-bio">{profile?.bio || 'Bio hinzufügen…'}</p>
              <Edit3 size={12} className="pv2-bio-icon" />
            </div>
          )}

          <div className="pv2-meta-row">
            <span className="pv2-meta-pill"><Calendar size={12} />Seit {memberSince}</span>
            <span className="pv2-meta-pill"><Star size={12} />Level {level}</span>
          </div>
          <div className="pv2-xp-bar-wrap">
            <div className="pv2-xp-bar">
              <motion.div className="pv2-xp-fill"
                initial={{ width: 0 }} animate={{ width: `${xpProgress}%` }}
                transition={{ duration: 0.8 }} />
            </div>
            <span className="pv2-xp-label">{xpProgress}% zu Level {level + 1}</span>
          </div>
        </div>

        {/* Stats */}
        {stats && (
          <div className="pv2-card">
            <div className="pv2-section-head"><Target size={15} /><span>Statistiken</span></div>
            <div className="pv2-stats-grid">
              {[
                { icon: Target,       color: '#007AFF', bg: 'rgba(0,122,255,0.1)',  val: stats.total_tasks,        label: 'Gesamt'   },
                { icon: CheckCircle2, color: '#34C759', bg: 'rgba(52,199,89,0.1)',  val: stats.completed_tasks,    label: 'Erledigt' },
                { icon: Flame,        color: '#FF9500', bg: 'rgba(255,149,0,0.1)',  val: stats.streak,             label: 'Streak'   },
                { icon: TrendingUp,   color: '#5856D6', bg: 'rgba(88,86,214,0.1)', val: `${stats.completion_rate}%`, label: 'Quote'  },
              ].map(({ icon: Icon, color, bg, val, label }) => (
                <div key={label} className="pv2-stat">
                  <div className="pv2-stat-icon" style={{ background: bg, color }}><Icon size={16} /></div>
                  <div className="pv2-stat-val">{val}</div>
                  <div className="pv2-stat-label">{label}</div>
                </div>
              ))}
            </div>
            <div className="pv2-ring-wrap">
              <div className="pv2-ring-container">
                <svg viewBox="0 0 120 120" className="pv2-ring">
                  <circle cx="60" cy="60" r="52" fill="none" stroke="rgba(0,0,0,0.06)" strokeWidth="10"/>
                  <motion.circle cx="60" cy="60" r="52" fill="none" stroke="var(--primary)" strokeWidth="10"
                    strokeLinecap="round" strokeDasharray={`${2*Math.PI*52}`}
                    initial={{ strokeDashoffset: 2*Math.PI*52 }}
                    animate={{ strokeDashoffset: 2*Math.PI*52*(1-stats.completion_rate/100) }}
                    transition={{ duration: 1.2, ease: 'easeOut' }} transform="rotate(-90 60 60)" />
                </svg>
                <div className="pv2-ring-center">
                  <span className="pv2-ring-val">{stats.completion_rate}%</span>
                  <span className="pv2-ring-label">Produktivität</span>
                </div>
              </div>
              <div className="pv2-ring-details">
                <div className="pv2-ring-item"><Clock size={13} />{stats.week_completed} diese Woche</div>
                <div className="pv2-ring-item"><Calendar size={13} />{stats.active_days} aktive Tage</div>
                <div className="pv2-ring-item"><Award size={13} />Mitglied seit {memberSince}</div>
              </div>
            </div>
            {stats.category_breakdown?.length > 0 && (
              <div className="pv2-cats">
                <div className="pv2-cats-label">Top Kategorien</div>
                {stats.category_breakdown.map((cat, i) => (
                  <div key={i} className="pv2-cat-row">
                    <div className="pv2-cat-info">
                      <span className="pv2-cat-dot" style={{ background: cat.color }} />
                      <span className="pv2-cat-name">{cat.name}</span>
                      <span className="pv2-cat-count">{cat.done}/{cat.count}</span>
                    </div>
                    <div className="pv2-cat-track">
                      <motion.div className="pv2-cat-fill" style={{ background: cat.color }}
                        initial={{ width: 0 }}
                        animate={{ width: `${cat.count > 0 ? (cat.done/cat.count)*100 : 0}%` }}
                        transition={{ duration: 0.8, delay: i*0.1 }} />
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Avatar color */}
        <div className="pv2-card">
          <div className="pv2-section-head"><Palette size={15} /><span>Avatar-Farbe</span></div>
          <div className="pv2-color-grid">
            {AVATAR_COLORS.map(color => (
              <motion.button key={color} className={`pv2-color-btn ${profile?.avatar_color === color ? 'active' : ''}`}
                style={{ background: color }} onClick={() => changeColor(color)} whileTap={{ scale: 0.85 }}>
                {profile?.avatar_color === color && <Check size={12} color="#fff" />}
              </motion.button>
            ))}
          </div>
        </div>

      </aside>

      {/* ═══ RIGHT PANEL ═══ */}
      <main className="pv2-right">

        {/* Security */}
        <div className="pv2-card">
          <div className="pv2-section-head"><Lock size={15} /><span>Sicherheit</span></div>

          {/* Password */}
          <button className="pv2-row" onClick={() => setShowPasswordForm(!showPasswordForm)}>
            <div className="pv2-row-icon" style={{ background: 'rgba(88,86,214,0.1)', color: '#5856D6' }}><Lock size={16} /></div>
            <div className="pv2-row-body"><span className="pv2-row-title">Passwort ändern</span><span className="pv2-row-sub">Sicherheit deines Kontos</span></div>
            <ChevronRight size={16} className={`pv2-chevron ${showPasswordForm ? 'open' : ''}`} />
          </button>
          <AnimatePresence>
            {showPasswordForm && (
              <motion.form className="pv2-expand" onSubmit={changePassword}
                initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }}
                exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.22 }}>
                <div className="pv2-form-inner">
                  {[
                    { label: 'Aktuelles Passwort', val: currentPw, set: setCurrentPw, show: showCurrentPw, toggle: () => setShowCurrentPw(!showCurrentPw) },
                    { label: 'Neues Passwort',     val: newPw,     set: setNewPw,     show: showNewPw,     toggle: () => setShowNewPw(!showNewPw) },
                  ].map(({ label, val, set, show, toggle }) => (
                    <div key={label} className="pv2-field">
                      <label>{label}</label>
                      <div className="pv2-pw-wrap">
                        <input type={show ? 'text' : 'password'} value={val}
                          onChange={e => set(e.target.value)} required minLength={6} />
                        <button type="button" className="pv2-pw-eye" onClick={toggle}>
                          {show ? <EyeOff size={15} /> : <Eye size={15} />}
                        </button>
                      </div>
                    </div>
                  ))}
                  <div className="pv2-field">
                    <label>Passwort bestätigen</label>
                    <input type="password" value={confirmPw} onChange={e => setConfirmPw(e.target.value)} required minLength={6} />
                  </div>
                  <button type="submit" className="pv2-btn primary" disabled={saving}>
                    {saving ? 'Speichern…' : 'Passwort ändern'}
                  </button>
                </div>
              </motion.form>
            )}
          </AnimatePresence>

          {/* 2FA */}
          <button className="pv2-row" onClick={() => {
            if (twofa.enabled) { setShow2FADisable(!show2FADisable); setShow2FASetup(false); setTfaCode(''); setTfaError(''); }
            else start2FASetup();
          }}>
            <div className="pv2-row-icon" style={{ background: twofa.enabled ? 'rgba(52,199,89,0.12)' : 'rgba(255,149,0,0.1)', color: twofa.enabled ? '#34C759' : '#FF9500' }}>
              {twofa.enabled ? <ShieldCheck size={16} /> : <ShieldOff size={16} />}
            </div>
            <div className="pv2-row-body">
              <span className="pv2-row-title">
                Zwei-Faktor-Authentifizierung
                {twofa.enabled && <span className="pv2-badge green">Aktiv</span>}
              </span>
              <span className="pv2-row-sub">{twofa.enabled ? 'Authenticator-App aktiv' : 'Zusätzlicher Schutz via Authenticator'}</span>
            </div>
            {tfaLoading
              ? <span className="bq-auth-spinner" style={{ width: 16, height: 16, borderWidth: 2 }} />
              : <ChevronRight size={16} className={`pv2-chevron ${(show2FASetup || show2FADisable) ? 'open' : ''}`} />}
          </button>
          <AnimatePresence>
            {show2FASetup && tfaSetupData && (
              <motion.div className="pv2-expand" initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.22 }}>
                <div className="pv2-form-inner pv2-2fa">
                  <p className="pv2-2fa-step"><strong>Schritt 1:</strong> QR-Code mit Authenticator-App scannen</p>
                  <div className="pv2-qr-wrap">
                    <img src={`https://api.qrserver.com/v1/create-qr-code/?size=180x180&data=${encodeURIComponent(tfaSetupData.otpauth)}`} alt="QR" width={180} height={180} />
                  </div>
                  <p className="pv2-2fa-step">Oder manuell eingeben:</p>
                  <code className="pv2-secret">{tfaSetupData.secret}</code>
                  <p className="pv2-2fa-step"><strong>Schritt 2:</strong> 6-stelligen Code eingeben:</p>
                  <div className="pv2-code-input-wrap">
                    <input type="text" inputMode="numeric" maxLength={6} placeholder="000000"
                      value={tfaCode} onChange={e => { setTfaCode(e.target.value.replace(/\D/g,'')); setTfaError(''); }}
                      className="pv2-code-input" autoFocus />
                  </div>
                  {tfaError && <p className="pv2-error">{tfaError}</p>}
                  <div className="pv2-row-actions">
                    <button className="pv2-btn primary" onClick={confirm2FA} disabled={tfaLoading}>
                      {tfaLoading ? <span className="bq-auth-spinner" /> : <><ShieldCheck size={14} />2FA aktivieren</>}
                    </button>
                    <button className="pv2-btn ghost" onClick={() => { setShow2FASetup(false); setTfaSetupData(null); setTfaCode(''); setTfaError(''); }}>Abbrechen</button>
                  </div>
                </div>
              </motion.div>
            )}
            {show2FADisable && (
              <motion.div className="pv2-expand" initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.22 }}>
                <div className="pv2-form-inner pv2-2fa">
                  <p className="pv2-2fa-step">Aktuellen Code aus der Authenticator-App eingeben:</p>
                  <div className="pv2-code-input-wrap">
                    <input type="text" inputMode="numeric" maxLength={6} placeholder="000000"
                      value={tfaCode} onChange={e => { setTfaCode(e.target.value.replace(/\D/g,'')); setTfaError(''); }}
                      className="pv2-code-input" autoFocus />
                  </div>
                  {tfaError && <p className="pv2-error">{tfaError}</p>}
                  <div className="pv2-row-actions">
                    <button className="pv2-btn danger" onClick={disable2FA} disabled={tfaLoading}>
                      {tfaLoading ? <span className="bq-auth-spinner" style={{ borderTopColor: '#fff' }} /> : '2FA deaktivieren'}
                    </button>
                    <button className="pv2-btn ghost" onClick={() => { setShow2FADisable(false); setTfaCode(''); setTfaError(''); }}>Abbrechen</button>
                  </div>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {/* Privacy */}
        <div className="pv2-card">
          <div className="pv2-section-head"><Shield size={15} /><span>Privatsphäre</span></div>
          <div className="pv2-row" style={{ cursor: 'default' }}>
            <div className="pv2-row-icon" style={{ background: 'rgba(0,122,255,0.1)', color: '#007AFF' }}><Shield size={16} /></div>
            <div className="pv2-row-body"><span className="pv2-row-title">Profil-Sichtbarkeit</span><span className="pv2-row-sub">Wer darf dein Profil sehen?</span></div>
          </div>
          <div className="pv2-visibility">
            {[
              { value: 'everyone', label: 'Alle Freunde', desc: 'Freunde sehen dein Profil & Statistiken' },
              { value: 'nobody',   label: 'Niemand',      desc: 'Profil für andere verborgen' },
            ].map(opt => (
              <button key={opt.value} className={`pv2-vis-opt ${visibility === opt.value ? 'active' : ''}`}
                onClick={() => saveVisibility(opt.value)} disabled={savingVisibility}>
                <div className="pv2-vis-radio">{visibility === opt.value && <div className="pv2-vis-dot" />}</div>
                <div><div className="pv2-vis-label">{opt.label}</div><div className="pv2-vis-desc">{opt.desc}</div></div>
              </button>
            ))}
          </div>
        </div>

        {/* Teams */}
        <div className="pv2-card">
          <div className="pv2-section-head"><Video size={15} /><span>Integrationen</span></div>
          <div className="pv2-teams-row">
            <div className="pv2-row" style={{ cursor: 'default' }}>
              <div className="pv2-row-icon" style={{ background: 'rgba(98,100,167,0.12)', color: '#6264a7' }}><Video size={16} /></div>
              <div className="pv2-row-body"><span className="pv2-row-title">Microsoft Teams</span><span className="pv2-row-sub">Automatische Meeting-Links bei Terminen</span></div>
              <span className={`pv2-badge ${teamsConnected ? 'green' : 'gray'}`}>
                {teamsConnected === null ? '…' : teamsConnected ? 'Verbunden' : 'Inaktiv'}
              </span>
            </div>
            {teamsConnected !== null && (
              <div style={{ paddingLeft: 20, paddingBottom: 12 }}>
                {teamsConnected ? (
                  <button className="pv2-btn danger-outline" onClick={async () => {
                    try { await api.disconnectTeams(); setTeamsConnected(false); showToast('Getrennt'); }
                    catch { showToast('Fehler', 'error'); }
                  }}><X size={13} />Konto trennen</button>
                ) : (
                  <button className="pv2-btn primary" disabled={teamsConnecting} onClick={async () => {
                    setTeamsConnecting(true);
                    try { const { url } = await api.getTeamsConnectUrl(); if (url) window.location.assign(url); else showToast('Nicht konfiguriert', 'error'); }
                    catch (err) { showToast(err.message, 'error'); }
                    finally { setTeamsConnecting(false); }
                  }}><Video size={13} />{teamsConnecting ? 'Weiterleitung…' : 'Verbinden'}</button>
                )}
              </div>
            )}
          </div>
        </div>

        {/* Account */}
        <div className="pv2-card">
          <div className="pv2-section-head"><Download size={15} /><span>Konto</span></div>
          <button className="pv2-row" onClick={exportData}>
            <div className="pv2-row-icon" style={{ background: 'rgba(0,199,190,0.1)', color: '#00C7BE' }}><Download size={16} /></div>
            <div className="pv2-row-body"><span className="pv2-row-title">Daten exportieren</span><span className="pv2-row-sub">Alle Aufgaben als JSON</span></div>
            <ChevronRight size={16} />
          </button>
          <button className="pv2-row" onClick={() => window.dispatchEvent(new Event('open-help-chat'))}>
            <div className="pv2-row-icon" style={{ background: 'rgba(88,86,214,0.1)', color: '#5856D6' }}><MessageCircleQuestion size={16} /></div>
            <div className="pv2-row-body"><span className="pv2-row-title">KI-Hilfe</span><span className="pv2-row-sub">Fragen zur App-Nutzung</span></div>
            <ChevronRight size={16} />
          </button>
        </div>

        {/* Danger */}
        <div className="pv2-card pv2-danger-card">
          <div className="pv2-section-head" style={{ color: '#FF3B30' }}><Trash2 size={15} /><span>Gefahrenzone</span></div>
          <button className="pv2-row" onClick={() => setShowDeleteConfirm(!showDeleteConfirm)}>
            <div className="pv2-row-icon" style={{ background: 'rgba(255,59,48,0.1)', color: '#FF3B30' }}><Trash2 size={16} /></div>
            <div className="pv2-row-body">
              <span className="pv2-row-title" style={{ color: '#FF3B30' }}>Account löschen</span>
              <span className="pv2-row-sub">Alle Daten werden unwiderruflich gelöscht</span>
            </div>
            <ChevronRight size={16} className={`pv2-chevron ${showDeleteConfirm ? 'open' : ''}`} />
          </button>
          <AnimatePresence>
            {showDeleteConfirm && (
              <motion.div className="pv2-expand" initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.22 }}>
                <div className="pv2-form-inner">
                  <div className="pv2-danger-warning"><AlertTriangle size={16} /><p>Dies kann nicht rückgängig gemacht werden.</p></div>
                  <div className="pv2-field"><label>Passwort zur Bestätigung</label>
                    <input type="password" value={deletePw} onChange={e => setDeletePw(e.target.value)} placeholder="Dein Passwort" />
                  </div>
                  <button className="pv2-btn danger" onClick={deleteAccount} disabled={saving || !deletePw}>
                    {saving ? 'Löschen…' : 'Account endgültig löschen'}
                  </button>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>

      </main>

      {/* Toast */}
      <AnimatePresence>
        {toast && (
          <motion.div className={`profile-toast ${toast.type}`}
            initial={{ opacity: 0, y: 50 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 50 }}>
            {toast.type === 'success' ? <Check size={16} /> : <AlertTriangle size={16} />}
            {toast.message}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );

  /* ─── OLD LAYOUT (removed) ─── */
  return (
    <div className="profile-page">
      {/* Header */}
      <div className="profile-header-card">
        <div className="profile-avatar-section">
          <motion.div
            className="profile-avatar-wrapper"
            whileTap={{ scale: 0.95 }}
            onClick={() => fileInputRef.current?.click()}
          >
            {profile?.avatar_url ? (
              <img src={profile.avatar_url} alt="Avatar" className="profile-avatar-img" />
            ) : (
              <div
                className="profile-avatar-placeholder"
                style={{ background: profile?.avatar_color || '#007AFF' }}
              >
                {profile?.name?.[0]?.toUpperCase() || '?'}
              </div>
            )}
            <div className="profile-avatar-overlay">
              <Camera size={20} />
            </div>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              onChange={handleAvatarUpload}
              style={{ display: 'none' }}
            />
          </motion.div>
          {profile?.avatar_url && (
            <button className="profile-remove-avatar" onClick={removeAvatar}>
              Entfernen
            </button>
          )}
        </div>

        <div className="profile-header-info">
          {editName ? (
            <div className="profile-inline-edit">
              <input
                value={nameValue}
                onChange={(e) => setNameValue(e.target.value)}
                className="profile-inline-input"
                maxLength={50}
                autoFocus
                onKeyDown={(e) => e.key === 'Enter' && saveName()}
              />
              <button className="profile-inline-btn save" onClick={saveName} disabled={saving}>
                <Check size={16} />
              </button>
              <button className="profile-inline-btn cancel" onClick={() => { setEditName(false); setNameValue(profile.name); }}>
                <X size={16} />
              </button>
            </div>
          ) : (
            <div className="profile-name-row">
              <h1 className="profile-name">{profile?.name}</h1>
              <button className="profile-edit-btn" onClick={() => setEditName(true)}>
                <Edit3 size={14} />
              </button>
            </div>
          )}

          <div className="profile-email">
            <Mail size={14} />
            {profile?.email}
          </div>

          {editBio ? (
            <div className="profile-inline-edit">
              <textarea
                value={bioValue}
                onChange={(e) => setBioValue(e.target.value)}
                className="profile-inline-input bio"
                maxLength={200}
                rows={2}
                placeholder="Kurze Bio..."
                autoFocus
              />
              <button className="profile-inline-btn save" onClick={saveBio} disabled={saving}>
                <Check size={16} />
              </button>
              <button className="profile-inline-btn cancel" onClick={() => { setEditBio(false); setBioValue(profile.bio || ''); }}>
                <X size={16} />
              </button>
            </div>
          ) : (
            <div className="profile-bio-row" onClick={() => setEditBio(true)}>
              <p className="profile-bio">
                {profile?.bio || 'Tippe, um eine Bio hinzuzufügen...'}
              </p>
              <Edit3 size={12} className="profile-bio-edit-icon" />
            </div>
          )}
        </div>

        {/* Level Badge */}
        <div className={`profile-level-badge${glowLevel ? ' levelup-glow' : ''}`} style={glowLevel ? { boxShadow: '0 0 24px 8px #ffe066, 0 0 60px 16px #ffd70055' } : {}}>
          <div className="profile-level-icon">
            {/* Zeige SVG-Icon je nach Level (max. 5) */}
            <img
              src={`/level-icons/level-${level > 5 ? 5 : level}.svg`}
              alt={`Level ${level} Icon`}
              style={{ width: 32, height: 32, display: 'block' }}
            />
          </div>
          <div>
            <div className="profile-level-label">Level {level}</div>
            <div className="profile-level-bar">
              <motion.div
                className="profile-level-fill"
                initial={{ width: 0 }}
                animate={{ width: `${xpProgress}%` }}
                transition={{ duration: 0.8 }}
              />
            </div>
          </div>
          {/* Konfetti-Animation */}
          <Confetti trigger={showConfetti} />
        </div>
        <style>{`.levelup-glow { transition: box-shadow 0.5s; }`}</style>
      </div>

      {/* Stats Grid */}
      {stats && (
        <div className="profile-stats-section">
          <h3 className="profile-section-title">Statistiken</h3>
          <div className="profile-stats-grid">
            <div className="profile-stat-card">
              <div className="profile-stat-icon" style={{ background: 'rgba(0,122,255,0.1)', color: '#007AFF' }}>
                <Target size={20} />
              </div>
              <div className="profile-stat-value">{stats.total_tasks}</div>
              <div className="profile-stat-label">Aufgaben gesamt</div>
            </div>
            <div className="profile-stat-card">
              <div className="profile-stat-icon" style={{ background: 'rgba(52,199,89,0.1)', color: '#34C759' }}>
                <CheckCircle2 size={20} />
              </div>
              <div className="profile-stat-value">{stats.completed_tasks}</div>
              <div className="profile-stat-label">Erledigt</div>
            </div>
            <div className="profile-stat-card">
              <div className="profile-stat-icon" style={{ background: 'rgba(255,149,0,0.1)', color: '#FF9500' }}>
                <Flame size={20} />
              </div>
              <div className="profile-stat-value">{stats.streak}</div>
              <div className="profile-stat-label">Tage-Streak</div>
            </div>
            <div className="profile-stat-card">
              <div className="profile-stat-icon" style={{ background: 'rgba(88,86,214,0.1)', color: '#5856D6' }}>
                <TrendingUp size={20} />
              </div>
              <div className="profile-stat-value">{stats.completion_rate}%</div>
              <div className="profile-stat-label">Abschlussrate</div>
            </div>
          </div>

          {/* Progress Ring */}
          <div className="profile-progress-section">
            <div className="profile-progress-ring-wrap">
              <svg viewBox="0 0 120 120" className="profile-progress-ring">
                <circle cx="60" cy="60" r="52" fill="none" stroke="rgba(0,0,0,0.06)" strokeWidth="10" />
                <motion.circle
                  cx="60" cy="60" r="52" fill="none"
                  stroke="var(--primary)"
                  strokeWidth="10"
                  strokeLinecap="round"
                  strokeDasharray={`${2 * Math.PI * 52}`}
                  initial={{ strokeDashoffset: 2 * Math.PI * 52 }}
                  animate={{ strokeDashoffset: 2 * Math.PI * 52 * (1 - stats.completion_rate / 100) }}
                  transition={{ duration: 1.2, ease: 'easeOut' }}
                  transform="rotate(-90 60 60)"
                />
              </svg>
              <div className="profile-progress-center">
                <span className="profile-progress-value">{stats.completion_rate}%</span>
                <span className="profile-progress-label">Produktivität</span>
              </div>
            </div>
            <div className="profile-progress-details">
              <div className="profile-progress-item">
                <Clock size={14} />
                <span>{stats.week_completed} diese Woche erledigt</span>
              </div>
              <div className="profile-progress-item">
                <Calendar size={14} />
                <span>{stats.active_days} aktive Tage</span>
              </div>
              <div className="profile-progress-item">
                <Award size={14} />
                <span>Mitglied seit {memberSince}</span>
              </div>
            </div>
          </div>

          {/* Category Breakdown */}
          {stats.category_breakdown?.length > 0 && (
            <div className="profile-categories-section">
              <h4 className="profile-subsection-title">Top Kategorien</h4>
              {stats.category_breakdown.map((cat, i) => (
                <div key={i} className="profile-category-bar">
                  <div className="profile-category-info">
                    <span className="profile-category-dot" style={{ background: cat.color }} />
                    <span>{cat.name}</span>
                    <span className="profile-category-count">{cat.done}/{cat.count}</span>
                  </div>
                  <div className="profile-category-track">
                    <motion.div
                      className="profile-category-fill"
                      style={{ background: cat.color }}
                      initial={{ width: 0 }}
                      animate={{ width: `${cat.count > 0 ? (cat.done / cat.count) * 100 : 0}%` }}
                      transition={{ duration: 0.8, delay: i * 0.1 }}
                    />
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Avatar Color */}
      <div className="profile-section-card">
        <h3 className="profile-section-title">
          <Palette size={18} />
          Avatar-Farbe
        </h3>
        <div className="profile-color-grid">
          {AVATAR_COLORS.map((color) => (
            <motion.button
              key={color}
              className={`profile-color-btn ${profile?.avatar_color === color ? 'active' : ''}`}
              style={{ background: color }}
              onClick={() => changeColor(color)}
              whileTap={{ scale: 0.85 }}
            >
              {profile?.avatar_color === color && <Check size={14} color="white" />}
            </motion.button>
          ))}
        </div>
      </div>

      {/* Password */}
      <div className="profile-section-card">
        <button
          className="profile-action-row"
          onClick={() => setShowPasswordForm(!showPasswordForm)}
        >
          <div className="profile-action-left">
            <div className="profile-action-icon" style={{ background: 'rgba(88,86,214,0.1)', color: '#5856D6' }}>
              <Lock size={18} />
            </div>
            <div>
              <div className="profile-action-title">Passwort ändern</div>
              <div className="profile-action-subtitle">Sicherheit deines Kontos</div>
            </div>
          </div>
          <ChevronRight size={18} className={`profile-chevron ${showPasswordForm ? 'open' : ''}`} />
        </button>

        <AnimatePresence>
          {showPasswordForm && (
            <motion.form
              className="profile-password-form"
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: 'auto', opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              onSubmit={changePassword}
            >
              <div className="profile-field">
                <label>Aktuelles Passwort</label>
                <div className="profile-password-wrap">
                  <input
                    type={showCurrentPw ? 'text' : 'password'}
                    value={currentPw}
                    onChange={(e) => setCurrentPw(e.target.value)}
                    required
                    minLength={6}
                  />
                  <button type="button" className="profile-pw-toggle" onClick={() => setShowCurrentPw(!showCurrentPw)}>
                    {showCurrentPw ? <EyeOff size={16} /> : <Eye size={16} />}
                  </button>
                </div>
              </div>
              <div className="profile-field">
                <label>Neues Passwort</label>
                <div className="profile-password-wrap">
                  <input
                    type={showNewPw ? 'text' : 'password'}
                    value={newPw}
                    onChange={(e) => setNewPw(e.target.value)}
                    required
                    minLength={6}
                  />
                  <button type="button" className="profile-pw-toggle" onClick={() => setShowNewPw(!showNewPw)}>
                    {showNewPw ? <EyeOff size={16} /> : <Eye size={16} />}
                  </button>
                </div>
              </div>
              <div className="profile-field">
                <label>Passwort bestätigen</label>
                <input
                  type="password"
                  value={confirmPw}
                  onChange={(e) => setConfirmPw(e.target.value)}
                  required
                  minLength={6}
                />
              </div>
              <button type="submit" className="profile-btn primary" disabled={saving}>
                {saving ? 'Speichern...' : 'Passwort ändern'}
              </button>
            </motion.form>
          )}
        </AnimatePresence>
      </div>

      {/* Visibility */}
      <div className="profile-section-card">
        {/* ── 2FA ── */}
        <button
          className="profile-action-row"
          onClick={() => {
            if (twofa.enabled) { setShow2FADisable(!show2FADisable); setShow2FASetup(false); setTfaCode(''); setTfaError(''); }
            else { start2FASetup(); }
          }}
        >
          <div className="profile-action-left">
            <div className="profile-action-icon" style={{ background: twofa.enabled ? 'rgba(52,199,89,0.12)' : 'rgba(255,149,0,0.1)', color: twofa.enabled ? '#34C759' : '#FF9500' }}>
              {twofa.enabled ? <ShieldCheck size={18} /> : <ShieldOff size={18} />}
            </div>
            <div>
              <div className="profile-action-title">
                Zwei-Faktor-Authentifizierung
                {twofa.enabled && <span style={{ marginLeft: 8, fontSize: 11, fontWeight: 700, color: '#34C759', background: 'rgba(52,199,89,0.12)', padding: '2px 8px', borderRadius: 20 }}>Aktiv</span>}
              </div>
              <div className="profile-action-subtitle">
                {twofa.enabled ? 'Per Authenticator-App geschützt — klicken zum Deaktivieren' : 'Zusätzlicher Schutz via Authenticator-App'}
              </div>
            </div>
          </div>
          {tfaLoading ? <span className="bq-auth-spinner" style={{ width: 18, height: 18, borderWidth: 2 }} /> : <ChevronRight size={18} className={`profile-chevron ${(show2FASetup || show2FADisable) ? 'open' : ''}`} />}
        </button>

        <AnimatePresence>
          {/* Setup flow */}
          {show2FASetup && tfaSetupData && (
            <motion.div className="profile-2fa-panel"
              initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }}
              exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.25 }}>
              <div className="profile-2fa-inner">
                <p className="profile-2fa-step"><strong>Schritt 1:</strong> Öffne deine Authenticator-App (Google Authenticator, Authy etc.) und scanne diesen QR-Code:</p>
                <div className="profile-2fa-qr">
                  <img
                    src={`https://api.qrserver.com/v1/create-qr-code/?size=180x180&data=${encodeURIComponent(tfaSetupData.otpauth)}`}
                    alt="2FA QR Code" width={180} height={180}
                  />
                </div>
                <p className="profile-2fa-step"><strong>Manuell:</strong> Falls der QR-Code nicht funktioniert, gib diesen Code in der App ein:</p>
                <div className="profile-2fa-secret">{tfaSetupData.secret}</div>
                <p className="profile-2fa-step"><strong>Schritt 2:</strong> Gib den 6-stelligen Code aus der App ein:</p>
                <div className="bq-field" style={{ maxWidth: 240 }}>
                  <div className="bq-input-wrap">
                    <ShieldCheck size={15} className="bq-input-icon" />
                    <input type="text" inputMode="numeric" maxLength={6} placeholder="000000"
                      value={tfaCode} onChange={e => { setTfaCode(e.target.value.replace(/\D/g,'')); setTfaError(''); }}
                      style={{ letterSpacing: '0.3em', fontSize: '1.2rem', fontWeight: 700 }} />
                  </div>
                </div>
                {tfaError && <p style={{ color: '#FF3B30', fontSize: 13, marginTop: 6 }}>{tfaError}</p>}
                <div style={{ display: 'flex', gap: 10, marginTop: 14 }}>
                  <button className="bq-auth-submit" style={{ flex: 1, minHeight: 44 }} onClick={confirm2FA} disabled={tfaLoading}>
                    {tfaLoading ? <span className="bq-auth-spinner" /> : <>2FA aktivieren <ShieldCheck size={15} /></>}
                  </button>
                  <button className="profile-action-btn-cancel" onClick={() => { setShow2FASetup(false); setTfaSetupData(null); setTfaCode(''); setTfaError(''); }}>
                    Abbrechen
                  </button>
                </div>
              </div>
            </motion.div>
          )}

          {/* Disable flow */}
          {show2FADisable && (
            <motion.div className="profile-2fa-panel"
              initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }}
              exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.25 }}>
              <div className="profile-2fa-inner">
                <p className="profile-2fa-step">Gib den aktuellen Code aus deiner Authenticator-App ein um 2FA zu deaktivieren:</p>
                <div className="bq-field" style={{ maxWidth: 240 }}>
                  <div className="bq-input-wrap">
                    <ShieldOff size={15} className="bq-input-icon" />
                    <input type="text" inputMode="numeric" maxLength={6} placeholder="000000"
                      value={tfaCode} onChange={e => { setTfaCode(e.target.value.replace(/\D/g,'')); setTfaError(''); }}
                      style={{ letterSpacing: '0.3em', fontSize: '1.2rem', fontWeight: 700 }} />
                  </div>
                </div>
                {tfaError && <p style={{ color: '#FF3B30', fontSize: 13, marginTop: 6 }}>{tfaError}</p>}
                <div style={{ display: 'flex', gap: 10, marginTop: 14 }}>
                  <button style={{ flex: 1, minHeight: 44, background: '#FF3B30', color: '#fff', borderRadius: 12, fontWeight: 700, fontSize: 14, border: 'none', cursor: 'pointer' }}
                    onClick={disable2FA} disabled={tfaLoading}>
                    {tfaLoading ? <span className="bq-auth-spinner" style={{ borderTopColor: '#fff' }} /> : '2FA deaktivieren'}
                  </button>
                  <button className="profile-action-btn-cancel" onClick={() => { setShow2FADisable(false); setTfaCode(''); setTfaError(''); }}>
                    Abbrechen
                  </button>
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        <div className="profile-action-row" style={{ cursor: 'default' }}>
          <div className="profile-action-left">
            <div className="profile-action-icon" style={{ background: 'rgba(0,122,255,0.1)', color: '#007AFF' }}>
              <Shield size={18} />
            </div>
            <div>
              <div className="profile-action-title">Profil-Sichtbarkeit</div>
              <div className="profile-action-subtitle">Wer darf dein Profil sehen?</div>
            </div>
          </div>
        </div>
        <div className="profile-visibility-options">
          {[
            { value: 'everyone', label: 'Alle Freunde', desc: 'Freunde können dein Profil und Statistiken sehen' },
            { value: 'nobody',   label: 'Niemand',      desc: 'Dein Profil ist für andere verborgen' },
          ].map((opt) => (
            <button
              key={opt.value}
              className={`profile-visibility-opt ${visibility === opt.value ? 'active' : ''}`}
              onClick={() => saveVisibility(opt.value)}
              disabled={savingVisibility}
            >
              <div className="profile-visibility-radio">
                {visibility === opt.value && <div className="profile-visibility-radio-dot" />}
              </div>
              <div>
                <div className="profile-visibility-label">{opt.label}</div>
                <div className="profile-visibility-desc">{opt.desc}</div>
              </div>
            </button>
          ))}
        </div>
      </div>

      {/* Microsoft Teams Integration */}
      <div className="profile-section-card profile-teams-card">
        <div className="profile-teams-hero">
          <div className="profile-teams-hero-top">
            <div className="profile-teams-brand">
              <div className="profile-teams-brand-icon">
                <Video size={18} />
              </div>
              <div>
                <div className="profile-teams-eyebrow">Integration</div>
                <div className="profile-teams-title">Microsoft Teams</div>
              </div>
            </div>
            <div className={`profile-teams-badge ${teamsConnected ? 'connected' : 'idle'}`}>
              {teamsConnected ? 'Verbunden' : 'Nicht verbunden'}
            </div>
          </div>

          <div className="profile-teams-copy">
            Plane Termine weiter in BeeQu und hänge auf Wunsch automatisch ein Teams-Meeting an, ohne den Erstellungsfluss zu verlassen.
          </div>

          <div className="profile-teams-pills">
            <span className="profile-teams-pill">Automatischer Join-Link</span>
            <span className="profile-teams-pill">Event bleibt in BeeQu</span>
            <span className="profile-teams-pill">Business-Konto erforderlich</span>
          </div>
        </div>

        <div className="profile-teams-body">
          {teamsConnected === null ? (
            <div className="profile-teams-loading">Wird geladen…</div>
          ) : teamsConnected ? (
            <>
              <div className="profile-teams-status-card success">
                <div className="profile-teams-status-icon success">
                  <Check size={16} />
                </div>
                <div>
                  <div className="profile-teams-status-title">Microsoft-Konto verbunden</div>
                  <div className="profile-teams-status-text">Neue Termine können jetzt automatisch mit einem Teams-Meeting ausgestattet werden.</div>
                </div>
              </div>

              <button
                type="button"
                className="profile-teams-cta danger"
                onClick={async () => {
                  try {
                    await api.disconnectTeams();
                    setTeamsConnected(false);
                    showToast('Microsoft-Konto getrennt');
                  } catch {
                    showToast('Trennen fehlgeschlagen', 'error');
                  }
                }}
              >
                <span className="profile-teams-cta-left">
                  <span className="profile-teams-cta-icon danger">
                    <X size={18} />
                  </span>
                  <span>
                    <span className="profile-teams-cta-title">Microsoft-Konto trennen</span>
                    <span className="profile-teams-cta-subtitle">Gespeicherte Tokens entfernen und automatische Meetings deaktivieren</span>
                  </span>
                </span>
                <ChevronRight size={18} />
              </button>
            </>
          ) : (
            <>
              <div className="profile-teams-status-card">
                <div className="profile-teams-status-icon">
                  <Shield size={16} />
                </div>
                <div>
                  <div className="profile-teams-status-title">Einmalig mit Microsoft anmelden</div>
                  <div className="profile-teams-status-text">Dein Microsoft-365-Geschäftskonto wird verbunden, damit Termine später direkt einen Join-Link erhalten.</div>
                </div>
              </div>

              <button
                type="button"
                className="profile-teams-cta"
                disabled={teamsConnecting}
                onClick={async () => {
                  setTeamsConnecting(true);
                  try {
                    showToast('Weiterleitung zu Microsoft wird vorbereitet...');
                    const { url } = await api.getTeamsConnectUrl();
                    if (url) window.location.assign(url);
                    else showToast('Teams ist serverseitig nicht konfiguriert', 'error');
                  } catch (err) {
                    showToast(err.message || 'Fehler beim Verbinden', 'error');
                  } finally {
                    setTeamsConnecting(false);
                  }
                }}
              >
                <span className="profile-teams-cta-left">
                  <span className="profile-teams-cta-icon">
                    <Video size={18} />
                  </span>
                  <span>
                    <span className="profile-teams-cta-title">Microsoft-Konto verbinden</span>
                    <span className="profile-teams-cta-subtitle">{teamsConnecting ? 'Weiterleitung zu Microsoft …' : 'Einmalig anmelden und automatische Teams-Meetings aktivieren'}</span>
                  </span>
                </span>
                {!teamsConnecting && <ChevronRight size={18} />}
              </button>
            </>
          )}
        </div>
      </div>

      {/* Export */}
      <div className="profile-section-card">
        <button className="profile-action-row" onClick={exportData}>
          <div className="profile-action-left">
            <div className="profile-action-icon" style={{ background: 'rgba(0,199,190,0.1)', color: '#00C7BE' }}>
              <Download size={18} />
            </div>
            <div>
              <div className="profile-action-title">Daten exportieren</div>
              <div className="profile-action-subtitle">Alle Aufgaben als JSON herunterladen</div>
            </div>
          </div>
          <ChevronRight size={18} />
        </button>
      </div>

      {/* KI-Hilfe (mobile only) */}
      <div className="profile-section-card help-profile-card">
        <button className="profile-action-row" onClick={() => window.dispatchEvent(new Event('open-help-chat'))}>
          <div className="profile-action-left">
            <div className="profile-action-icon" style={{ background: 'rgba(88,86,214,0.1)', color: '#5856D6' }}>
              <MessageCircleQuestion size={18} />
            </div>
            <div>
              <div className="profile-action-title">KI-Hilfe</div>
              <div className="profile-action-subtitle">Fragen zur App-Nutzung</div>
            </div>
          </div>
          <ChevronRight size={18} />
        </button>
      </div>

      {/* Danger Zone */}
      <div className="profile-section-card danger">
        <button
          className="profile-action-row"
          onClick={() => setShowDeleteConfirm(!showDeleteConfirm)}
        >
          <div className="profile-action-left">
            <div className="profile-action-icon" style={{ background: 'rgba(255,59,48,0.1)', color: '#FF3B30' }}>
              <Trash2 size={18} />
            </div>
            <div>
              <div className="profile-action-title danger">Account löschen</div>
              <div className="profile-action-subtitle">Alle Daten werden unwiderruflich gelöscht</div>
            </div>
          </div>
          <ChevronRight size={18} className={`profile-chevron ${showDeleteConfirm ? 'open' : ''}`} />
        </button>

        <AnimatePresence>
          {showDeleteConfirm && (
            <motion.div
              className="profile-delete-form"
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: 'auto', opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
            >
              <div className="profile-delete-warning">
                <AlertTriangle size={20} />
                <p>Dies kann nicht rückgängig gemacht werden. Alle Aufgaben, Kategorien und Daten werden gelöscht.</p>
              </div>
              <div className="profile-field">
                <label>Passwort zur Bestätigung</label>
                <input
                  type="password"
                  value={deletePw}
                  onChange={(e) => setDeletePw(e.target.value)}
                  placeholder="Dein Passwort"
                />
              </div>
              <button
                className="profile-btn danger"
                onClick={deleteAccount}
                disabled={saving || !deletePw}
              >
                {saving ? 'Löschen...' : 'Account endgültig löschen'}
              </button>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* Toast */}
      <AnimatePresence>
        {toast && (
          <motion.div
            className={`profile-toast ${toast.type}`}
            initial={{ opacity: 0, y: 50 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 50 }}
          >
            {toast.type === 'success' ? <Check size={16} /> : <AlertTriangle size={16} />}
            {toast.message}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

