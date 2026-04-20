-- Push Subscriptions für Web Push Notifications
CREATE TABLE IF NOT EXISTS push_subscriptions (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  endpoint TEXT NOT NULL,
  keys_p256dh TEXT NOT NULL,
  keys_auth TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id, endpoint)
);

-- Notification Log (verhindert Spam + trackt gesendete Notifications)
CREATE TABLE IF NOT EXISTS notification_log (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type TEXT NOT NULL, -- 'reminder', 'daily_tasks', 'engagement', 'team_task', 'team_assign'
  task_id INTEGER REFERENCES tasks(id) ON DELETE SET NULL,
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  sent_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_push_sub_user ON push_subscriptions(user_id);
CREATE INDEX IF NOT EXISTS idx_notif_log_user_type ON notification_log(user_id, type, sent_at);

-- Track user last activity (für Engagement-Notifications)
ALTER TABLE users ADD COLUMN IF NOT EXISTS last_active_at TIMESTAMPTZ DEFAULT NOW();

-- Notification Preferences pro User (welche Typen aktiv)
ALTER TABLE users ADD COLUMN IF NOT EXISTS notification_prefs JSONB DEFAULT '{"reminder":true,"daily_tasks":true,"engagement":true,"team_task":true}'::jsonb;
