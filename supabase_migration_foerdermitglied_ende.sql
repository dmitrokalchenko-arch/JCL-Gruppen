-- Migration: Fördermitglied beenden/archivieren
-- Ausführen in Supabase SQL Editor (einmalig)
-- Sicher für bestehende Daten: nur ADD COLUMN IF NOT EXISTS, keine Datenlöschung.

ALTER TABLE public.students
  ADD COLUMN IF NOT EXISTS foerdermitglied_ende DATE,
  ADD COLUMN IF NOT EXISTS archiviert_am DATE;
