-- ============================================
-- Migration 016: Stock Reconciliation
-- Run after migration 015. Run ONCE in the Supabase SQL editor.
-- ============================================
--
-- Contract: knowledge-base/stock-reconciliation.md. Demo-mode mirror of every
-- function below: js/supabase.js (demoRpc).
--
-- Adds:
--   1. products.fragrance (pre-filled from product names; machines stay NULL).
--   2. Purchase fields on stock_intakes (date, rate, total, bill number).
--   3. Return cross-check fields on checkout_items / checkout_sessions
--      (used, difference, mismatch, admin classification).
--   4. New tables: checkout_usage (what staff used stock for),
--      stock_adjustments (stock edits waiting for admin approval),
--      app_settings (matching tolerances).
--   5. inventory_transactions.type 'installed'.
--   6. RPCs: record_purchase, submit_return, approve_return (new 3-arg
--      signature, old 2-arg version dropped), reject_return,
--      request_stock_adjustment, review_stock_adjustment, plus the helper
--      is_machine_product.
--   7. RLS for the new tables (checkout_usage is written only by the RPCs).
--
-- Legacy rows: returns submitted before this migration keep
-- used_quantity = NULL and has_mismatch = false and approve as before.
-- Legacy stock_intakes keep purchase_date / purchase_rate / total_amount NULL.

BEGIN;

-- --------------------------------------------------------
-- 1. Columns on existing tables
-- --------------------------------------------------------
ALTER TABLE products
  ADD COLUMN IF NOT EXISTS fragrance TEXT;

-- purchase_date gets its default AFTER the column exists so legacy rows stay
-- NULL instead of being stamped with today's date.
ALTER TABLE stock_intakes
  ADD COLUMN IF NOT EXISTS purchase_date DATE,
  ADD COLUMN IF NOT EXISTS purchase_rate NUMERIC(12,2) CHECK (purchase_rate >= 0),
  ADD COLUMN IF NOT EXISTS total_amount NUMERIC(12,2),
  ADD COLUMN IF NOT EXISTS bill_number TEXT;
ALTER TABLE stock_intakes
  ALTER COLUMN purchase_date SET DEFAULT CURRENT_DATE;

ALTER TABLE checkout_items
  ADD COLUMN IF NOT EXISTS used_quantity NUMERIC(12,3),
  ADD COLUMN IF NOT EXISTS difference NUMERIC(12,3),
  ADD COLUMN IF NOT EXISTS has_mismatch BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS discrepancy_type TEXT
    CHECK (discrepancy_type IN ('wastage', 'loss', 'staff_shortage', 'counting_error', 'excess_return', 'other')),
  ADD COLUMN IF NOT EXISTS discrepancy_note TEXT;

ALTER TABLE checkout_sessions
  ADD COLUMN IF NOT EXISTS has_discrepancy BOOLEAN DEFAULT false;

ALTER TABLE inventory_transactions
  DROP CONSTRAINT IF EXISTS inventory_transactions_type_check;
ALTER TABLE inventory_transactions
  ADD CONSTRAINT inventory_transactions_type_check
  CHECK (type IN (
    'checkout',
    'checkin',
    'sale',
    'sale_edit',
    'sale_edit_restore',
    'sale_delete',
    'rental_out',
    'rental_return',
    'damage',
    'stock_in',
    'adjustment',
    'installed'
  ));

-- --------------------------------------------------------
-- 2. New tables
-- --------------------------------------------------------
CREATE TABLE IF NOT EXISTS checkout_usage (
  id SERIAL PRIMARY KEY,
  item_id INTEGER NOT NULL REFERENCES checkout_items(id) ON DELETE CASCADE,
  session_id INTEGER NOT NULL REFERENCES checkout_sessions(id) ON DELETE CASCADE,
  product_id INTEGER NOT NULL REFERENCES products(id),
  reason TEXT NOT NULL CHECK (reason IN ('customer_service', 'installation', 'other')),
  quantity NUMERIC(12,3) NOT NULL CHECK (quantity > 0),
  party_id INTEGER REFERENCES parties(id) ON DELETE SET NULL,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_checkout_usage_session_id ON checkout_usage(session_id);
CREATE INDEX IF NOT EXISTS idx_checkout_usage_item_id ON checkout_usage(item_id);

CREATE TABLE IF NOT EXISTS stock_adjustments (
  id SERIAL PRIMARY KEY,
  product_id INTEGER NOT NULL REFERENCES products(id),
  stock_at_request NUMERIC(12,3) NOT NULL,
  requested_stock NUMERIC(12,3) NOT NULL CHECK (requested_stock >= 0),
  delta NUMERIC(12,3) NOT NULL,
  reason TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
  requested_by UUID REFERENCES profiles(id),
  reviewed_by UUID REFERENCES profiles(id),
  reviewed_at TIMESTAMPTZ,
  review_note TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);
-- At most one pending request per product (request_stock_adjustment checks
-- this too, with a friendlier message).
CREATE UNIQUE INDEX IF NOT EXISTS idx_stock_adjustments_one_pending
  ON stock_adjustments(product_id) WHERE status = 'pending';

CREATE TABLE IF NOT EXISTS app_settings (
  id SERIAL PRIMARY KEY,
  key TEXT UNIQUE NOT NULL,
  value NUMERIC
);
INSERT INTO app_settings (key, value) VALUES
  ('liquid_tolerance_kg', 0.010),
  ('unit_tolerance', 0)
ON CONFLICT (key) DO NOTHING;

-- --------------------------------------------------------
-- 3. RLS for the new tables
-- --------------------------------------------------------
ALTER TABLE checkout_usage ENABLE ROW LEVEL SECURITY;
ALTER TABLE stock_adjustments ENABLE ROW LEVEL SECURITY;
ALTER TABLE app_settings ENABLE ROW LEVEL SECURITY;

-- checkout_usage: read-only through the API; written only by submit_return /
-- reject_return (SECURITY DEFINER).
DROP POLICY IF EXISTS "View own or admin usage" ON checkout_usage;
CREATE POLICY "View own or admin usage" ON checkout_usage
  FOR SELECT USING (
    is_admin() OR EXISTS (
      SELECT 1 FROM checkout_sessions
       WHERE checkout_sessions.id = checkout_usage.session_id
         AND checkout_sessions.seller_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "Admins manage stock adjustments" ON stock_adjustments;
CREATE POLICY "Admins manage stock adjustments" ON stock_adjustments
  FOR ALL USING (is_admin()) WITH CHECK (is_admin());

DROP POLICY IF EXISTS "Authenticated read app settings" ON app_settings;
CREATE POLICY "Authenticated read app settings" ON app_settings
  FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS "Admins manage app settings" ON app_settings;
CREATE POLICY "Admins manage app settings" ON app_settings
  FOR ALL USING (is_admin()) WITH CHECK (is_admin());

-- --------------------------------------------------------
-- 4. Helper: machine = unit category whose name is not a refill / oil
--    (same rule as isMachineProduct in js/supabase.js and
--    isMachineCategory in js/utils/helpers.js).
-- --------------------------------------------------------
CREATE OR REPLACE FUNCTION is_machine_product(p_product_id INTEGER)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE((
    SELECT c.type = 'unit' AND c.name !~* '(refill|oil)'
      FROM products p
      JOIN categories c ON c.id = p.category_id
     WHERE p.id = p_product_id
  ), false);
$$;

-- --------------------------------------------------------
-- 5. Fragrance pre-fill (non-machines only, only where still NULL):
--    strip leading non-letters and a trailing "Diffuser Oil" / "Refill" /
--    "Oil", trim, title-case. Same rule as deriveFragrance in js/supabase.js.
-- --------------------------------------------------------
UPDATE products
   SET fragrance = NULLIF(initcap(regexp_replace(
         regexp_replace(
           regexp_replace(name, '^[^A-Za-z]+', ''),
           '\s*(diffuser\s+oil|refill|oil)\s*$', '', 'i'),
         '^\s+|\s+$', '', 'g')), '')
 WHERE fragrance IS NULL
   AND NOT is_machine_product(id);

-- --------------------------------------------------------
-- 6. record_purchase - purchase entry with supplier, rate and bill.
-- --------------------------------------------------------
CREATE OR REPLACE FUNCTION record_purchase(
  p_product_id INTEGER,
  p_quantity NUMERIC,
  p_purchase_rate NUMERIC,
  p_supplier TEXT,
  p_bill_number TEXT DEFAULT NULL,
  p_purchase_date DATE DEFAULT NULL,
  p_notes TEXT DEFAULT NULL,
  p_received_by UUID DEFAULT NULL
)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor UUID := auth.uid();
  v_supplier TEXT := btrim(COALESCE(p_supplier, ''));
  v_bill TEXT := NULLIF(btrim(COALESCE(p_bill_number, '')), '');
  v_intake_id INTEGER;
BEGIN
  IF v_actor IS NULL OR NOT is_admin() THEN
    RAISE EXCEPTION 'Only admins can record purchases'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF p_received_by IS NOT NULL AND p_received_by <> v_actor THEN
    RAISE EXCEPTION 'Receiver must match authenticated user'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  PERFORM 1 FROM products WHERE id = p_product_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Product % does not exist', p_product_id
      USING ERRCODE = 'foreign_key_violation';
  END IF;

  IF p_quantity IS NULL OR p_quantity <= 0 THEN
    RAISE EXCEPTION 'Quantity must be greater than zero'
      USING ERRCODE = 'check_violation';
  END IF;

  IF p_purchase_rate IS NULL OR p_purchase_rate < 0 THEN
    RAISE EXCEPTION 'Purchase rate must be zero or more'
      USING ERRCODE = 'check_violation';
  END IF;

  IF v_supplier = '' THEN
    RAISE EXCEPTION 'Supplier name is required'
      USING ERRCODE = 'check_violation';
  END IF;

  INSERT INTO stock_intakes (
    product_id, quantity, supplier, bill_number, purchase_date,
    purchase_rate, total_amount, notes, received_by
  ) VALUES (
    p_product_id, p_quantity, v_supplier, v_bill, COALESCE(p_purchase_date, CURRENT_DATE),
    p_purchase_rate, round(p_quantity * p_purchase_rate, 2), p_notes, v_actor
  )
  RETURNING id INTO v_intake_id;

  PERFORM adjust_stock(p_product_id, p_quantity);

  INSERT INTO inventory_transactions (
    product_id, type, quantity, reference_type, reference_id, performed_by, notes
  ) VALUES (
    p_product_id, 'stock_in', p_quantity, 'stock_intake', v_intake_id, v_actor,
    'Purchase from ' || v_supplier || COALESCE(' (bill ' || v_bill || ')', '')
  );

  RETURN v_intake_id;
END;
$$;

-- --------------------------------------------------------
-- 7. submit_return - staff (or admin) records Returned + Used per item.
--    Difference = Issued - Returned - Used; |Difference| > tolerance is a
--    mismatch the admin must classify on approval. No stock change here.
--
--    p_items: [{ "item_id": 1, "returned_quantity": 2,
--                "usage": [{ "reason": "installation", "quantity": 1,
--                            "party_id": 4, "notes": "..." }] }]
--    Returns { "has_discrepancy": bool }.
-- --------------------------------------------------------
CREATE OR REPLACE FUNCTION submit_return(
  p_session_id INTEGER,
  p_items JSONB,
  p_notes TEXT DEFAULT NULL,
  p_submitted_by UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor UUID := auth.uid();
  v_session checkout_sessions%ROWTYPE;
  v_item_count INTEGER;
  v_input JSONB;
  v_usage JSONB;
  v_item checkout_items%ROWTYPE;
  v_product products%ROWTYPE;
  v_is_machine BOOLEAN;
  v_seen INTEGER[] := '{}';
  v_item_id INTEGER;
  v_returned NUMERIC;
  v_used NUMERIC;
  v_u_qty NUMERIC;
  v_u_reason TEXT;
  v_u_party INTEGER;
  v_difference NUMERIC;
  v_consumed NUMERIC;
  v_limit NUMERIC;
  v_tolerance NUMERIC;
  v_mismatch BOOLEAN;
  v_reasons TEXT[];
  v_flag_reason TEXT;
  v_has_discrepancy BOOLEAN := false;
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'Authentication required'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF p_submitted_by IS NOT NULL AND p_submitted_by <> v_actor THEN
    RAISE EXCEPTION 'Submitter must match authenticated user'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  SELECT * INTO v_session FROM checkout_sessions WHERE id = p_session_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Session % not found', p_session_id;
  END IF;

  IF NOT is_admin() AND v_session.seller_id IS DISTINCT FROM v_actor THEN
    RAISE EXCEPTION 'Only the assigned staff member or an admin can submit this return'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF v_session.status <> 'checked_out' THEN
    RAISE EXCEPTION 'Session % is not checked out', p_session_id;
  END IF;

  PERFORM 1 FROM checkout_items WHERE session_id = p_session_id FOR UPDATE;
  GET DIAGNOSTICS v_item_count = ROW_COUNT;

  IF p_items IS NULL OR jsonb_typeof(p_items) <> 'array' OR jsonb_array_length(p_items) <> v_item_count THEN
    RAISE EXCEPTION 'Every issued item must be included in the return'
      USING ERRCODE = 'check_violation';
  END IF;

  -- Re-submission after "Send back" replaces the previous usage lines.
  DELETE FROM checkout_usage WHERE session_id = p_session_id;

  FOR v_input IN SELECT * FROM jsonb_array_elements(p_items) LOOP
    BEGIN
      v_item_id := (v_input->>'item_id')::INTEGER;
    EXCEPTION WHEN others THEN
      v_item_id := NULL;
    END;

    SELECT * INTO v_item FROM checkout_items
     WHERE id = v_item_id AND session_id = p_session_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Return item does not belong to this session'
        USING ERRCODE = 'check_violation';
    END IF;

    IF v_item.id = ANY (v_seen) THEN
      RAISE EXCEPTION 'Return item listed twice'
        USING ERRCODE = 'check_violation';
    END IF;
    v_seen := v_seen || v_item.id;

    SELECT * INTO v_product FROM products WHERE id = v_item.product_id;
    v_is_machine := is_machine_product(v_item.product_id);

    BEGIN
      v_returned := round((v_input->>'returned_quantity')::NUMERIC, 3);
    EXCEPTION WHEN others THEN
      v_returned := NULL;
    END;
    IF v_returned IS NULL OR v_returned < 0 THEN
      RAISE EXCEPTION 'Invalid returned quantity for %', v_product.name
        USING ERRCODE = 'check_violation';
    END IF;

    IF v_input->'usage' IS NOT NULL AND jsonb_typeof(v_input->'usage') NOT IN ('array', 'null') THEN
      RAISE EXCEPTION 'Invalid usage reason'
        USING ERRCODE = 'check_violation';
    END IF;

    v_used := 0;
    FOR v_usage IN
      SELECT * FROM jsonb_array_elements(
        CASE WHEN jsonb_typeof(v_input->'usage') = 'array' THEN v_input->'usage' ELSE '[]'::jsonb END
      )
    LOOP
      v_u_reason := v_usage->>'reason';
      IF v_u_reason IS NULL OR v_u_reason NOT IN ('customer_service', 'installation', 'other') THEN
        RAISE EXCEPTION 'Invalid usage reason'
          USING ERRCODE = 'check_violation';
      END IF;

      BEGIN
        v_u_qty := round((v_usage->>'quantity')::NUMERIC, 3);
      EXCEPTION WHEN others THEN
        v_u_qty := NULL;
      END;
      IF v_u_qty IS NULL OR v_u_qty <= 0 THEN
        RAISE EXCEPTION 'Usage quantity must be greater than zero'
          USING ERRCODE = 'check_violation';
      END IF;

      BEGIN
        v_u_party := NULLIF((v_usage->>'party_id')::INTEGER, 0);
      EXCEPTION WHEN others THEN
        v_u_party := NULL;
      END;
      IF v_u_party IS NOT NULL THEN
        PERFORM 1 FROM parties WHERE id = v_u_party;
        IF NOT FOUND THEN
          RAISE EXCEPTION 'Customer % does not exist', v_u_party
            USING ERRCODE = 'foreign_key_violation';
        END IF;
      END IF;

      IF v_u_reason = 'installation' AND v_is_machine THEN
        IF v_u_party IS NULL THEN
          RAISE EXCEPTION 'Choose the customer where % was installed', v_product.name
            USING ERRCODE = 'check_violation';
        END IF;
        IF v_u_qty <> trunc(v_u_qty) THEN
          RAISE EXCEPTION 'Installed machines must be whole numbers'
            USING ERRCODE = 'check_violation';
        END IF;
      END IF;

      INSERT INTO checkout_usage (item_id, session_id, product_id, reason, quantity, party_id, notes)
      VALUES (
        v_item.id, p_session_id, v_item.product_id, v_u_reason, v_u_qty, v_u_party,
        NULLIF(btrim(COALESCE(v_usage->>'notes', '')), '')
      );

      v_used := v_used + v_u_qty;
    END LOOP;

    v_used := round(v_used, 3);
    v_difference := round(COALESCE(v_item.checkout_quantity, 0) - v_returned - v_used, 3);

    SELECT value INTO v_tolerance FROM app_settings
     WHERE key = CASE WHEN v_product.type = 'liquid' THEN 'liquid_tolerance_kg' ELSE 'unit_tolerance' END;
    IF v_tolerance IS NULL OR v_tolerance < 0 THEN
      v_tolerance := CASE WHEN v_product.type = 'liquid' THEN 0.010 ELSE 0 END;
    END IF;
    v_mismatch := abs(v_difference) > v_tolerance + 1e-9;

    v_consumed := round(COALESCE(v_item.checkout_quantity, 0) - v_returned, 3);
    v_limit := COALESCE(NULLIF(v_product.max_daily_consumption, 0), 30);

    v_reasons := '{}';
    IF v_mismatch THEN
      v_reasons := v_reasons || (
        CASE WHEN v_difference > 0 THEN 'Shortage' ELSE 'Excess' END || ' of ' ||
        CASE WHEN v_product.type = 'liquid'
          THEN round(abs(v_difference), 3)::TEXT || ' kg'
          ELSE trim_scale(abs(v_difference))::TEXT || ' pcs'
        END
      );
    END IF;
    IF v_consumed > v_limit THEN
      v_reasons := v_reasons || (
        'Consumed ' || trim_scale(v_consumed)::TEXT || ' exceeds daily limit ' || trim_scale(v_limit)::TEXT
      );
    END IF;
    v_flag_reason := NULLIF(array_to_string(v_reasons, '; '), '');

    UPDATE checkout_items
       SET checkin_quantity = v_returned,
           used_quantity = v_used,
           difference = v_difference,
           has_mismatch = v_mismatch,
           is_flagged = (v_flag_reason IS NOT NULL),
           flag_reason = v_flag_reason,
           discrepancy_type = NULL,
           discrepancy_note = NULL
     WHERE id = v_item.id;

    v_has_discrepancy := v_has_discrepancy OR v_mismatch;
  END LOOP;

  UPDATE checkout_sessions
     SET status = 'pending_approval',
         checkin_time = now(),
         notes = btrim(COALESCE(p_notes, '')),
         has_discrepancy = v_has_discrepancy
   WHERE id = p_session_id;

  RETURN jsonb_build_object('has_discrepancy', v_has_discrepancy);
END;
$$;

-- --------------------------------------------------------
-- 8. approve_return - NEW signature with p_resolutions
--    ([{ "item_id": 1, "discrepancy_type": "wastage", "note": "..." }]).
--    Drop the 2-arg migration 010 version first so no overload is left
--    behind (see ISSUE-015).
-- --------------------------------------------------------
DROP FUNCTION IF EXISTS approve_return(INTEGER, UUID);

CREATE OR REPLACE FUNCTION approve_return(
  p_session_id INTEGER,
  p_approver_id UUID,
  p_resolutions JSONB DEFAULT '[]'::jsonb
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor UUID := auth.uid();
  v_session checkout_sessions%ROWTYPE;
  v_resolutions JSONB := CASE WHEN jsonb_typeof(p_resolutions) = 'array' THEN p_resolutions ELSE '[]'::jsonb END;
  v_item RECORD;
  v_res JSONB;
  v_type TEXT;
  v_note TEXT;
  v_install RECORD;
  v_staff_name TEXT;
BEGIN
  IF v_actor IS NULL OR NOT is_admin() THEN
    RAISE EXCEPTION 'Only admins can approve returns'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF p_approver_id IS NOT NULL AND p_approver_id <> v_actor THEN
    RAISE EXCEPTION 'Approver must match authenticated user'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  SELECT * INTO v_session FROM checkout_sessions WHERE id = p_session_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Session % not found', p_session_id;
  END IF;
  IF v_session.status <> 'pending_approval' THEN
    RAISE EXCEPTION 'Session % is not pending_approval', p_session_id;
  END IF;

  PERFORM 1 FROM checkout_items WHERE session_id = p_session_id FOR UPDATE;

  -- Every mismatched item needs a classification + note (last entry wins
  -- when an item_id is listed twice, same as the demo's Map).
  FOR v_item IN
    SELECT ci.id, p.name AS product_name
      FROM checkout_items ci
      LEFT JOIN products p ON p.id = ci.product_id
     WHERE ci.session_id = p_session_id AND COALESCE(ci.has_mismatch, false)
     ORDER BY ci.id
  LOOP
    SELECT r INTO v_res
      FROM jsonb_array_elements(v_resolutions) WITH ORDINALITY AS t(r, n)
     WHERE jsonb_typeof(r) = 'object' AND (r->>'item_id') = v_item.id::TEXT
     ORDER BY n DESC
     LIMIT 1;
    v_type := v_res->>'discrepancy_type';
    v_note := btrim(COALESCE(v_res->>'note', ''));
    IF v_res IS NULL
       OR v_type IS NULL
       OR v_type NOT IN ('wastage', 'loss', 'staff_shortage', 'counting_error', 'excess_return', 'other')
       OR v_note = '' THEN
      RAISE EXCEPTION 'Classify the difference for % and add a note before approving', COALESCE(v_item.product_name, 'item')
        USING ERRCODE = 'check_violation';
    END IF;

    UPDATE checkout_items
       SET discrepancy_type = v_type,
           discrepancy_note = v_note
     WHERE id = v_item.id;
  END LOOP;

  FOR v_item IN
    SELECT product_id, checkin_quantity FROM checkout_items
     WHERE session_id = p_session_id AND COALESCE(checkin_quantity, 0) > 0
     ORDER BY id
  LOOP
    PERFORM adjust_stock(v_item.product_id, v_item.checkin_quantity);

    INSERT INTO inventory_transactions (
      product_id, type, quantity, reference_type, reference_id, performed_by, notes
    ) VALUES (
      v_item.product_id, 'checkin', v_item.checkin_quantity,
      'checkout_session', p_session_id, v_actor, 'Approved return - stock restored'
    );
  END LOOP;

  -- Machines installed at a customer: count the unit back into Total Stock
  -- and move it to Installed Qty + an installations row.
  SELECT full_name INTO v_staff_name FROM profiles WHERE id = v_session.seller_id;

  FOR v_install IN
    SELECT u.product_id, u.quantity, u.party_id, pa.name AS party_name
      FROM checkout_usage u
      LEFT JOIN parties pa ON pa.id = u.party_id
     WHERE u.session_id = p_session_id
       AND u.reason = 'installation'
       AND is_machine_product(u.product_id)
     ORDER BY u.id
  LOOP
    PERFORM adjust_stock(v_install.product_id, v_install.quantity);

    UPDATE products
       SET installed_qty = COALESCE(installed_qty, 0) + v_install.quantity,
           updated_at = now()
     WHERE id = v_install.product_id;

    INSERT INTO inventory_transactions (
      product_id, type, quantity, reference_type, reference_id, performed_by, notes
    ) VALUES (
      v_install.product_id, 'installed', v_install.quantity,
      'checkout_session', p_session_id, v_actor,
      'Installed at ' || COALESCE(v_install.party_name, 'customer') || ' - moved to Installed Qty'
    );

    INSERT INTO installations (
      party_id, product_id, quantity, installation_date, status, removed_date, notes
    ) VALUES (
      v_install.party_id, v_install.product_id, v_install.quantity::INTEGER,
      CURRENT_DATE, 'active', NULL,
      'Installed by ' || COALESCE(v_staff_name, 'staff') || ' (Daily Operations session #' || p_session_id || ')'
    );
  END LOOP;

  UPDATE checkout_sessions
     SET status = 'checked_in',
         approved_by = v_actor,
         approved_at = now()
   WHERE id = p_session_id;
END;
$$;

-- --------------------------------------------------------
-- 9. reject_return - "Send back": the return goes back to the staff member
--    to correct. No stock change.
-- --------------------------------------------------------
CREATE OR REPLACE FUNCTION reject_return(
  p_session_id INTEGER,
  p_reason TEXT,
  p_approver_id UUID DEFAULT NULL
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor UUID := auth.uid();
  v_session checkout_sessions%ROWTYPE;
  v_reason TEXT := btrim(COALESCE(p_reason, ''));
BEGIN
  IF v_actor IS NULL OR NOT is_admin() THEN
    RAISE EXCEPTION 'Only admins can send a return back'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF p_approver_id IS NOT NULL AND p_approver_id <> v_actor THEN
    RAISE EXCEPTION 'Approver must match authenticated user'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  SELECT * INTO v_session FROM checkout_sessions WHERE id = p_session_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Session % not found', p_session_id;
  END IF;
  IF v_session.status <> 'pending_approval' THEN
    RAISE EXCEPTION 'Session % is not pending_approval', p_session_id;
  END IF;

  IF v_reason = '' THEN
    RAISE EXCEPTION 'Give a reason for sending the return back'
      USING ERRCODE = 'check_violation';
  END IF;

  DELETE FROM checkout_usage WHERE session_id = p_session_id;

  UPDATE checkout_items
     SET checkin_quantity = NULL,
         used_quantity = NULL,
         difference = NULL,
         has_mismatch = false,
         is_flagged = false,
         flag_reason = NULL,
         discrepancy_type = NULL,
         discrepancy_note = NULL
   WHERE session_id = p_session_id;

  UPDATE checkout_sessions
     SET status = 'checked_out',
         checkin_time = NULL,
         has_discrepancy = false,
         notes = concat_ws(E'\n', NULLIF(notes, ''), 'Return sent back: ' || v_reason)
   WHERE id = p_session_id;
END;
$$;

-- --------------------------------------------------------
-- 10. request_stock_adjustment - stock edits wait for admin approval.
-- --------------------------------------------------------
CREATE OR REPLACE FUNCTION request_stock_adjustment(
  p_product_id INTEGER,
  p_new_stock NUMERIC,
  p_reason TEXT,
  p_requested_by UUID DEFAULT NULL
)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor UUID := auth.uid();
  v_product products%ROWTYPE;
  v_reason TEXT := btrim(COALESCE(p_reason, ''));
  v_delta NUMERIC;
  v_id INTEGER;
BEGIN
  IF v_actor IS NULL OR NOT is_admin() THEN
    RAISE EXCEPTION 'Only admins can request stock adjustments'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF p_requested_by IS NOT NULL AND p_requested_by <> v_actor THEN
    RAISE EXCEPTION 'Requester must match authenticated user'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  SELECT * INTO v_product FROM products WHERE id = p_product_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Product % does not exist', p_product_id
      USING ERRCODE = 'foreign_key_violation';
  END IF;

  IF p_new_stock IS NULL OR p_new_stock < 0 THEN
    RAISE EXCEPTION 'Stock cannot be negative'
      USING ERRCODE = 'check_violation';
  END IF;

  IF v_reason = '' THEN
    RAISE EXCEPTION 'Give a reason for the stock adjustment'
      USING ERRCODE = 'check_violation';
  END IF;

  v_delta := round(p_new_stock - COALESCE(v_product.current_stock, 0), 3);
  IF v_delta = 0 THEN
    RAISE EXCEPTION 'New stock is the same as current stock'
      USING ERRCODE = 'check_violation';
  END IF;

  PERFORM 1 FROM stock_adjustments WHERE product_id = p_product_id AND status = 'pending';
  IF FOUND THEN
    RAISE EXCEPTION '% already has a pending adjustment request', v_product.name
      USING ERRCODE = 'unique_violation';
  END IF;

  INSERT INTO stock_adjustments (
    product_id, stock_at_request, requested_stock, delta, reason, status, requested_by
  ) VALUES (
    p_product_id, COALESCE(v_product.current_stock, 0), p_new_stock, v_delta, v_reason, 'pending', v_actor
  )
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;

-- --------------------------------------------------------
-- 11. review_stock_adjustment - approve applies the stored delta (so sales /
--     issues made in between are kept); reject changes nothing.
-- --------------------------------------------------------
CREATE OR REPLACE FUNCTION review_stock_adjustment(
  p_adjustment_id INTEGER,
  p_approve BOOLEAN,
  p_note TEXT DEFAULT NULL,
  p_reviewer_id UUID DEFAULT NULL
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor UUID := auth.uid();
  v_adj stock_adjustments%ROWTYPE;
  v_product products%ROWTYPE;
  v_approve BOOLEAN := COALESCE(p_approve, false);
BEGIN
  IF v_actor IS NULL OR NOT is_admin() THEN
    RAISE EXCEPTION 'Only admins can review stock adjustments'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF p_reviewer_id IS NOT NULL AND p_reviewer_id <> v_actor THEN
    RAISE EXCEPTION 'Reviewer must match authenticated user'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  SELECT * INTO v_adj FROM stock_adjustments WHERE id = p_adjustment_id FOR UPDATE;
  IF NOT FOUND OR v_adj.status <> 'pending' THEN
    RAISE EXCEPTION 'Adjustment % is not pending', p_adjustment_id;
  END IF;

  IF v_approve THEN
    SELECT * INTO v_product FROM products WHERE id = v_adj.product_id FOR UPDATE;
    IF COALESCE(v_product.current_stock, 0) + v_adj.delta < 0 THEN
      RAISE EXCEPTION 'Insufficient stock for %', v_product.name
        USING ERRCODE = 'check_violation';
    END IF;

    PERFORM adjust_stock(v_adj.product_id, v_adj.delta);

    INSERT INTO inventory_transactions (
      product_id, type, quantity, reference_type, reference_id, performed_by, notes
    ) VALUES (
      v_adj.product_id, 'adjustment', v_adj.delta, 'stock_adjustment', v_adj.id, v_actor,
      'Approved adjustment: ' || v_adj.reason
    );
  END IF;

  UPDATE stock_adjustments
     SET status = CASE WHEN v_approve THEN 'approved' ELSE 'rejected' END,
         reviewed_by = v_actor,
         reviewed_at = now(),
         review_note = NULLIF(btrim(COALESCE(p_note, '')), '')
   WHERE id = p_adjustment_id;
END;
$$;

-- --------------------------------------------------------
-- 12. Grants (exact signatures)
-- --------------------------------------------------------
REVOKE ALL ON FUNCTION is_machine_product(INTEGER) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION record_purchase(INTEGER, NUMERIC, NUMERIC, TEXT, TEXT, DATE, TEXT, UUID) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION submit_return(INTEGER, JSONB, TEXT, UUID) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION approve_return(INTEGER, UUID, JSONB) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION reject_return(INTEGER, TEXT, UUID) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION request_stock_adjustment(INTEGER, NUMERIC, TEXT, UUID) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION review_stock_adjustment(INTEGER, BOOLEAN, TEXT, UUID) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION is_machine_product(INTEGER) TO authenticated;
GRANT EXECUTE ON FUNCTION record_purchase(INTEGER, NUMERIC, NUMERIC, TEXT, TEXT, DATE, TEXT, UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION submit_return(INTEGER, JSONB, TEXT, UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION approve_return(INTEGER, UUID, JSONB) TO authenticated;
GRANT EXECUTE ON FUNCTION reject_return(INTEGER, TEXT, UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION request_stock_adjustment(INTEGER, NUMERIC, TEXT, UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION review_stock_adjustment(INTEGER, BOOLEAN, TEXT, UUID) TO authenticated;

COMMIT;

-- ============================================
-- Verification (read-only; run after COMMIT)
-- ============================================
-- New columns (expect 11 rows):
-- select table_name, column_name from information_schema.columns
--  where table_schema = 'public' and (
--        (table_name = 'products' and column_name = 'fragrance')
--     or (table_name = 'stock_intakes' and column_name in ('purchase_date', 'purchase_rate', 'total_amount', 'bill_number'))
--     or (table_name = 'checkout_items' and column_name in ('used_quantity', 'difference', 'has_mismatch', 'discrepancy_type', 'discrepancy_note'))
--     or (table_name = 'checkout_sessions' and column_name = 'has_discrepancy'))
--  order by 1, 2;
--
-- New tables with RLS on (expect 3 rows, all true):
-- select relname, relrowsecurity from pg_class
--  where relnamespace = 'public'::regnamespace and relname in ('checkout_usage', 'stock_adjustments', 'app_settings');
--
-- Tolerances (expect liquid_tolerance_kg 0.010, unit_tolerance 0):
-- select key, value from app_settings order by key;
--
-- Exactly one approve_return, ending in "p_resolutions jsonb":
-- select proname, pg_get_function_identity_arguments(oid) from pg_proc
--  where pronamespace = 'public'::regnamespace
--    and proname in ('approve_return', 'submit_return', 'reject_return', 'record_purchase',
--                    'request_stock_adjustment', 'review_stock_adjustment', 'is_machine_product')
--  order by 1, 2;
--
-- Type constraint includes 'installed':
-- select pg_get_constraintdef(oid) from pg_constraint where conname = 'inventory_transactions_type_check';
--
-- Fragrance pre-fill (machines should show NULL):
-- select p.id, p.name, c.name as category, p.fragrance from products p
--   left join categories c on c.id = p.category_id order by c.name, p.name;
