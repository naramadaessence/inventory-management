-- ============================================================================
-- Migration 013: Add sell_qty and installed_qty columns to products table
-- ============================================================================

ALTER TABLE products
  ADD COLUMN IF NOT EXISTS sell_qty DECIMAL(12,3) NOT NULL DEFAULT 0 CHECK (sell_qty >= 0),
  ADD COLUMN IF NOT EXISTS installed_qty DECIMAL(12,3) NOT NULL DEFAULT 0 CHECK (installed_qty >= 0);
