export default function AvatarBadge({
  name,
  color = '#007AFF',
  avatarUrl,
  size = 32,
  className = '',
}) {
  const initial = name?.trim()?.charAt(0)?.toUpperCase() || '?';

  return (
    <span
      className={className}
      style={{
        width: size,
        height: size,
        borderRadius: '50%',
        background: color,
        color: '#fff',
        fontWeight: 700,
        fontSize: Math.max(10, Math.round(size * 0.4)),
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        overflow: 'hidden',
        flexShrink: 0,
      }}
      aria-label={name || 'Avatar'}
      title={name || 'Avatar'}
    >
      {avatarUrl ? (
        <img
          src={avatarUrl}
          alt={name || 'Avatar'}
          style={{ width: '100%', height: '100%', objectFit: 'cover' }}
        />
      ) : (
        initial
      )}
    </span>
  );
}
