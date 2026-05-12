-- Migration: task_dismissals
-- Ermöglicht Nutzern, geteilte/Gruppen-Tasks aus ihrem eigenen Kalender zu entfernen,
-- ohne die eigentliche Aufgabe zu löschen.

CREATE TABLE IF NOT EXISTS task_dismissals (
  user_id   INTEGER      NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  task_id   INTEGER      NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  dismissed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (user_id, task_id)
);

CREATE INDEX IF NOT EXISTS idx_task_dismissals_user_id ON task_dismissals(user_id);
CREATE INDEX IF NOT EXISTS idx_task_dismissals_task_id ON task_dismissals(task_id);
