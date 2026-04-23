import { useState, useEffect, useRef } from 'react';
import { useAuthStore } from '../store/authStore';
import { api } from '../utils/api';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Camera, User, Mail, Lock, Shield, Palette, Download,
  Trash2, Check, X, ChevronRight, AlertTriangle, Flame,
  Target, Calendar, CheckCircle2, Clock, TrendingUp,
  Award, Star, Edit3, Eye, EyeOff, ArrowLeft, MessageCircleQuestion, Video
} from 'lucide-react';
import { format, parseISO } from 'date-fns';
import { de } from 'date-fns/locale';

const AVATAR_COLORS = [
  '#007AFF', '#5856D6', '#AF52DE', '#FF2D55', '#FF3B30',
  '#FF9500', '#FFCC00', '#34C759', '#00C7BE', '#30B0C7',
  '#5AC8FA', '#FF6482', '#8E8E93', '#1C1C1E',
];

export default function ProfilePage() {
  const { user, logout, setUser } = useAuthStore();
  const [profile, setProfile] = useState(null);
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);

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

  useEffect(() => {
    loadProfile();
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

  const loadProfile = async () => {
    try {
      const data = await api.getProfile();
      setProfile(data.user);
      setStats(data.stats);
      setNameValue(data.user.name || '');
      setBioValue(data.user.bio || '');
      setVisibility(data.user.profile_visibility || 'everyone');
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
      setProfile(prev => ({ ...prev, name: data.user.name }));
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
      setProfile(prev => ({ ...prev, bio: data.user.bio }));
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
      setProfile(prev => ({ ...prev, avatar_color: color }));
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
      await api.changePassword(currentPw, newPw);
      setShowPasswordForm(false);
      setCurrentPw('');
      setNewPw('');
      setConfirmPw('');
      showToast('Passwort geändert');
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
      a.download = `taski-export-${format(new Date(), 'yyyy-MM-dd')}.json`;
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
        <div className="profile-level-badge">
          <div className="profile-level-icon">
            <Star size={16} />
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
        </div>
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
      <div className="profile-section-card">
        <div style={{ padding: '4px 0 10px', fontWeight: 700, fontSize: 15, display: 'flex', alignItems: 'center', gap: 8 }}>
          <Video size={16} style={{ color: '#5558a8' }} />
          Microsoft Teams
        </div>
        {teamsConnected === null ? (
          <div style={{ color: 'var(--text-secondary)', fontSize: 13 }}>Wird geladen…</div>
        ) : teamsConnected ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: '#34C759' }}>
              <Check size={14} /> Microsoft-Konto verbunden. Teams-Meetings können automatisch erstellt werden.
            </div>
            <button
              className="profile-action-row"
              style={{ background: 'rgba(255,59,48,0.06)', borderRadius: 10, padding: '10px 14px' }}
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
              <div className="profile-action-left">
                <div className="profile-action-icon" style={{ background: 'rgba(255,59,48,0.1)', color: '#FF3B30' }}>
                  <X size={18} />
                </div>
                <div>
                  <div className="profile-action-title" style={{ color: '#FF3B30' }}>Microsoft-Konto trennen</div>
                  <div className="profile-action-subtitle">Gespeicherte Tokens werden gelöscht</div>
                </div>
              </div>
            </button>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <div style={{ fontSize: 13, color: 'var(--text-secondary)', lineHeight: 1.5 }}>
              Verbinde dein Microsoft-Konto, um bei Terminen automatisch ein Teams-Meeting zu erstellen.
            </div>
            <button
              className="profile-action-row"
              style={{ background: 'rgba(85,88,168,0.08)', borderRadius: 10, padding: '10px 14px' }}
              disabled={teamsConnecting}
              onClick={async () => {
                setTeamsConnecting(true);
                try {
                  const { url } = await api.getTeamsConnectUrl();
                  if (url) window.location.href = url;
                  else showToast('Teams ist serverseitig nicht konfiguriert', 'error');
                } catch (err) {
                  showToast(err.message || 'Fehler beim Verbinden', 'error');
                } finally {
                  setTeamsConnecting(false);
                }
              }}
            >
              <div className="profile-action-left">
                <div className="profile-action-icon" style={{ background: 'rgba(85,88,168,0.15)', color: '#5558a8' }}>
                  <Video size={18} />
                </div>
                <div>
                  <div className="profile-action-title">Microsoft-Konto verbinden</div>
                  <div className="profile-action-subtitle">{teamsConnecting ? 'Weiterleitung…' : 'Einmalig mit Microsoft anmelden'}</div>
                </div>
              </div>
              {!teamsConnecting && <ChevronRight size={18} />}
            </button>
          </div>
        )}
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
