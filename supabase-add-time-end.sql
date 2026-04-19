-- Add time_end and date_end columns for time/date ranges
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS time_end TIME;
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS date_end DATE;
