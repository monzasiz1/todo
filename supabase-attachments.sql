-- Task Attachments
CREATE TABLE IF NOT EXISTS task_attachments (
  id SERIAL PRIMARY KEY,
  task_id INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  file_name TEXT NOT NULL,
  file_type TEXT NOT NULL,          -- MIME type (image/jpeg, application/pdf, etc.)
  file_size INTEGER NOT NULL,       -- bytes
  file_data TEXT NOT NULL,           -- base64-encoded file content
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_task_attachments_task ON task_attachments(task_id);

-- Max 10 attachments per task (enforced in API, not DB)
