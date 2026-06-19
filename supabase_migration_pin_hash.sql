-- Migration: PIN-Hashing für Trainers
-- Ausführen in Supabase SQL Editor (einmalig)

-- Neue Felder hinzufügen
ALTER TABLE trainers
  ADD COLUMN IF NOT EXISTS pin_hash TEXT,
  ADD COLUMN IF NOT EXISTS pin_salt TEXT;

-- Nach Migration: altes pin-Feld leeren (optional, erst wenn alle migriert)
-- UPDATE trainers SET pin = NULL WHERE pin_hash IS NOT NULL;

-- Prüfen welche Trainer noch kein Hash haben (noch nicht eingeloggt):
-- SELECT trainer_id, name, club_id FROM trainers WHERE pin_hash IS NULL AND pin IS NOT NULL;
