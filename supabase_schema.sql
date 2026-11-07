-- ============================================================================
-- ESQUEMA COMPLETO DE BASE DE DATOS BLOOM BEAUTY v6 (SUPABASE / POSTGRESQL)
-- Pega este script completo en el SQL Editor de tu proyecto en Supabase
-- ============================================================================

-- 1. Tabla de Configuración y Metadatos de la Tienda
CREATE TABLE IF NOT EXISTS store_metadata (
  id TEXT PRIMARY KEY DEFAULT 'master',
  data JSONB NOT NULL,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 2. Tabla de Clientes
CREATE TABLE IF NOT EXISTS customers (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  username TEXT,
  phone TEXT,
  email TEXT,
  city TEXT,
  department TEXT,
  address TEXT,
  password TEXT,
  password_hash TEXT,
  balance NUMERIC DEFAULT 0,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  last_login_at TIMESTAMP WITH TIME ZONE,
  extra JSONB DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS idx_customers_email ON customers (email);
CREATE INDEX IF NOT EXISTS idx_customers_phone ON customers (phone);

-- 3. Tabla de Productos y Catálogo
CREATE TABLE IF NOT EXISTS products (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  brand_id TEXT,
  brand_name TEXT,
  price NUMERIC NOT NULL DEFAULT 0,
  cost NUMERIC DEFAULT 0,
  stock INT DEFAULT 0,
  category TEXT,
  image_url TEXT,
  description TEXT,
  is_active BOOLEAN DEFAULT TRUE,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 4. Tabla de Pedidos (Orders)
CREATE TABLE IF NOT EXISTS orders (
  id TEXT PRIMARY KEY,
  customer_id TEXT,
  customer_name TEXT,
  customer_phone TEXT,
  items JSONB NOT NULL DEFAULT '[]'::jsonb,
  subtotal NUMERIC NOT NULL DEFAULT 0,
  discount NUMERIC DEFAULT 0,
  coupon_code TEXT,
  total NUMERIC NOT NULL DEFAULT 0,
  payment_method TEXT DEFAULT 'saldo_virtual',
  status TEXT DEFAULT 'completada',
  delivery_info JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_orders_customer_id ON orders (customer_id);
CREATE INDEX IF NOT EXISTS idx_orders_created_at ON orders (created_at DESC);

-- 5. Tabla de Solicitudes de Recarga de Saldo
CREATE TABLE IF NOT EXISTS recharge_requests (
  id TEXT PRIMARY KEY,
  customer_id TEXT NOT NULL,
  customer_name TEXT,
  customer_phone TEXT,
  amount NUMERIC NOT NULL,
  receipt_url TEXT,
  status TEXT DEFAULT 'pendiente',
  reference TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  processed_at TIMESTAMP WITH TIME ZONE
);

CREATE INDEX IF NOT EXISTS idx_recharges_customer_id ON recharge_requests (customer_id);

-- 6. Tabla de Gastos (Expenses)
CREATE TABLE IF NOT EXISTS expenses (
  id TEXT PRIMARY KEY,
  concept TEXT NOT NULL,
  amount NUMERIC NOT NULL,
  category TEXT,
  date_recorded DATE DEFAULT CURRENT_DATE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 7. Tabla de Reseñas y Comentarios
CREATE TABLE IF NOT EXISTS reviews (
  id TEXT PRIMARY KEY,
  customer_id TEXT,
  customer_name TEXT,
  product_id TEXT,
  rating INT NOT NULL CHECK (rating >= 1 AND rating <= 5),
  comment TEXT,
  status TEXT DEFAULT 'aprobado',
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 8. Tabla de Ofertas y Cupones
CREATE TABLE IF NOT EXISTS offers (
  id TEXT PRIMARY KEY,
  code TEXT UNIQUE NOT NULL,
  discount_percent INT DEFAULT 0,
  discount_fixed NUMERIC DEFAULT 0,
  min_purchase NUMERIC DEFAULT 0,
  is_active BOOLEAN DEFAULT TRUE,
  expires_at TIMESTAMP WITH TIME ZONE
);

-- 9. Tabla de Reportes de Bugs
CREATE TABLE IF NOT EXISTS bugs (
  id TEXT PRIMARY KEY,
  reporter TEXT,
  description TEXT NOT NULL,
  user_agent TEXT,
  status TEXT DEFAULT 'pendiente',
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 10. Tabla de Sesiones Activas y Analítica en Tiempo Real
CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  customer_id TEXT,
  device_info JSONB DEFAULT '{}'::jsonb,
  ip_address TEXT,
  city TEXT,
  country TEXT,
  last_activity TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 11. Tabla de Transacciones y Movimientos de Billetera
CREATE TABLE IF NOT EXISTS transactions (
  id TEXT PRIMARY KEY,
  customer_id TEXT NOT NULL,
  type TEXT NOT NULL, -- 'recarga', 'compra', 'reembolso', 'ajuste'
  amount NUMERIC NOT NULL,
  balance_before NUMERIC DEFAULT 0,
  balance_after NUMERIC DEFAULT 0,
  reference TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_transactions_customer_id ON transactions (customer_id);

-- 12. Snapshot de Sincronización Global (Permite guardar y cargar el estado unificado con 1 petición)
CREATE TABLE IF NOT EXISTS app_snapshots (
  id TEXT PRIMARY KEY DEFAULT 'latest',
  snapshot_data JSONB NOT NULL,
  version TEXT DEFAULT '6.0',
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Desactivar políticas RLS si vas a acceder mediante API REST de tu servidor Render
ALTER TABLE store_metadata DISABLE ROW LEVEL SECURITY;
ALTER TABLE customers DISABLE ROW LEVEL SECURITY;
ALTER TABLE products DISABLE ROW LEVEL SECURITY;
ALTER TABLE orders DISABLE ROW LEVEL SECURITY;
ALTER TABLE recharge_requests DISABLE ROW LEVEL SECURITY;
ALTER TABLE expenses DISABLE ROW LEVEL SECURITY;
ALTER TABLE reviews DISABLE ROW LEVEL SECURITY;
ALTER TABLE offers DISABLE ROW LEVEL SECURITY;
ALTER TABLE bugs DISABLE ROW LEVEL SECURITY;
ALTER TABLE sessions DISABLE ROW LEVEL SECURITY;
ALTER TABLE transactions DISABLE ROW LEVEL SECURITY;
ALTER TABLE app_snapshots DISABLE ROW LEVEL SECURITY;
