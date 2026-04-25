import { create } from 'zustand';

const STORAGE_KEY = 'taski_active_workspace_v1';

export const PRIVATE_WORKSPACE = {
  scope: 'private',
  id: null,
  name: 'Privat',
  color: '#4C7BD9',
};

function readStoredWorkspace() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : null;
    if (!parsed || typeof parsed !== 'object') return PRIVATE_WORKSPACE;
    const scope = parsed.scope === 'group' || parsed.scope === 'organization' ? parsed.scope : 'private';
    if (scope === 'private') return PRIVATE_WORKSPACE;
    if (!parsed.id) return PRIVATE_WORKSPACE;
    return {
      scope,
      id: String(parsed.id),
      name: parsed.name || (scope === 'group' ? 'Gruppe' : 'Organisation'),
      color: parsed.color || (scope === 'group' ? '#5856D6' : '#FF9500'),
    };
  } catch {
    return PRIVATE_WORKSPACE;
  }
}

function writeStoredWorkspace(workspace) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(workspace));
  } catch {
    // ignore storage issues
  }
}

export function getWorkspaceTaskParams(workspace) {
  const current = workspace || PRIVATE_WORKSPACE;
  if (current.scope === 'group' && current.id) {
    return {
      workspace_scope: 'group',
      workspace_group_id: String(current.id),
    };
  }
  if (current.scope === 'organization' && current.id) {
    return {
      workspace_scope: 'organization',
      workspace_organization_id: String(current.id),
    };
  }
  return { workspace_scope: 'private' };
}

export function buildWorkspaceTaskPayload(workspace) {
  const current = workspace || PRIVATE_WORKSPACE;
  if (current.scope === 'group' && current.id) {
    return {
      group_id: current.id,
      source_scope: 'group',
      source_group_id: current.id,
      source_organization_id: null,
    };
  }
  if (current.scope === 'organization' && current.id) {
    return {
      group_id: null,
      source_scope: 'organization',
      source_group_id: null,
      source_organization_id: current.id,
    };
  }
  return {
    group_id: null,
    source_scope: 'private',
    source_group_id: null,
    source_organization_id: null,
  };
}

export function getWorkspaceLabel(workspace) {
  const current = workspace || PRIVATE_WORKSPACE;
  if (current.scope === 'group') return `Gruppe · ${current.name}`;
  if (current.scope === 'organization') return `Organisation · ${current.name}`;
  return 'Privater Workspace';
}

export const useWorkspaceStore = create((set) => ({
  activeWorkspace: readStoredWorkspace(),
  setActiveWorkspace: (workspace) => {
    const next = workspace?.scope === 'group' || workspace?.scope === 'organization'
      ? {
          scope: workspace.scope,
          id: String(workspace.id),
          name: workspace.name || (workspace.scope === 'group' ? 'Gruppe' : 'Organisation'),
          color: workspace.color || (workspace.scope === 'group' ? '#5856D6' : '#FF9500'),
        }
      : PRIVATE_WORKSPACE;
    writeStoredWorkspace(next);
    set({ activeWorkspace: next });
  },
  resetWorkspace: () => {
    writeStoredWorkspace(PRIVATE_WORKSPACE);
    set({ activeWorkspace: PRIVATE_WORKSPACE });
  },
}));