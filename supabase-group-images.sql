-- Gruppenbilder: Spalte für Bild-URL/Base64 in groups hinzufügen
ALTER TABLE groups ADD COLUMN IF NOT EXISTS image_url TEXT DEFAULT NULL;
