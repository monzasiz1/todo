-- Add type column to tasks table to distinguish between tasks (Aufgaben) and events (Termine)
-- 'task' = Aufgabe (can be completed/checked off)
-- 'event' = Termin/Kalendereintrag (cannot be completed, just exists)

ALTER TABLE tasks ADD COLUMN IF NOT EXISTS type VARCHAR(10) DEFAULT 'task' CHECK (type IN ('task', 'event'));
