import { Lock, Users, UserCheck, Eye } from 'lucide-react';

export default function SharedTaskBadge({ task }) {
  if (!task) return null;

  const { visibility, is_owner, creator_name, creator_color, can_edit, last_editor_name } = task;

  if (visibility === 'private' || !visibility) return null;

  const getVisibilityIcon = () => {
    switch (visibility) {
      case 'shared': return <Users size={12} />;
      case 'selected_users': return <UserCheck size={12} />;
      default: return <Lock size={12} />;
    }
  };

  const getVisibilityLabel = () => {
    switch (visibility) {
      case 'shared': return 'Geteilt';
      case 'selected_users': return 'Auswahl';
      default: return 'Privat';
    }
  };

  return (
    <div className="shared-task-badge">
      <span className={`visibility-badge ${visibility}`}>
        {getVisibilityIcon()}
        {getVisibilityLabel()}
      </span>
      {!is_owner && creator_name && (
        <span className="creator-badge">
          <span
            className="creator-dot"
            style={{ background: creator_color || '#007AFF' }}
          />
          {creator_name}
        </span>
      )}
      {!can_edit && !is_owner && (
        <span className="readonly-badge">
          <Eye size={10} /> Nur lesen
        </span>
      )}
      {last_editor_name && (
        <span className="last-editor-badge">
          Bearbeitet von {last_editor_name}
        </span>
      )}
    </div>
  );
}
