-- Wiederkehrende Aufgaben: Recurrence-Spalten zur tasks-Tabelle hinzufügen

-- recurrence_rule: Art der Wiederholung
-- Values: 'daily', 'weekly', 'biweekly', 'monthly', 'yearly', 'weekdays'
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS recurrence_rule VARCHAR(20) DEFAULT NULL;

-- recurrence_interval: Alle N Perioden wiederholen (z.B. alle 2 Wochen)
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS recurrence_interval INTEGER DEFAULT 1;

-- recurrence_end: Optionales Enddatum der Wiederholung
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS recurrence_end DATE DEFAULT NULL;

-- recurrence_parent_id: Verknüpfung zur Eltern-Aufgabe (für generierte Instanzen)
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS recurrence_parent_id INTEGER REFERENCES tasks(id) ON DELETE SET NULL;
