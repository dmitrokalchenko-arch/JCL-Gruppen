-- Migration: Fördermitglieder / Unterstützende Mitglieder
-- Ausführen in Supabase SQL Editor (einmalig)
-- Sicher für bestehende Daten: nur ADD COLUMN IF NOT EXISTS / CREATE INDEX IF NOT EXISTS,
-- keine Datenlöschung, keine Änderung bestehender Werte.

-- 1. Neue Felder hinzufügen (falls nicht vorhanden)
ALTER TABLE public.students
  ADD COLUMN IF NOT EXISTS mitglied_typ TEXT DEFAULT 'AKTIV',
  ADD COLUMN IF NOT EXISTS training_relevant TEXT DEFAULT 'JA',
  ADD COLUMN IF NOT EXISTS foerdermitglied_seit DATE,
  ADD COLUMN IF NOT EXISTS buchhaltung_kommentar TEXT;

-- 2. Bestehende Zeilen ohne Wert auf den Default setzen (NULL-Werte vor Constraint absichern)
UPDATE public.students SET mitglied_typ = 'AKTIV' WHERE mitglied_typ IS NULL;
UPDATE public.students SET training_relevant = 'JA' WHERE training_relevant IS NULL;

-- 3. Check-Constraints (nur neue Constraints, bestehende Constraints bleiben unberührt)
ALTER TABLE public.students
  DROP CONSTRAINT IF EXISTS students_mitglied_typ_check;

ALTER TABLE public.students
  ADD CONSTRAINT students_mitglied_typ_check
  CHECK (mitglied_typ IN ('AKTIV', 'FOERDERMITGLIED', 'PROBETRAINING', 'INAKTIV', 'ARCHIV'));

ALTER TABLE public.students
  DROP CONSTRAINT IF EXISTS students_training_relevant_check;

ALTER TABLE public.students
  ADD CONSTRAINT students_training_relevant_check
  CHECK (training_relevant IN ('JA', 'NEIN'));

-- 4. Indizes
CREATE INDEX IF NOT EXISTS idx_students_club_mitglied_typ
  ON public.students (club_id, mitglied_typ);

CREATE INDEX IF NOT EXISTS idx_students_club_buchhaltung_relevant
  ON public.students (club_id, buchhaltung_relevant);
