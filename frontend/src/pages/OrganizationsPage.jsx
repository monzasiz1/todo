import { useEffect, useState } from 'react';
import { Building2, Users, Shield, Plus, Link as LinkIcon } from 'lucide-react';
import { api } from '../utils/api';

export default function OrganizationsPage() {
  const [organizations, setOrganizations] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [createData, setCreateData] = useState({ name: '', description: '', color: '#0A84FF' });
  const [joinCode, setJoinCode] = useState('');

  const loadOrganizations = async () => {
    setLoading(true);
    setError('');
    try {
      const data = await api.getOrganizations();
      setOrganizations(Array.isArray(data.organizations) ? data.organizations : []);
    } catch (err) {
      setError(err.message || 'Organisationen konnten nicht geladen werden');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadOrganizations();
  }, []);

  const handleCreate = async (e) => {
    e.preventDefault();
    if (!createData.name.trim()) return;
    try {
      await api.createOrganization(createData);
      setCreateData({ name: '', description: '', color: '#0A84FF' });
      await loadOrganizations();
    } catch (err) {
      setError(err.message || 'Organisation konnte nicht erstellt werden');
    }
  };

  const handleJoin = async (e) => {
    e.preventDefault();
    if (!joinCode.trim()) return;
    try {
      await api.joinOrganization(joinCode.trim().toUpperCase());
      setJoinCode('');
      await loadOrganizations();
    } catch (err) {
      setError(err.message || 'Beitritt fehlgeschlagen');
    }
  };

  return (
    <div className="org-page">
      <header className="page-header">
        <h2>Organisationen</h2>
        <p>Verwalte deine Workspaces und Firmen-Teams als eigene Kalender-Quellen.</p>
      </header>

      {error && (
        <div className="org-alert-error">{error}</div>
      )}

      <div className="org-layout-grid">
        <section className="org-panel">
          <h3><Plus size={16} /> Neue Organisation</h3>
          <form onSubmit={handleCreate} className="org-form">
            <input
              className="org-input"
              type="text"
              placeholder="Name"
              value={createData.name}
              onChange={(e) => setCreateData((s) => ({ ...s, name: e.target.value }))}
            />
            <textarea
              className="org-textarea"
              placeholder="Beschreibung"
              value={createData.description}
              onChange={(e) => setCreateData((s) => ({ ...s, description: e.target.value }))}
            />
            <label className="org-color-row">
              <span>Farbe</span>
              <input
                type="color"
                value={createData.color}
                onChange={(e) => setCreateData((s) => ({ ...s, color: e.target.value }))}
              />
            </label>
            <button className="org-btn-primary" type="submit">Erstellen</button>
          </form>
        </section>

        <section className="org-panel">
          <h3><LinkIcon size={16} /> Beitreten</h3>
          <form onSubmit={handleJoin} className="org-form">
            <input
              className="org-input"
              type="text"
              placeholder="Einladungscode"
              value={joinCode}
              onChange={(e) => setJoinCode(e.target.value)}
            />
            <button className="org-btn-secondary" type="submit">Code einlösen</button>
          </form>
        </section>
      </div>

      <section className="org-list-section">
        <h3>Deine Organisationen</h3>
        {loading ? <p>Lade Organisationen...</p> : null}
        {!loading && organizations.length === 0 ? (
          <div className="org-empty-state">Noch keine Organisationen vorhanden.</div>
        ) : null}

        <div className="org-cards">
          {organizations.map((org) => (
            <article key={org.id} className="org-card">
              <div className="org-card-top">
                <div className="org-icon" style={{ background: org.color || '#0A84FF' }}>
                  <Building2 size={18} />
                </div>
                <div>
                  <div className="org-name">{org.name}</div>
                  <div className="org-meta">Code: {org.invite_code}</div>
                </div>
              </div>
              <p className="org-description">{org.description || 'Keine Beschreibung'}</p>
              <div className="org-stats-row">
                <span><Users size={14} /> {org.member_count || 0} Mitglieder</span>
                <span><Building2 size={14} /> {org.group_count || 0} Gruppen</span>
                <span><Shield size={14} /> Rolle: {org.role || 'member'}</span>
              </div>
            </article>
          ))}
        </div>
      </section>
    </div>
  );
}
