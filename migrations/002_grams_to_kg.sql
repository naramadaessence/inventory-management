-- ============================================
-- MIGRATION: Convert liquid products from grams to KG
-- Run this ONCE in Supabase SQL Editor
-- ============================================

-- 1. PRODUCTS: current_stock, min_stock_threshold, max_daily_consumption (grams → kg), unit_price (₹/gram → ₹/kg)
UPDATE products SET
  current_stock = current_stock / 1000.0,
  min_stock_threshold = min_stock_threshold / 1000.0,
  max_daily_consumption = CASE WHEN max_daily_consumption IS NOT NULL THEN max_daily_consumption / 1000.0 ELSE NULL END,
  unit_price = unit_price * 1000
WHERE type = 'liquid';

-- 2. SALES: quantity (grams → kg), unit_price (₹/gram → ₹/kg)
-- total_amount stays the same (grams × ₹/gram = kg × ₹/kg)
UPDATE sales SET
  quantity = quantity / 1000.0,
  unit_price = unit_price * 1000
WHERE product_id IN (SELECT id FROM products WHERE type = 'liquid');

-- 3. CHECKOUT_ITEMS: checkout_quantity and checkin_quantity (grams → kg)
UPDATE checkout_items SET
  checkout_quantity = checkout_quantity / 1000.0,
  checkin_quantity = CASE WHEN checkin_quantity IS NOT NULL THEN checkin_quantity / 1000.0 ELSE NULL END
WHERE product_id IN (SELECT id FROM products WHERE type = 'liquid');

-- 4. STOCK_INTAKES: quantity (grams → kg)
UPDATE stock_intakes SET
  quantity = quantity / 1000.0
WHERE product_id IN (SELECT id FROM products WHERE type = 'liquid');

-- 5. INVENTORY_TRANSACTIONS: quantity (grams → kg)
UPDATE inventory_transactions SET
  quantity = quantity / 1000.0
WHERE product_id IN (SELECT id FROM products WHERE type = 'liquid');

-- 6. PARTIES: custom_category_rates — liquid category rates (₹/gram → ₹/kg)
-- This updates each key in the JSONB where the category is liquid type
UPDATE parties SET custom_category_rates = (
  SELECT jsonb_object_agg(
    key,
    CASE
      WHEN EXISTS (SELECT 1 FROM categories WHERE id = key::int AND type = 'liquid')
      THEN to_jsonb((value::numeric * 1000)::numeric)
      ELSE value
    END
  )
  FROM jsonb_each(custom_category_rates)
)
WHERE custom_category_rates IS NOT NULL
  AND custom_category_rates != '{}'::jsonb
  AND jsonb_typeof(custom_category_rates) = 'object';
