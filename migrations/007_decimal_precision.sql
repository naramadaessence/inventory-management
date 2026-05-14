-- ============================================
-- Migration 007: Fix liquid stock precision
-- Run this in Supabase SQL Editor.
-- ============================================
--
-- Problem:
--   Liquid products are tracked in kg with 3-decimal display
--   (`formatWeight` in helpers.js does `.toFixed(3)`), but several
--   columns are typed `DECIMAL(12,2)` — which silently rounds at
--   write time. Storing 4.567 kg becomes 4.57 kg = 7g lost per row.
--   Over thousands of operations the drift accumulates and reconciles
--   against physical stock fails.
--
-- Fix:
--   Promote quantity / stock columns to DECIMAL(12,3). This is a
--   widening conversion — existing data is preserved exactly
--   (4.57 stays 4.57; the column simply allows one more decimal
--   for new writes).
--
-- Currency columns (total_amount, unit_price, amount_received,
-- line_total) stay at DECIMAL(12,2) — paise precision, no need
-- for sub-paise.

ALTER TABLE products
  ALTER COLUMN current_stock        TYPE DECIMAL(12,3),
  ALTER COLUMN min_stock_threshold  TYPE DECIMAL(12,3),
  ALTER COLUMN max_daily_consumption TYPE DECIMAL(12,3);

ALTER TABLE checkout_items
  ALTER COLUMN checkout_quantity TYPE DECIMAL(12,3),
  ALTER COLUMN checkin_quantity  TYPE DECIMAL(12,3);

ALTER TABLE stock_intakes
  ALTER COLUMN quantity TYPE DECIMAL(12,3);

ALTER TABLE inventory_transactions
  ALTER COLUMN quantity TYPE DECIMAL(12,3);

ALTER TABLE damage_reports
  ALTER COLUMN quantity TYPE DECIMAL(12,3);

-- sale_items.quantity is already plain `DECIMAL` (NUMERIC, unbounded
-- precision) — no change needed.
