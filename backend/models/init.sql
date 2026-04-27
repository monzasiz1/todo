-- AI Todo Calendar Database Schema

CREATE TABLE IF NOT EXISTS users (
  id SERIAL PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  email VARCHAR(255) UNIQUE NOT NULL,
  password VARCHAR(255) NOT NULL,
  email_verified BOOLEAN DEFAULT FALSE,
  email_verification_token VARCHAR(128),
  twofa_enabled BOOLEAN DEFAULT FALSE,
  twofa_secret VARCHAR(128),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS categories (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name VARCHAR(100) NOT NULL,
  color VARCHAR(7) DEFAULT '#007AFF',
  icon VARCHAR(50) DEFAULT 'folder',
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS tasks (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title VARCHAR(500) NOT NULL,
  description TEXT,
  date DATE,
  date_end DATE,
  time TIME,
  time_end TIME,
  category_id INTEGER REFERENCES categories(id) ON DELETE SET NULL,
  priority VARCHAR(20) DEFAULT 'medium' CHECK (priority IN ('low', 'medium', 'high', 'urgent')),
  completed BOOLEAN DEFAULT FALSE,
  sort_order INTEGER DEFAULT 0,
  reminder_at TIMESTAMP WITH TIME ZONE,
  reminder_sent BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_tasks_user_id ON tasks(user_id);
CREATE INDEX IF NOT EXISTS idx_tasks_date ON tasks(user_id, date);
CREATE INDEX IF NOT EXISTS idx_tasks_category ON tasks(user_id, category_id);
CREATE INDEX IF NOT EXISTS idx_tasks_reminder ON tasks(reminder_at) WHERE reminder_sent = FALSE;
CREATE INDEX IF NOT EXISTS idx_categories_user_id ON categories(user_id);
