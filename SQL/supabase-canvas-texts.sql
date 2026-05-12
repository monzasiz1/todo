-- Canvas text elements for the notes board
CREATE TABLE IF NOT EXISTS note_canvas_texts (
  id           TEXT PRIMARY KEY,
  user_id      TEXT NOT NULL,
  text         TEXT NOT NULL DEFAULT '',
  x            FLOAT NOT NULL DEFAULT 100,
  y            FLOAT NOT NULL DEFAULT 100,
  font_family  TEXT NOT NULL DEFAULT '-apple-system, "SF Pro Display", "Helvetica Neue", Arial, sans-serif',
  font_size    FLOAT NOT NULL DEFAULT 32,
  font_weight  INTEGER NOT NULL DEFAULT 600,
  font_color   TEXT NOT NULL DEFAULT '',
  attached_note_id TEXT DEFAULT NULL,
  offset_x     FLOAT NOT NULL DEFAULT 0,
  offset_y     FLOAT NOT NULL DEFAULT 0,
  created_at   BIGINT NOT NULL DEFAULT (EXTRACT(EPOCH FROM NOW()) * 1000)
);

CREATE INDEX IF NOT EXISTS idx_note_canvas_texts_user_id ON note_canvas_texts(user_id);
