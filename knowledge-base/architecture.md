# Architecture & Data Model

## Data Tables (Supabase / localStorage demo)

Source of truth: `supabase-schema.sql` plus migrations `011`–`014` (see README "Setup / Migration Order" — the base schema was edited in place and already includes most later columns). All `id` columns are `SERIAL` integers except `profiles.id`. User references (`seller_id`, `recorded_by`, `performed_by`, `visited_by`, `reported_by`, `received_by`, `approved_by`) are `UUID` FKs to `profiles`.

### profiles
| Column | Type | Notes |
|--------|------|-------|
| id | UUID (PK) | FK → `auth.users(id)` ON DELETE CASCADE |
| email | text | Unique, not null |
| full_name | text | Not null |
| role | text | 'admin' or 'seller' (default 'seller') |
| phone | text | |
| is_active | boolean | Soft disable |

A `handle_new_user` trigger creates the profile row from `raw_user_meta_data` (role defaults to `seller`).

### categories
| Column | Type | Notes |
|--------|------|-------|
| id | int (PK) | |
| name | text | e.g. 'Dispenser Refill' |
| type | text | 'unit' or 'liquid' |

### products
| Column | Type | Notes |
|--------|------|-------|
| id | int (PK) | |
| name | text | Full product name |
| category_id | int (FK) | |
| type | text | 'unit' or 'liquid' — inherited from category |
| model_number | text | Nullable |
| unit_price | DECIMAL(10,2) | ₹ per piece (unit) or ₹ per kg (liquid) |
| current_stock | DECIMAL(12,3) | pieces or kg; CHECK ≥ 0. The only stock figure the RPCs touch |
| min_stock_threshold | DECIMAL(12,3) | Default 10 |
| max_daily_consumption | DECIMAL(12,3) | Flag if checkout consumption exceeds this |
| expiry_date | date | Nullable |
| image_url | text | Supabase Storage `product-images` bucket |
| sell_qty | DECIMAL(12,3) | Manually entered, CHECK ≥ 0, default 0 (migration 013) |
| installed_qty | DECIMAL(12,3) | Manually entered, CHECK ≥ 0, default 0 (migration 013) |
| is_active | boolean | Soft delete |

**Products page derived figure** (`js/pages/products.js`, display-only):
- The UI labels `current_stock` as **"Total Stock"** (table column, modal field, CSV header).
- It shows **"Current Stock"** = `current_stock − sell_qty − installed_qty`. This is computed in the browser for the grid card, the table column, the edit modal (live, "auto-calculated") and the CSV export. It is never stored.
- `sell_qty` and `installed_qty` are typed in by the admin on the product modal. They are **not** linked to `sales`/`sale_items` or the `installations` table, and no RPC updates them.
- Stock RPCs, sale stock checks, the inventory audit trail, asset valuation and the Products category summary bar use `current_stock`. **Low-stock checks** — the Products page highlight (⚠ / red text) and the Dashboard "Low Stock Alerts" (since 2026-10-20) — both use the derived figure via `availableStock(p)` in `js/utils/helpers.js`.
- Editing "Total Stock" in the modal calls `set_product_stock`; `sell_qty`/`installed_qty` are saved with a plain `products` update.
- The "Deployed" column/badge is per category, summed from `parties.machine_counts` of `free_to_use` parties (machine categories only) — not from `installations`.

### parties
| Column | Type | Notes |
|--------|------|-------|
| id | int (PK) | |
| name | text | Not null |
| phone, address, notes | text | |
| machine_type | text | 'none' (default), 'purchased', 'free_to_use' |
| machine_counts | JSONB | `{ "<category_id>": qty }` per machine category; null when empty |
| amc_active | boolean | Default false |
| amc_day | int | Monthly refill day, CHECK 1–31 (raised from 28 in migration 014) |
| amc_rate | numeric | Fixed monthly AMC bill amount, default 0 |
| custom_category_rates | JSONB | `{ "<category_id>": price }` per-party category pricing |

### installations
| Column | Type | Notes |
|--------|------|-------|
| id | int (PK) | |
| party_id | int (FK→parties) | ON DELETE CASCADE |
| product_id | int (FK→products) | |
| quantity | int | Default 1 |
| installation_date | date | Not null |
| status | text | 'active' (default), 'removed', 'replaced' |
| removed_date | date | |
| notes | text | |

Plain CRUD from `installations.js` (admin-only page); does not change stock. RLS allows any authenticated user.

### checkout_sessions
| Column | Type | Notes |
|--------|------|-------|
| id | int (PK) | |
| seller_id | UUID (FK→profiles) | |
| checkout_time | timestamptz | |
| checkin_time | timestamptz | Null until checkin |
| status | text | 'pending_issue' (default), 'checked_out', 'pending_approval', 'checked_in', 'flagged' |
| approved_by | UUID (FK→profiles) | |
| approved_at | timestamptz | |
| notes | text | |

### checkout_items
| Column | Type | Notes |
|--------|------|-------|
| id | int (PK) | |
| session_id | int (FK) | ON DELETE CASCADE |
| product_id | int (FK) | |
| checkout_quantity | DECIMAL(12,3) | Weight/count at departure |
| checkin_quantity | DECIMAL(12,3) | Weight/count at return |
| is_flagged | boolean | True if consumption > threshold |
| flag_reason | text | |

### sales (bill/invoice header)
| Column | Type | Notes |
|--------|------|-------|
| id | int (PK) | |
| party_id | int (FK) | Nullable for walk-ins |
| total_amount | DECIMAL(12,2) | Sum of all line items, CHECK ≥ 0 |
| payment_status | text | 'paid', 'partial', 'pending' (default) |
| payment_method | text | 'cash', 'upi', 'bank_transfer', 'cheque' |
| amount_received | DECIMAL(12,2) | CHECK ≥ 0 and ≤ total_amount |
| expected_payment_date | date | Nullable; cleared when paid |
| sale_date | date | Default today |
| sale_type | text | 'gst' (default) or 'cash' (Kaccha) — migration 011 |
| notes | text | |
| recorded_by | UUID (FK→profiles) | |

### sale_items (line items per sale)
| Column | Type | Notes |
|--------|------|-------|
| id | int (PK) | |
| sale_id | int (FK→sales) | ON DELETE CASCADE |
| product_id | int (FK→products) | |
| quantity | decimal | CHECK > 0 |
| unit_price | decimal | CHECK ≥ 0 |
| line_total | decimal | quantity × unit_price, CHECK ≥ 0 |
| created_at | timestamp | |

Read-only to browser code (visible through the parent sale); writes happen only inside the sales RPCs.

### payment_followups
| Column | Type | Notes |
|--------|------|-------|
| id | int (PK) | |
| sale_id | int (FK→sales) | ON DELETE SET NULL (`delete_sale` detaches followups) |
| party_id | int (FK→parties) | |
| visited_by | UUID (FK→profiles) | |
| visit_date | timestamptz | Default now |
| status_update | text | e.g. pending / partial / paid / promised |
| payment_method | text | |
| amount_collected | DECIMAL(12,2) | **May be negative** since migration 012 (admin correction rows) |
| expected_payment_date | date | |
| notes | text | |

- Normal collections go through `record_payment_followup`.
- Since migration 012, `update_sale` compares the new `amount_received` with `SUM(amount_collected)` of the sale's existing followups; if they differ it inserts a correction followup for the difference (notes `'Admin edit bill correction'`), so Collections "Total Collected" stays in line with Edit Bill changes. The demo `update_sale` handler mirrors this.
- > ⚠️ Needs verification: the base schema still declares an inline `CHECK (amount_collected >= 0)`, while migration 012 only drops the constraint named `payment_followups_nonnegative_amount`. Check the live DB has no remaining non-negative check on this column.

### rentals
| Column | Type | Notes |
|--------|------|-------|
| id | int (PK) | |
| product_id | int (FK) | |
| party_id | int (FK) | |
| quantity | int | Default 1 |
| rental_date | date | Default today |
| expected_return_date | date | |
| actual_return_date | date | |
| rent_amount | DECIMAL(10,2) | Default 0 |
| status | text | 'active' (default) or 'returned' |
| notes | text | |

Written via `create_rental` / `return_rental`.

### damage_reports
| Column | Type | Notes |
|--------|------|-------|
| id | int (PK) | |
| product_id | int (FK) | |
| damage_type | text | 'damaged' (default), 'lost', 'expired' |
| quantity | DECIMAL(12,3) | CHECK > 0 |
| reason | text | |
| report_date | date | Default today |
| reported_by | UUID (FK→profiles) | |

Written via `record_damage_loss`.

### stock_intakes
| Column | Type | Notes |
|--------|------|-------|
| id | int (PK) | |
| product_id | int (FK) | |
| quantity | DECIMAL(12,3) | CHECK > 0 |
| supplier | text | |
| notes | text | |
| received_by | UUID (FK→profiles) | |

Written via `record_stock_intake`.

### refill_completions (monthly refill tracking)
| Column | Type | Notes |
|--------|------|-------|
| id | int (PK) | |
| party_id | int (FK→parties) | ON DELETE CASCADE |
| month | int | 1-12 |
| year | int | ≥ 2020 |
| completed_by | text | User ID who marked it |
| completed_at | timestamp | |
| notes | text | |
| | | UNIQUE(party_id, month, year) |

### inventory_transactions (audit trail)
| Column | Type | Notes |
|--------|------|-------|
| id | int (PK) | |
| product_id | int (FK) | |
| type | text | checkout, checkin, sale, sale_edit, sale_edit_restore, sale_delete, rental_out, rental_return, damage, stock_in, adjustment |
| quantity | DECIMAL(12,3) | Always positive (CHECK > 0); direction is implied by `type` |
| reference_type | text | Source table name |
| reference_id | int | Source record ID |
| performed_by | UUID (FK→profiles) | |
| notes | text | |

## Security Model
- **RLS** (Row Level Security) is enabled on every table. `is_admin()` (SECURITY DEFINER) gates admin policies.
- **Admin** has full access on all tables.
- **Sellers** read categories, products and parties; read/create/update their own checkout sessions and items; read only their own sales (and their sale_items) and followups. Sales, sale_items and followup writes go through SECURITY DEFINER RPCs.
- **Installations** policy allows any authenticated user; the page itself is admin-only.
- **User creation** goes through `api/create-user.js` (Vercel function): verifies the caller's JWT belongs to an admin, then uses `SUPABASE_SERVICE_ROLE_KEY`. CORS is pinned to the prod URL + localhost; best-effort in-memory rate limit of 5 requests/IP/minute.
- **Client-side** role check in every page render function
- **XSS** prevention: all user data escaped before rendering via `esc()` helper
- **Input validation**: max lengths, numeric ranges, email format checks on all forms

## Stock Flow
```
Stock In (intake) → +stock → log transaction
Checkout → -stock → log transaction
Checkin → +stock (returned amount) → log transaction → flag if consumption > threshold
Sale → -stock → log transaction
Rental Out → -stock → log transaction
Rental Return → +stock → log transaction
Damage/Loss → -stock → log transaction
```
Every mutation is logged in `inventory_transactions` for full audit trail.

## Atomicity (expanded 2026-05-29, migration 010)
Stock-mutating operations call Postgres functions via `supabase.rpc()` so multi-step writes are transactional and `current_stock` updates are race-safe. Migration 010 expands the original migration 006 RPC layer to cover the remaining stock-changing browser flows. Migration 011 adds `p_sale_type` to `record_sale`/`update_sale`; migration 012 adds followup correction rows to `update_sale`.

Parameters below are listed without their `p_` prefix.

| RPC | Purpose |
|-----|---------|
| `adjust_stock(product_id, delta)` | Internal primitive used by business RPCs; raises if result would be negative. Do not call directly from browser code |
| `record_sale(party_id, items, payment_status, payment_method, amount_received, expected_payment_date, sale_date, notes, recorded_by, sale_type)` | sale + sale_items + stock deduction + transactions, all in one tx |
| `approve_issue(session_id, approver_id)` | deduct each issued item + log + flip session status |
| `approve_return(session_id, approver_id)` | restore each returned item + log + flip session status |
| `admin_issue_stock(seller_id, items, approver_id)` | create an immediately checked-out admin session, deduct stock, and log checkout transactions |
| `update_sale(sale_id, party_id, items, payment_status, payment_method, amount_received, expected_payment_date, sale_date, notes, performer_id, sale_type)` | restore old sale stock + replace sale_items + deduct edited items + update header + insert followup correction row if needed |
| `delete_sale(sale_id, performer_id)` | restore stock + detach payment followups + cascade-delete sale_items + delete sale |
| `record_stock_intake(product_id, quantity, supplier, notes, received_by)` | add stock, create stock intake row, and log stock_in |
| `record_damage_loss(product_id, damage_type, quantity, reason, report_date, reported_by)` | deduct stock, create damage report, and log damage |
| `create_rental(product_id, party_id, quantity, rental_date, expected_return_date, rent_amount, notes, performer_id)` | create active rental, deduct stock, and log rental_out |
| `return_rental(rental_id, performer_id)` | mark rental returned, restore stock, and log rental_return |
| `set_product_stock(product_id, new_stock, performer_id, notes)` | set absolute product stock through a delta adjustment and log adjustment |
| `record_payment_followup(sale_id, party_id, status_update, payment_method, amount_collected, expected_payment_date, notes, visited_by)` | insert payment followup and update the locked sale payment state atomically |

Sales edits/deletes also add audit transaction types: `sale_edit_restore`, `sale_edit`, and `sale_delete`.

**Demo mode parity**: `js/supabase.js` defines a `demoRpc` table mirroring each Postgres function, so the same client call (`db.rpc('record_sale', { ... })`) works in both modes without conditional code at call sites.

**TOCTOU resolution**: business RPCs mutate stock through locked product rows and non-negative checks before writing related audit data. Browser code must call an intent-specific RPC instead of doing its own read-modify-write sequence.

## Payment Flow
Collections use `record_payment_followup` instead of separate browser-side followup insert + sale update calls. The RPC locks the sale row, prevents over-collection, prevents marking a bill paid without receiving the full balance, inserts the followup, and updates `sales.amount_received`, `payment_status`, and `expected_payment_date` in one transaction.
