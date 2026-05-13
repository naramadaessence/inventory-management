-- ============================================
-- Migration 004: Refill Completions Tracking
-- Run this in Supabase SQL Editor
-- ============================================

CREATE TABLE IF NOT EXISTS refill_completions (
  id SERIAL PRIMARY KEY,
  party_id INTEGER NOT NULL REFERENCES parties(id) ON DELETE CASCADE,
  month INTEGER NOT NULL CHECK (month >= 1 AND month <= 12),
  year INTEGER NOT NULL CHECK (year >= 2020),
  completed_by TEXT,
  completed_at TIMESTAMPTZ DEFAULT NOW(),
  notes TEXT,
  UNIQUE(party_id, month, year)
);

ALTER TABLE refill_completions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "refill_completions_select" ON refill_completions FOR SELECT USING (true);
CREATE POLICY "refill_completions_insert" ON refill_completions FOR INSERT WITH CHECK (true);
CREATE POLICY "refill_completions_delete" ON refill_completions FOR DELETE USING (true);

CREATE INDEX IF NOT EXISTS idx_refill_completions_lookup ON refill_completions(party_id, month, year);
