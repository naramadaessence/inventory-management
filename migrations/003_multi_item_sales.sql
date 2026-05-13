-- ============================================
-- Migration 003: Multi-Item Sales (sale_items table)
-- Run this in Supabase SQL Editor BEFORE deploying new code
-- ============================================

-- Step 1: Create sale_items table
CREATE TABLE IF NOT EXISTS sale_items (
  id SERIAL PRIMARY KEY,
  sale_id INTEGER NOT NULL REFERENCES sales(id) ON DELETE CASCADE,
  product_id INTEGER NOT NULL REFERENCES products(id),
  quantity DECIMAL NOT NULL,
  unit_price DECIMAL NOT NULL,
  line_total DECIMAL NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Step 2: Migrate existing single-product sales into sale_items
INSERT INTO sale_items (sale_id, product_id, quantity, unit_price, line_total)
SELECT id, product_id, quantity, unit_price, total_amount
FROM sales
WHERE product_id IS NOT NULL;

-- Step 3: Drop product-level columns from sales (now in sale_items)
ALTER TABLE sales DROP COLUMN IF EXISTS product_id;
ALTER TABLE sales DROP COLUMN IF EXISTS quantity;
ALTER TABLE sales DROP COLUMN IF EXISTS unit_price;

-- Step 4: Enable RLS on sale_items
ALTER TABLE sale_items ENABLE ROW LEVEL SECURITY;

-- Step 5: Allow all authenticated users to read/write sale_items
CREATE POLICY "sale_items_select" ON sale_items FOR SELECT USING (true);
CREATE POLICY "sale_items_insert" ON sale_items FOR INSERT WITH CHECK (true);
CREATE POLICY "sale_items_update" ON sale_items FOR UPDATE USING (true) WITH CHECK (true);
CREATE POLICY "sale_items_delete" ON sale_items FOR DELETE USING (true);

-- Step 6: Create index for fast lookups by sale_id
CREATE INDEX IF NOT EXISTS idx_sale_items_sale_id ON sale_items(sale_id);
CREATE INDEX IF NOT EXISTS idx_sale_items_product_id ON sale_items(product_id);
