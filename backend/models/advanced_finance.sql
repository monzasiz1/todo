-- Advanced Finance System Schema
-- Net Worth, Goals, Cashflow Timeline, Fixed/Variable Expenses

-- 1. USER ACCOUNTS & ASSETS (Net Worth System)
CREATE TABLE IF NOT EXISTS user_accounts (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name VARCHAR(120) NOT NULL,
  type VARCHAR(50) NOT NULL CHECK (type IN ('checking', 'savings', 'investment', 'crypto', 'cash')),
  balance NUMERIC(12,2) DEFAULT 0,
  currency VARCHAR(3) DEFAULT 'EUR',
  color VARCHAR(7) DEFAULT '#007AFF',
  icon VARCHAR(50) DEFAULT 'wallet',
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id, name)
);

CREATE TABLE IF NOT EXISTS user_liabilities (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name VARCHAR(120) NOT NULL,
  type VARCHAR(50) NOT NULL CHECK (type IN ('credit_card', 'loan', 'mortgage', 'other')),
  amount_owed NUMERIC(12,2) DEFAULT 0,
  interest_rate NUMERIC(5,2) DEFAULT 0,
  monthly_payment NUMERIC(10,2) DEFAULT 0,
  currency VARCHAR(3) DEFAULT 'EUR',
  due_date DATE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 2. FINANCIAL GOALS (Sparziele mit Fortschritt)
CREATE TABLE IF NOT EXISTS financial_goals (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title VARCHAR(200) NOT NULL,
  description TEXT,
  target_amount NUMERIC(12,2) NOT NULL,
  current_amount NUMERIC(12,2) DEFAULT 0,
  category VARCHAR(50) DEFAULT 'other',
  emoji VARCHAR(10),
  priority VARCHAR(20) DEFAULT 'medium' CHECK (priority IN ('low', 'medium', 'high')),
  target_date DATE,
  auto_save_monthly NUMERIC(10,2),
  status VARCHAR(20) DEFAULT 'active' CHECK (status IN ('active', 'paused', 'completed', 'cancelled')),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 3. EXPENSE CLASSIFICATION (Fixed vs Variable)
CREATE TABLE IF NOT EXISTS expense_classifications (
  id SERIAL PRIMARY KEY,
  spending_group_id INTEGER REFERENCES spending_groups(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  spending_expense_id INTEGER NOT NULL REFERENCES spending_expenses(id) ON DELETE CASCADE,
  classification VARCHAR(50) NOT NULL CHECK (classification IN ('fixed', 'variable', 'discretionary')),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(spending_expense_id)
);

-- 4. CASHFLOW TIMELINE (Events für Timeline View)
CREATE TABLE IF NOT EXISTS cashflow_events (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  spending_group_id INTEGER REFERENCES spending_groups(id) ON DELETE CASCADE,
  title VARCHAR(200) NOT NULL,
  description TEXT,
  event_type VARCHAR(50) NOT NULL CHECK (event_type IN ('income', 'expense', 'goal_milestone', 'bill_due', 'investment')),
  amount NUMERIC(10,2),
  scheduled_date DATE NOT NULL,
  is_recurring BOOLEAN DEFAULT FALSE,
  recurrence_pattern VARCHAR(20),
  estimated BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 5. RECURRING TRANSACTION TEMPLATES
CREATE TABLE IF NOT EXISTS recurring_templates (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  spending_group_id INTEGER REFERENCES spending_groups(id) ON DELETE CASCADE,
  title VARCHAR(200) NOT NULL,
  description TEXT,
  amount NUMERIC(10,2) NOT NULL,
  category VARCHAR(40),
  frequency VARCHAR(20) NOT NULL CHECK (frequency IN ('daily', 'weekly', 'biweekly', 'monthly', 'quarterly', 'yearly')),
  next_occurrence DATE NOT NULL,
  last_executed DATE,
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 6. FUTURE PROJECTIONS (Time Machine Daten)
CREATE TABLE IF NOT EXISTS financial_projections (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  projection_month DATE NOT NULL,
  projected_income NUMERIC(12,2) DEFAULT 0,
  projected_expenses NUMERIC(12,2) DEFAULT 0,
  projected_balance NUMERIC(12,2) DEFAULT 0,
  confidence_level VARCHAR(20) DEFAULT 'medium',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id, projection_month)
);

-- INDEXES FOR PERFORMANCE
CREATE INDEX IF NOT EXISTS idx_accounts_user ON user_accounts(user_id);
CREATE INDEX IF NOT EXISTS idx_liabilities_user ON user_liabilities(user_id);
CREATE INDEX IF NOT EXISTS idx_goals_user ON financial_goals(user_id);
CREATE INDEX IF NOT EXISTS idx_goals_status ON financial_goals(user_id, status);
CREATE INDEX IF NOT EXISTS idx_expense_class ON expense_classifications(spending_expense_id);
CREATE INDEX IF NOT EXISTS idx_cashflow_user ON cashflow_events(user_id);
CREATE INDEX IF NOT EXISTS idx_cashflow_date ON cashflow_events(scheduled_date);
CREATE INDEX IF NOT EXISTS idx_recurring_user ON recurring_templates(user_id);
CREATE INDEX IF NOT EXISTS idx_projections_user_month ON financial_projections(user_id, projection_month);
