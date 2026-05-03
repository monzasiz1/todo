import { Lock, Users, UserCheck, Eye } from 'lucide-react';
import AvatarBadge from './AvatarBadge';

export default function SharedTaskBadge({ task }) {
  if (!task) return null;

  const { visibility, is_owner, creator_name, creator_color, can_edit, last_editor_name, shared_with_users } = task;
  const showReadOnlyBadge = is_owner === false && can_edit === false;

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

  const sharedUsers = Array.isArray(shared_with_users) ? shared_with_users : [];
  const visibleSharedUsers = sharedUsers.slice(0, 4);
  const overflowSharedUsers = Math.max(0, sharedUsers.length - visibleSharedUsers.length);
  const isSelectedUsers = visibility === 'selected_users';
  const showSelectionCluster = isSelectedUsers && sharedUsers.length > 0;

  return (
    <div className="shared-task-badge">
      {showSelectionCluster ? (
        <div className={`shared-selection-cluster ${!is_owner && creator_name ? 'with-creator' : ''}`} title="Ausgewählte Personen und Ersteller">
          <span className={`visibility-badge ${visibility} in-cluster`}>
            {getVisibilityIcon()}
            {getVisibilityLabel()}
          </span>
          <div className="shared-users-chips in-cluster">
            {visibleSharedUsers.map((u, i) => (
              <span key={i} className="shared-user-chip" title={u.name}>
                <AvatarBadge
                  className="shared-user-dot"
                  name={u.name}
                  color={u.color || '#007AFF'}
                  avatarUrl={u.avatar_url}
                  size={18}
                />
              </span>
            ))}
            {overflowSharedUsers > 0 && (
              <span className="shared-user-overflow" title={`+${overflowSharedUsers} weitere`}>
                +{overflowSharedUsers}
              </span>
            )}
          </div>
          {!is_owner && creator_name && (
            <span className="creator-pocket" title={`Ersteller: ${creator_name}`}>
              <span className="creator-badge in-cluster">
                <AvatarBadge
                  className="creator-dot"
                  name={creator_name}
                  color={creator_color || '#007AFF'}
                  avatarUrl={task.creator_avatar_url}
                  size={18}
                />
                <span className="creator-tag">E</span>
              </span>
            </span>
          )}
        </div>
      ) : (
        <>
          <span className={`visibility-badge ${visibility}`}>
            {getVisibilityIcon()}
            {getVisibilityLabel()}
          </span>
          {sharedUsers.length > 0 && (
            <div className="shared-users-chips">
              {visibleSharedUsers.map((u, i) => (
                <span key={i} className="shared-user-chip" title={u.name}>
                  <AvatarBadge
                    className="shared-user-dot"
                    name={u.name}
                    color={u.color || '#007AFF'}
                    avatarUrl={u.avatar_url}
                    size={18}
                  />
                </span>
              ))}
              {overflowSharedUsers > 0 && (
                <span className="shared-user-overflow" title={`+${overflowSharedUsers} weitere`}>
                  +{overflowSharedUsers}
                </span>
              )}
            </div>
          )}
          {!is_owner && creator_name && (
            <span className="creator-badge" title={`Erstellt von ${creator_name}`}>
              <AvatarBadge
                className="creator-dot"
                name={creator_name}
                color={creator_color || '#007AFF'}
                avatarUrl={task.creator_avatar_url}
                size={18}
              />
            </span>
          )}
        </>
      )}
      {showReadOnlyBadge && (
        <span className="readonly-badge">
          <Eye size={10} /> Nur lesen
        </span>
      )}
    </div>
  );
}
