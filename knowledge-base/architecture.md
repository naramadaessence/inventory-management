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
| current_stock | decimal | pieces or grams |
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
| status | text | 'checked_out', 'checked_in', 'flagged' |
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

### sales
| Column | Type | Notes |
|--------|------|-------|
| id | int (PK) | |
| party_id | int (FK) | Nullable for walk-ins |
| product_id | int (FK) | |
| quantity | decimal | |
| unit_price | decimal | |
| total_amount | decimal | |
| payment_status | text | 'paid', 'partial', 'pending' |
| sale_date | date | |
| recorded_by | text (FK→profiles) | |

### inventory_transactions (audit trail)
| Column | Type | Notes |
|--------|------|-------|
| id | int (PK) | |
| product_id | int (FK) | |
| type | text | checkout, checkin, sale, rental_out, rental_return, damage, stock_in, adjustment |
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
