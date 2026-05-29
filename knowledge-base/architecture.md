# Architecture & Data Model

## Data Tables (Supabase / localStorage demo)

### profiles
| Column | Type | Notes |
|--------|------|-------|
| id | text (PK) | UUID from Supabase auth |
| email | text | Unique |
| full_name | text | |
| role | text | 'admin' or 'seller' |
| phone | text | |
| is_active | boolean | Soft disable |

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
| unit_price | decimal | ₹ per unit or per gram |
| current_stock | decimal | pieces for unit products or kg for liquid products |
| min_stock_threshold | decimal | Alert when stock <= this |
| max_daily_consumption | decimal | Flag if checkout consumption exceeds this |
| expiry_date | date | Nullable |
| is_active | boolean | Soft delete |

### checkout_sessions
| Column | Type | Notes |
|--------|------|-------|
| id | int (PK) | |
| seller_id | text (FK→profiles) | |
| checkout_time | timestamp | |
| checkin_time | timestamp | Null until checkin |
| status | text | 'pending_issue', 'checked_out', 'pending_approval', 'checked_in', 'flagged' |
| notes | text | |

### checkout_items
| Column | Type | Notes |
|--------|------|-------|
| id | int (PK) | |
| session_id | int (FK) | |
| product_id | int (FK) | |
| checkout_quantity | decimal | Weight/count at departure |
| checkin_quantity | decimal | Weight/count at return |
| is_flagged | boolean | True if consumption > threshold |
| flag_reason | text | |

### sales (bill/invoice header)
| Column | Type | Notes |
|--------|------|-------|
| id | int (PK) | |
| party_id | int (FK) | Nullable for walk-ins |
| total_amount | decimal | Sum of all line items |
| payment_status | text | 'paid', 'partial', 'pending' |
| payment_method | text | 'cash', 'upi', 'bank_transfer', 'cheque' |
| amount_received | decimal | |
| expected_payment_date | date | Nullable |
| sale_date | date | |
| notes | text | |
| recorded_by | text (FK→profiles) | |

### sale_items (line items per sale)
| Column | Type | Notes |
|--------|------|-------|
| id | int (PK) | |
| sale_id | int (FK→sales) | ON DELETE CASCADE |
| product_id | int (FK→products) | |
| quantity | decimal | |
| unit_price | decimal | |
| line_total | decimal | quantity × unit_price |
| created_at | timestamp | |

### refill_completions (monthly refill tracking)
| Column | Type | Notes |
|--------|------|-------|
| id | int (PK) | |
| party_id | int (FK→parties) | ON DELETE CASCADE |
| month | int | 1-12 |
| year | int | e.g. 2026 |
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
| quantity | decimal | Positive = stock in, negative = stock out |
| reference_type | text | Source table name |
| reference_id | int | Source record ID |
| performed_by | text (FK→profiles) | |
| notes | text | |

## Security Model
- **RLS** (Row Level Security) on Supabase enforces seller can only read their own sessions
- **Admin** has full CRUD on all tables
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
Stock-mutating operations call Postgres functions via `supabase.rpc()` so multi-step writes are transactional and `current_stock` updates are race-safe. Migration 010 expands the original migration 006 RPC layer to cover the remaining stock-changing browser flows.

| RPC | Purpose |
|-----|---------|
| `adjust_stock(product_id, delta)` | Internal primitive used by business RPCs; raises if result would be negative. Do not call directly from browser code |
| `record_sale(party_id, items, ...)` | sale + sale_items + stock deduction + transactions, all in one tx |
| `approve_issue(session_id, approver_id)` | deduct each issued item + log + flip session status |
| `approve_return(session_id, approver_id)` | restore each returned item + log + flip session status |
| `admin_issue_stock(seller_id, items, approver_id)` | create an immediately checked-out admin session, deduct stock, and log checkout transactions |
| `update_sale(sale_id, items, ...)` | restore old sale stock + replace sale_items + deduct edited items + update header |
| `delete_sale(sale_id, performer_id)` | restore stock + detach payment followups + cascade-delete sale_items + delete sale |
| `record_stock_intake(product_id, quantity, supplier, notes, received_by)` | add stock, create stock intake row, and log stock_in |
| `record_damage_loss(product_id, quantity, damage_type, reason, notes, reported_by)` | deduct stock, create damage report, and log damage |
| `create_rental(product_id, party_id, quantity, rental_date, expected_return_date, rent_amount, notes, performer_id)` | create active rental, deduct stock, and log rental_out |
| `return_rental(rental_id, actual_return_date, performer_id)` | mark rental returned, restore stock, and log rental_return |
| `set_product_stock(product_id, new_stock, performer_id, notes)` | set absolute product stock through a delta adjustment and log adjustment |
| `record_payment_followup(sale_id, status, amount_collected, payment_method, expected_payment_date, notes, followup_date, created_by)` | insert payment followup and update the locked sale payment state atomically |

Sales edits/deletes also add audit transaction types: `sale_edit_restore`, `sale_edit`, and `sale_delete`.

**Demo mode parity**: `js/supabase.js` defines a `demoRpc` table mirroring each Postgres function, so the same client call (`db.rpc('record_sale', { ... })`) works in both modes without conditional code at call sites.

**TOCTOU resolution**: business RPCs mutate stock through locked product rows and non-negative checks before writing related audit data. Browser code must call an intent-specific RPC instead of doing its own read-modify-write sequence.

## Payment Flow
Collections use `record_payment_followup` instead of separate browser-side followup insert + sale update calls. The RPC locks the sale row, prevents over-collection, prevents marking a bill paid without receiving the full balance, inserts the followup, and updates `sales.amount_received`, `payment_status`, and `expected_payment_date` in one transaction.
