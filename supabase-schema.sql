-- ============================================
-- NARMADA ESSENCE — SUPABASE SCHEMA
-- Run this in Supabase SQL Editor (all at once)
-- ============================================

-- 1. PROFILES (extends Supabase auth.users)
CREATE TABLE profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email TEXT UNIQUE NOT NULL,
  full_name TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'seller' CHECK (role IN ('admin', 'seller')),
  phone TEXT,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- 2. CATEGORIES
CREATE TABLE categories (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('unit', 'liquid')),
  created_at TIMESTAMPTZ DEFAULT now()
);

-- 3. PRODUCTS
CREATE TABLE products (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  category_id INTEGER REFERENCES categories(id),
  type TEXT NOT NULL CHECK (type IN ('unit', 'liquid')),
  model_number TEXT,
  unit_price DECIMAL(10,2) NOT NULL DEFAULT 0,
  current_stock DECIMAL(12,2) NOT NULL DEFAULT 0,
  min_stock_threshold DECIMAL(12,2) NOT NULL DEFAULT 10,
  max_daily_consumption DECIMAL(12,2),
  expiry_date DATE,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- 4. PARTIES (customers/clients)
CREATE TABLE parties (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  phone TEXT,
  address TEXT,
  notes TEXT,
  amc_active BOOLEAN DEFAULT false,
  amc_day INTEGER CHECK (amc_day >= 1 AND amc_day <= 28),
  amc_rate NUMERIC DEFAULT 0,
  custom_category_rates JSONB,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- 5. CHECKOUT SESSIONS
CREATE TABLE checkout_sessions (
  id SERIAL PRIMARY KEY,
  seller_id UUID REFERENCES profiles(id),
  checkout_time TIMESTAMPTZ NOT NULL DEFAULT now(),
  checkin_time TIMESTAMPTZ,
  status TEXT NOT NULL DEFAULT 'checked_out' CHECK (status IN ('checked_out', 'checked_in', 'flagged')),
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- 6. CHECKOUT ITEMS
CREATE TABLE checkout_items (
  id SERIAL PRIMARY KEY,
  session_id INTEGER REFERENCES checkout_sessions(id) ON DELETE CASCADE,
  product_id INTEGER REFERENCES products(id),
  checkout_quantity DECIMAL(12,2) NOT NULL,
  checkin_quantity DECIMAL(12,2),
  is_flagged BOOLEAN DEFAULT false,
  flag_reason TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- 7. SALES
CREATE TABLE sales (
  id SERIAL PRIMARY KEY,
  party_id INTEGER REFERENCES parties(id),
  product_id INTEGER REFERENCES products(id),
  quantity DECIMAL(12,2) NOT NULL,
  unit_price DECIMAL(10,2) NOT NULL,
  total_amount DECIMAL(12,2) NOT NULL,
  payment_status TEXT DEFAULT 'pending' CHECK (payment_status IN ('paid', 'partial', 'pending')),
  payment_method TEXT CHECK (payment_method IN ('cash', 'upi', 'bank_transfer', 'cheque')),
  amount_received DECIMAL(12,2) DEFAULT 0,
  expected_payment_date DATE,
  sale_date DATE NOT NULL DEFAULT CURRENT_DATE,
  notes TEXT,
  recorded_by UUID REFERENCES profiles(id),
  created_at TIMESTAMPTZ DEFAULT now()
);

-- 8. RENTALS
CREATE TABLE rentals (
  id SERIAL PRIMARY KEY,
  product_id INTEGER REFERENCES products(id),
  party_id INTEGER REFERENCES parties(id),
  quantity INTEGER DEFAULT 1,
  rental_date DATE NOT NULL DEFAULT CURRENT_DATE,
  expected_return_date DATE,
  actual_return_date DATE,
  rent_amount DECIMAL(10,2) DEFAULT 0,
  status TEXT DEFAULT 'active' CHECK (status IN ('active', 'returned')),
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- 9. DAMAGE REPORTS
CREATE TABLE damage_reports (
  id SERIAL PRIMARY KEY,
  product_id INTEGER REFERENCES products(id),
  damage_type TEXT DEFAULT 'damaged' CHECK (damage_type IN ('damaged', 'lost', 'expired')),
  quantity DECIMAL(12,2) NOT NULL,
  reason TEXT,
  report_date DATE DEFAULT CURRENT_DATE,
  reported_by UUID REFERENCES profiles(id),
  created_at TIMESTAMPTZ DEFAULT now()
);

-- 10. INVENTORY TRANSACTIONS (audit trail)
CREATE TABLE inventory_transactions (
  id SERIAL PRIMARY KEY,
  product_id INTEGER REFERENCES products(id),
  type TEXT NOT NULL CHECK (type IN ('checkout','checkin','sale','rental_out','rental_return','damage','stock_in','adjustment')),
  quantity DECIMAL(12,2) NOT NULL,
  reference_type TEXT,
  reference_id INTEGER,
  performed_by UUID REFERENCES profiles(id),
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- 11. STOCK INTAKES
CREATE TABLE stock_intakes (
  id SERIAL PRIMARY KEY,
  product_id INTEGER REFERENCES products(id),
  quantity DECIMAL(12,2) NOT NULL,
  supplier TEXT,
  notes TEXT,
  received_by UUID REFERENCES profiles(id),
  created_at TIMESTAMPTZ DEFAULT now()
);

-- 12. PAYMENT FOLLOWUPS (seller visit logs for collections)
CREATE TABLE payment_followups (
  id SERIAL PRIMARY KEY,
  sale_id INTEGER REFERENCES sales(id),
  party_id INTEGER REFERENCES parties(id),
  visited_by UUID REFERENCES profiles(id),
  visit_date TIMESTAMPTZ DEFAULT now(),
  status_update TEXT,
  payment_method TEXT,
  amount_collected DECIMAL(12,2) DEFAULT 0,
  expected_payment_date DATE,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- ============================================
-- ROW LEVEL SECURITY (RLS)
-- ============================================

ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE products ENABLE ROW LEVEL SECURITY;
ALTER TABLE parties ENABLE ROW LEVEL SECURITY;
ALTER TABLE checkout_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE checkout_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE sales ENABLE ROW LEVEL SECURITY;
ALTER TABLE rentals ENABLE ROW LEVEL SECURITY;
ALTER TABLE damage_reports ENABLE ROW LEVEL SECURITY;
ALTER TABLE inventory_transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE stock_intakes ENABLE ROW LEVEL SECURITY;

-- Helper: check if current user is admin
CREATE OR REPLACE FUNCTION is_admin()
RETURNS BOOLEAN AS $$
  SELECT EXISTS (
    SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin'
  );
$$ LANGUAGE sql SECURITY DEFINER;

-- PROFILES: users see own, admins see all
CREATE POLICY "Users view own profile" ON profiles FOR SELECT USING (id = auth.uid() OR is_admin());
CREATE POLICY "Admins manage profiles" ON profiles FOR ALL USING (is_admin());

-- CATEGORIES & PRODUCTS: everyone reads, admins write
CREATE POLICY "Anyone reads categories" ON categories FOR SELECT USING (true);
CREATE POLICY "Admins manage categories" ON categories FOR ALL USING (is_admin());
CREATE POLICY "Anyone reads products" ON products FOR SELECT USING (true);
CREATE POLICY "Admins manage products" ON products FOR ALL USING (is_admin());

-- PARTIES: admins full access, sellers can read
CREATE POLICY "Admins manage parties" ON parties FOR ALL USING (is_admin());
CREATE POLICY "Sellers read parties" ON parties FOR SELECT USING (true);

-- CHECKOUT: sellers see own, admins see all
CREATE POLICY "View own or admin sessions" ON checkout_sessions FOR SELECT USING (seller_id = auth.uid() OR is_admin());
CREATE POLICY "Admins manage sessions" ON checkout_sessions FOR ALL USING (is_admin());
CREATE POLICY "View own or admin items" ON checkout_items FOR SELECT USING (
  EXISTS (SELECT 1 FROM checkout_sessions WHERE id = checkout_items.session_id AND (seller_id = auth.uid() OR is_admin()))
);
CREATE POLICY "Admins manage items" ON checkout_items FOR ALL USING (is_admin());

-- SALES: admins full access, sellers can read
CREATE POLICY "Admins manage sales" ON sales FOR ALL USING (is_admin());
CREATE POLICY "Sellers read sales" ON sales FOR SELECT USING (true);

-- RENTALS, DAMAGE, TRANSACTIONS, INTAKES: admins only
CREATE POLICY "Admins manage rentals" ON rentals FOR ALL USING (is_admin());
CREATE POLICY "Admins manage damage" ON damage_reports FOR ALL USING (is_admin());
CREATE POLICY "Admins manage transactions" ON inventory_transactions FOR ALL USING (is_admin());
CREATE POLICY "Admins manage intakes" ON stock_intakes FOR ALL USING (is_admin());

-- PAYMENT FOLLOWUPS: admins full access, sellers can read and insert
ALTER TABLE payment_followups ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins manage followups" ON payment_followups FOR ALL USING (is_admin());
CREATE POLICY "Sellers read followups" ON payment_followups FOR SELECT USING (true);
CREATE POLICY "Sellers insert followups" ON payment_followups FOR INSERT WITH CHECK (auth.uid() = visited_by);

-- ============================================
-- AUTO-CREATE PROFILE ON SIGNUP
-- ============================================
CREATE OR REPLACE FUNCTION handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO profiles (id, email, full_name, role)
  VALUES (
    NEW.id,
    NEW.email,
    COALESCE(NEW.raw_user_meta_data->>'full_name', split_part(NEW.email, '@', 1)),
    COALESCE(NEW.raw_user_meta_data->>'role', 'seller')
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION handle_new_user();

-- ============================================
-- SEED: Categories
-- ============================================
INSERT INTO categories (name, type) VALUES
  ('Automatic Dispenser', 'unit'),
  ('Smart Diffuser', 'unit'),
  ('Dispenser Refill', 'unit'),
  ('Diffuser Oil', 'liquid'),
  ('Room Cream', 'unit');
