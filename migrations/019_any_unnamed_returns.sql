-- ============================================
-- Migration 019: Any lines — pieces that came back need no type
-- Run after migration 018. Safe to re-run (CREATE OR REPLACE, same signature).
-- ============================================
--
-- Owner decision 2026-11-19: on the return of an "Any <category>" line
-- staff only name the pieces that did NOT come back (used / sold / lost).
-- Pieces that came back are one number on the Any line:
--   { "item_id": 2, "returned_quantity": 8,
--     "breakdown": [ { "product_id": 7, "lost_quantity": 2, "usage": [] } ] }
-- returned + Σ(named returned + used + sold + lost) must equal the issued
-- quantity. Returned pieces were never taken off a product (Any lines move
-- no stock at issue), so they need no type and move no stock. Named
-- per-product returned_quantity in the breakdown is still accepted.
-- "breakdown" may be omitted when everything came back.
-- Only submit_return changes; contract: knowledge-base/category-issue.md.

BEGIN;
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
  v_entry JSONB;
  v_usage JSONB;
  v_item checkout_items%ROWTYPE;
  v_product products%ROWTYPE;
  v_category categories%ROWTYPE;
  v_is_machine BOOLEAN;
  v_seen INTEGER[];
  v_seen_products INTEGER[];
  v_item_id INTEGER;
  v_entry_product INTEGER;
  v_child_id INTEGER;
  v_returned NUMERIC;
  v_lost NUMERIC;
  v_used NUMERIC;
  v_sold NUMERIC;
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
  v_sum_returned NUMERIC;
  v_sum_used NUMERIC;
  v_sum_lost NUMERIC;
  v_accounted NUMERIC;
  v_take NUMERIC;
  v_sold_row RECORD;
  v_line RECORD;
  v_breakdown JSONB;
  v_unnamed NUMERIC;
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

  -- Re-submission after "Send back": rebuild usage and child rows.
  DELETE FROM checkout_usage WHERE session_id = p_session_id;
  DELETE FROM checkout_items WHERE session_id = p_session_id AND parent_item_id IS NOT NULL;

  SELECT count(*) INTO v_item_count FROM checkout_items WHERE session_id = p_session_id;

  IF p_items IS NULL OR jsonb_typeof(p_items) <> 'array' OR jsonb_array_length(p_items) <> v_item_count THEN
    RAISE EXCEPTION 'Every issued item must be included in the return'
      USING ERRCODE = 'check_violation';
  END IF;

  -- Sold quantities from linked bills, to be allocated: product lines first.
  CREATE TEMP TABLE IF NOT EXISTS _sold_left (
    product_id INTEGER, sale_id INTEGER, party_id INTEGER, qty NUMERIC
  ) ON COMMIT DROP;
  DELETE FROM _sold_left;
  INSERT INTO _sold_left (product_id, sale_id, party_id, qty)
  SELECT si.product_id, s.id, s.party_id, SUM(si.quantity)
    FROM sale_items si
    JOIN sales s ON s.id = si.sale_id
   WHERE s.checkout_session_id = p_session_id
   GROUP BY si.product_id, s.id, s.party_id;

  v_seen := '{}';
  FOR v_input IN SELECT * FROM jsonb_array_elements(p_items) LOOP
    BEGIN
      v_item_id := (v_input->>'item_id')::INTEGER;
    EXCEPTION WHEN others THEN
      v_item_id := NULL;
    END;

    SELECT * INTO v_item FROM checkout_items
     WHERE id = v_item_id AND session_id = p_session_id AND parent_item_id IS NULL;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Return item does not belong to this session'
        USING ERRCODE = 'check_violation';
    END IF;

    IF v_item.id = ANY (v_seen) THEN
      RAISE EXCEPTION 'Return item listed twice'
        USING ERRCODE = 'check_violation';
    END IF;
    v_seen := v_seen || v_item.id;
  END LOOP;

  -- Pass 1: product lines (they take sold quantities first), in item id
  -- order whatever the order of p_items (same as allocateSold() on the client).
  FOR v_input IN
    SELECT e FROM jsonb_array_elements(p_items) e ORDER BY (e->>'item_id')::INTEGER
  LOOP
    SELECT * INTO v_item FROM checkout_items WHERE id = (v_input->>'item_id')::INTEGER;
    CONTINUE WHEN v_item.product_id IS NULL;

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

    v_used := submit_return_usage(v_item.id, p_session_id, v_item.product_id, v_product.name, v_is_machine, v_input->'usage');

    -- Sold on linked bills, up to what this line issued.
    v_sold := 0;
    FOR v_sold_row IN
      SELECT ctid, sale_id, party_id, qty FROM _sold_left
       WHERE product_id = v_item.product_id AND qty > 0
       ORDER BY sale_id
    LOOP
      v_take := LEAST(v_sold_row.qty, COALESCE(v_item.checkout_quantity, 0) - v_sold);
      EXIT WHEN v_take <= 0;
      INSERT INTO checkout_usage (item_id, session_id, product_id, reason, quantity, party_id, notes, sale_id)
      VALUES (v_item.id, p_session_id, v_item.product_id, 'sold', v_take, v_sold_row.party_id,
              'Bill #' || v_sold_row.sale_id, v_sold_row.sale_id);
      UPDATE _sold_left SET qty = qty - v_take WHERE ctid = v_sold_row.ctid;
      v_sold := v_sold + v_take;
    END LOOP;

    v_used := round(v_used + v_sold, 3);
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

  -- Pass 2: Any lines. Every piece is named by type.
  FOR v_input IN SELECT * FROM jsonb_array_elements(p_items) LOOP
    SELECT * INTO v_item FROM checkout_items WHERE id = (v_input->>'item_id')::INTEGER;
    CONTINUE WHEN v_item.product_id IS NOT NULL;

    SELECT * INTO v_category FROM categories WHERE id = v_item.category_id;

    -- Pieces that came back need no type: one number on the Any line.
    -- Only pieces that did not come back are named (breakdown).
    IF v_input->'breakdown' IS NOT NULL AND jsonb_typeof(v_input->'breakdown') NOT IN ('array', 'null') THEN
      RAISE EXCEPTION 'Invalid list of % pieces', v_category.name
        USING ERRCODE = 'check_violation';
    END IF;
    v_breakdown := CASE WHEN jsonb_typeof(v_input->'breakdown') = 'array' THEN v_input->'breakdown' ELSE '[]'::jsonb END;

    BEGIN
      v_unnamed := round(COALESCE(NULLIF(v_input->>'returned_quantity', ''), '0')::NUMERIC, 3);
    EXCEPTION WHEN others THEN
      v_unnamed := NULL;
    END;
    IF v_unnamed IS NULL OR v_unnamed < 0 THEN
      RAISE EXCEPTION 'Enter how many % came back', v_category.name
        USING ERRCODE = 'check_violation';
    END IF;
    IF v_category.type = 'unit' AND v_unnamed <> trunc(v_unnamed) THEN
      RAISE EXCEPTION 'Any % must be whole pieces', v_category.name
        USING ERRCODE = 'check_violation';
    END IF;

    v_seen_products := '{}';
    v_sum_returned := v_unnamed;
    v_sum_used := 0;
    v_sum_lost := 0;

    -- Products sold from this line but missing from the breakdown still get a row.
    FOR v_entry IN
      SELECT e FROM jsonb_array_elements(v_breakdown) e
      UNION ALL
      SELECT jsonb_build_object('product_id', sl.product_id, 'returned_quantity', 0, 'lost_quantity', 0, 'usage', '[]'::jsonb)
        FROM (SELECT DISTINCT product_id FROM _sold_left WHERE qty > 0) sl
        JOIN products p ON p.id = sl.product_id
       WHERE p.category_id = v_item.category_id
         AND NOT EXISTS (
           SELECT 1 FROM jsonb_array_elements(v_breakdown) b
            WHERE (b->>'product_id') = sl.product_id::TEXT
         )
    LOOP
      BEGIN
        v_entry_product := (v_entry->>'product_id')::INTEGER;
      EXCEPTION WHEN others THEN
        v_entry_product := NULL;
      END;
      SELECT * INTO v_product FROM products WHERE id = v_entry_product;
      IF NOT FOUND OR v_product.category_id IS DISTINCT FROM v_item.category_id THEN
        RAISE EXCEPTION 'Choose a % product for every line', v_category.name
          USING ERRCODE = 'check_violation';
      END IF;
      IF v_entry_product = ANY (v_seen_products) THEN
        RAISE EXCEPTION '% is listed twice', v_product.name
          USING ERRCODE = 'check_violation';
      END IF;
      v_seen_products := v_seen_products || v_entry_product;
      v_is_machine := is_machine_product(v_entry_product);

      BEGIN
        v_returned := round(COALESCE(NULLIF(v_entry->>'returned_quantity', ''), '0')::NUMERIC, 3);
        v_lost := round(COALESCE(NULLIF(v_entry->>'lost_quantity', ''), '0')::NUMERIC, 3);
      EXCEPTION WHEN others THEN
        v_returned := NULL;
      END;
      IF v_returned IS NULL OR v_returned < 0 OR v_lost IS NULL OR v_lost < 0 THEN
        RAISE EXCEPTION 'Invalid quantity for %', v_product.name
          USING ERRCODE = 'check_violation';
      END IF;
      IF v_category.type = 'unit' AND (v_returned <> trunc(v_returned) OR v_lost <> trunc(v_lost)) THEN
        RAISE EXCEPTION '% must be whole pieces', v_product.name
          USING ERRCODE = 'check_violation';
      END IF;

      -- Child row first so usage lines can point at it; quantities set below.
      INSERT INTO checkout_items (
        session_id, product_id, category_id, parent_item_id, checkout_quantity, is_flagged
      ) VALUES (
        p_session_id, v_entry_product, v_item.category_id, v_item.id, 0, false
      )
      RETURNING id INTO v_child_id;

      v_used := submit_return_usage(v_child_id, p_session_id, v_entry_product, v_product.name, v_is_machine, v_entry->'usage');
      IF v_category.type = 'unit' AND v_used <> trunc(v_used) THEN
        RAISE EXCEPTION '% must be whole pieces', v_product.name
          USING ERRCODE = 'check_violation';
      END IF;

      v_sold := 0;
      FOR v_sold_row IN
        SELECT ctid, sale_id, party_id, qty FROM _sold_left
         WHERE product_id = v_entry_product AND qty > 0
         ORDER BY sale_id
      LOOP
        INSERT INTO checkout_usage (item_id, session_id, product_id, reason, quantity, party_id, notes, sale_id)
        VALUES (v_child_id, p_session_id, v_entry_product, 'sold', v_sold_row.qty, v_sold_row.party_id,
                'Bill #' || v_sold_row.sale_id, v_sold_row.sale_id);
        UPDATE _sold_left SET qty = 0 WHERE ctid = v_sold_row.ctid;
        v_sold := v_sold + v_sold_row.qty;
      END LOOP;

      v_used := round(v_used + v_sold, 3);

      IF v_returned + v_used + v_lost <= 0 THEN
        DELETE FROM checkout_items WHERE id = v_child_id;
        CONTINUE;
      END IF;

      SELECT value INTO v_tolerance FROM app_settings
       WHERE key = CASE WHEN v_product.type = 'liquid' THEN 'liquid_tolerance_kg' ELSE 'unit_tolerance' END;
      IF v_tolerance IS NULL OR v_tolerance < 0 THEN
        v_tolerance := CASE WHEN v_product.type = 'liquid' THEN 0.010 ELSE 0 END;
      END IF;
      v_mismatch := v_lost > v_tolerance + 1e-9;
      v_flag_reason := CASE WHEN v_mismatch THEN
        'Lost ' || CASE WHEN v_product.type = 'liquid'
          THEN round(v_lost, 3)::TEXT || ' kg'
          ELSE trim_scale(v_lost)::TEXT || ' pcs' END
        END;

      UPDATE checkout_items
         SET checkout_quantity = round(v_returned + v_used + v_lost, 3),
             checkin_quantity = v_returned,
             used_quantity = v_used,
             difference = v_lost,
             has_mismatch = v_mismatch,
             is_flagged = v_mismatch,
             flag_reason = v_flag_reason,
             discrepancy_type = NULL,
             discrepancy_note = NULL
       WHERE id = v_child_id;

      v_sum_returned := v_sum_returned + v_returned;
      v_sum_used := v_sum_used + v_used;
      v_sum_lost := v_sum_lost + v_lost;
      v_has_discrepancy := v_has_discrepancy OR v_mismatch;
    END LOOP;

    v_accounted := round(v_sum_returned + v_sum_used + v_sum_lost, 3);
    IF abs(v_accounted - COALESCE(v_item.checkout_quantity, 0)) > 1e-9 THEN
      RAISE EXCEPTION 'Any %: % issued but % accounted for. Say how many came back and name each piece that did not (used, sold or lost)',
        v_category.name, trim_scale(v_item.checkout_quantity), trim_scale(v_accounted)
        USING ERRCODE = 'check_violation';
    END IF;

    -- Summary on the Any line itself (stock is moved through the children).
    -- checkin_quantity = all returned pieces; minus the children's returned
    -- = the pieces that came back without a type (they move no stock).
    UPDATE checkout_items
       SET checkin_quantity = round(v_sum_returned, 3),
           used_quantity = round(v_sum_used, 3),
           difference = round(v_sum_lost, 3),
           has_mismatch = false,
           is_flagged = false,
           flag_reason = NULL,
           discrepancy_type = NULL,
           discrepancy_note = NULL
     WHERE id = v_item.id;
  END LOOP;

  SELECT p.name INTO v_line
    FROM _sold_left sl JOIN products p ON p.id = sl.product_id
   WHERE sl.qty > 1e-9
   LIMIT 1;
  IF FOUND THEN
    RAISE EXCEPTION 'Bills from this field stock sell more % than was issued', v_line.name
      USING ERRCODE = 'check_violation';
  END IF;

  UPDATE checkout_sessions
     SET status = 'pending_approval',
         checkin_time = now(),
         notes = concat_ws(E'\n', NULLIF(notes, ''), NULLIF(btrim(COALESCE(p_notes, '')), '')),
         has_discrepancy = v_has_discrepancy
   WHERE id = p_session_id;

  RETURN jsonb_build_object('has_discrepancy', v_has_discrepancy);
END;
$$;

-- Signature unchanged, so the REVOKE/GRANT from migration 018 still applies.

COMMIT;

-- Verify (expect true):
-- select pg_get_functiondef('submit_return(integer, jsonb, text, uuid)'::regprocedure) like '%v_unnamed%';
