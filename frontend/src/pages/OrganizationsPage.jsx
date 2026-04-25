import { useEffect, useMemo, useState } from 'react';
import { Building2, Plus, LogIn, Users, Copy, Check, Link2, Unlink2, UsersRound } from 'lucide-react';
import { motion } from 'framer-motion';
import { useOrganizationStore } from '../store/organizationStore';
import { useWorkspaceStore } from '../store/workspaceStore';
import { useGroupStore } from '../store/groupStore';

export default function OrganizationsPage() {
  const {
    organizations,
    members,
    groups: organizationGroups,
    currentOrganization,
    fetchOrganizations,
    fetchOrganization,
    fetchOrganizationGroups,
    createOrganization,
    joinOrganization,
    assignGroup,
    removeGroup,
  } = useOrganizationStore();
  const { groups: myGroups, fetchGroups } = useGroupStore();
  const { activeWorkspace, setActiveWorkspace } = useWorkspaceStore();
  const [name, setName] = useState('');
  const [joinCode, setJoinCode] = useState('');
  const [selectedId, setSelectedId] = useState(null);
  const [copiedCode, setCopiedCode] = useState('');

  useEffect(() => {
    fetchOrganizations();
    fetchGroups();
  }, [fetchOrganizations, fetchGroups]);

  useEffect(() => {
    if (selectedId) {
      fetchOrganization(selectedId);
      fetchOrganizationGroups(selectedId);
    }
  }, [selectedId, fetchOrganization, fetchOrganizationGroups]);

  const selectedOrganization = useMemo(() => {
    if (!selectedId) return null;
    return organizations.find((item) => String(item.id) === String(selectedId)) || currentOrganization;
  }, [organizations, currentOrganization, selectedId]);

  const availableGroups = useMemo(() => {
    if (!selectedOrganization) return [];
    return (myGroups || []).filter((group) => String(group.organization_id || '') !== String(selectedOrganization.id));
  }, [myGroups, selectedOrganization]);

  const linkedGroupIds = useMemo(
    () => new Set((organizationGroups || []).map((group) => String(group.id))),
    [organizationGroups]
  );

  const handleCreate = async (event) => {
    event.preventDefault();
    if (!name.trim()) return;
    const organization = await createOrganization({ name: name.trim() });
    if (organization) {
      setName('');
      setSelectedId(organization.id);
      setActiveWorkspace({
        scope: 'organization',
        id: organization.id,
        name: organization.name,
        color: organization.color,
      });
    }
  };

  const handleJoin = async (event) => {
    event.preventDefault();
    if (!joinCode.trim()) return;
    const organization = await joinOrganization(joinCode.trim().toUpperCase());
    if (organization) {
      setJoinCode('');
      setSelectedId(organization.id);
    }
  };

  const copyInviteCode = async (code) => {
    if (!code) return;
    try {
      await navigator.clipboard.writeText(code);
      setCopiedCode(code);
      window.setTimeout(() => setCopiedCode(''), 1600);
    } catch {
      // ignore clipboard issues
    }
  };

  const handleAssignGroup = async (groupId) => {
    if (!selectedOrganization) return;
    await assignGroup(selectedOrganization.id, groupId);
    await Promise.all([
      fetchOrganizationGroups(selectedOrganization.id),
      fetchGroups(),
      fetchOrganizations(),
      fetchOrganization(selectedOrganization.id),
    ]);
  };

  const handleRemoveGroup = async (groupId) => {
    if (!selectedOrganization) return;
    await removeGroup(selectedOrganization.id, groupId);
    await Promise.all([
      fetchOrganizationGroups(selectedOrganization.id),
      fetchGroups(),
      fetchOrganizations(),
      fetchOrganization(selectedOrganization.id),
    ]);
  };

  return (
    <div className="organizations-page">
      <div className="page-header">
        <h2>Organisationen</h2>
        <p>Verwalte Arbeitsbereiche fuer Teams, Vereine oder Kunden.</p>
      </div>

      <div className="workspace-page-grid">
        <section className="workspace-page-card">
          <div className="workspace-page-card-head">
            <h3>Meine Organisationen</h3>
            <span>{organizations.length}</span>
          </div>
          <div className="workspace-switch-list static-page-list">
            {organizations.map((organization) => {
              const isActiveWorkspace = activeWorkspace.scope === 'organization' && String(activeWorkspace.id) === String(organization.id);
              const isSelected = String(selectedId) === String(organization.id);
              return (
                <button
                  key={organization.id}
                  type="button"
                  className={`workspace-switch-item ${isSelected ? 'active' : ''}`}
                  onClick={() => setSelectedId(organization.id)}
                >
                  <span className="workspace-switch-icon" style={{ background: `${organization.color || '#FF9500'}22`, color: organization.color || '#FF9500' }}>
                    <Building2 size={16} />
                  </span>
                  <span className="workspace-switch-copy">
                    <strong>{organization.name}</strong>
                    <small>{organization.member_count || 0} Mitglieder</small>
                  </span>
                  {isActiveWorkspace && <span className="workspace-active-badge">Aktiv</span>}
                </button>
              );
            })}
            {organizations.length === 0 && (
              <div className="workspace-empty-state">Noch keine Organisation vorhanden.</div>
            )}
          </div>
        </section>

        <section className="workspace-page-card workspace-page-card-form">
          <form onSubmit={handleCreate} className="workspace-inline-form">
            <div className="workspace-page-card-head">
              <h3>Neu erstellen</h3>
              <Plus size={16} />
            </div>
            <input
              className="task-edit-input"
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="z.B. Studio Nord, Projekt Alpha"
            />
            <button type="submit" className="task-edit-save">Organisation erstellen</button>
          </form>

          <form onSubmit={handleJoin} className="workspace-inline-form">
            <div className="workspace-page-card-head">
              <h3>Beitreten</h3>
              <LogIn size={16} />
            </div>
            <input
              className="task-edit-input"
              value={joinCode}
              onChange={(event) => setJoinCode(event.target.value.toUpperCase())}
              placeholder="Einladungscode"
            />
            <button type="submit" className="task-edit-save secondary">Mit Code beitreten</button>
          </form>
        </section>
      </div>

      {selectedOrganization && (
        <motion.section
          className="workspace-page-card workspace-detail-card"
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
        >
          <div className="workspace-page-card-head">
            <div>
              <h3>{selectedOrganization.name}</h3>
              <p>Invite-Code: {selectedOrganization.invite_code || 'nicht verfuegbar'}</p>
            </div>
            <div className="workspace-detail-actions">
              <button
                type="button"
                className="workspace-copy-btn"
                onClick={() => copyInviteCode(selectedOrganization.invite_code)}
              >
                {copiedCode === selectedOrganization.invite_code ? <Check size={15} /> : <Copy size={15} />}
                Code kopieren
              </button>
              <button
                type="button"
                className="task-edit-save"
                onClick={() => setActiveWorkspace({
                  scope: 'organization',
                  id: selectedOrganization.id,
                  name: selectedOrganization.name,
                  color: selectedOrganization.color,
                })}
              >
                Als Workspace aktivieren
              </button>
            </div>
          </div>

          <div className="workspace-detail-meta">
            <div>
              <Users size={16} />
              <span>{selectedOrganization.member_count || members.length || 0} Mitglieder</span>
            </div>
            <div>
              <Building2 size={16} />
              <span>{selectedOrganization.task_count || 0} Eintraege</span>
            </div>
            <div>
              <UsersRound size={16} />
              <span>{organizationGroups.length} Gruppen verknuepft</span>
            </div>
          </div>

          <div className="workspace-member-grid">
            {members.map((member) => (
              <div key={member.user_id} className="workspace-member-item">
                <span className="workspace-member-avatar" style={{ background: member.avatar_color || '#FF9500' }}>
                  {(member.name || '?').slice(0, 1).toUpperCase()}
                </span>
                <div>
                  <strong>{member.name}</strong>
                  <small>{member.role === 'owner' ? 'Eigentuemer' : member.role}</small>
                </div>
              </div>
            ))}
          </div>

          <div className="workspace-groups-panel">
            <div className="workspace-page-card-head">
              <h3>Verknuepfte Gruppen</h3>
              <span>{organizationGroups.length}</span>
            </div>
            <div className="workspace-group-list">
              {organizationGroups.map((group) => (
                <div key={group.id} className="workspace-group-item">
                  <div>
                    <strong>{group.name}</strong>
                    <small>{group.member_count || 0} Mitglieder</small>
                  </div>
                  <button
                    type="button"
                    className="workspace-link-btn danger"
                    onClick={() => handleRemoveGroup(group.id)}
                  >
                    <Unlink2 size={14} /> Trennen
                  </button>
                </div>
              ))}
              {organizationGroups.length === 0 && (
                <div className="workspace-empty-state">Noch keine Gruppen mit dieser Organisation verknuepft.</div>
              )}
            </div>
          </div>

          <div className="workspace-groups-panel">
            <div className="workspace-page-card-head">
              <h3>Gruppen zuordnen</h3>
              <span>{availableGroups.length}</span>
            </div>
            <div className="workspace-group-list">
              {availableGroups.filter((group) => !linkedGroupIds.has(String(group.id))).map((group) => (
                <div key={`candidate-${group.id}`} className="workspace-group-item">
                  <div>
                    <strong>{group.name}</strong>
                    <small>{group.member_count || 0} Mitglieder</small>
                  </div>
                  <button
                    type="button"
                    className="workspace-link-btn"
                    onClick={() => handleAssignGroup(group.id)}
                  >
                    <Link2 size={14} /> Zuordnen
                  </button>
                </div>
              ))}
              {availableGroups.filter((group) => !linkedGroupIds.has(String(group.id))).length === 0 && (
                <div className="workspace-empty-state">Keine weiteren Gruppen verfuegbar.</div>
              )}
            </div>
          </div>
        </motion.section>
      )}
    </div>
  );
}