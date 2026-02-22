-- Extensión para almacenar archivos (si no existe)
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Tipo de estado de comprobante
CREATE TYPE comprobante_estado AS ENUM ('pendiente', 'aprobado', 'rechazado');

-- Facturas mensuales
CREATE TABLE facturas (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  suscripcion_id UUID REFERENCES suscripciones(id) ON DELETE SET NULL,
  mes INTEGER NOT NULL CHECK (mes BETWEEN 1 AND 12),
  año INTEGER NOT NULL,
  monto DECIMAL(10, 2) NOT NULL,
  estado VARCHAR(50) DEFAULT 'pendiente', -- pendiente, pagada, vencida
  fecha_vencimiento DATE NOT NULL, -- Día 10 hábil del mes
  fecha_pago DATE,
  pagada BOOLEAN DEFAULT false,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),
  UNIQUE(user_id, mes, año)
);

-- Comprobantes de pago
CREATE TABLE comprobantes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  factura_id UUID REFERENCES facturas(id) ON DELETE CASCADE,
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  archivo_url TEXT NOT NULL, -- URL del archivo en Supabase Storage
  nombre_archivo VARCHAR(255) NOT NULL,
  tipo_archivo VARCHAR(50) NOT NULL, -- image/jpeg, image/png, application/pdf
  monto DECIMAL(10, 2) NOT NULL,
  fecha_subida TIMESTAMP DEFAULT NOW(),
  fecha_revision TIMESTAMP,
  estado comprobante_estado DEFAULT 'pendiente',
  observaciones TEXT, -- Observaciones del admin al rechazar
  revisado_por UUID REFERENCES users(id) ON DELETE SET NULL, -- Admin que revisó
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- Índices para optimización
CREATE INDEX idx_facturas_user ON facturas(user_id);
CREATE INDEX idx_facturas_mes_ano ON facturas(mes, año);
CREATE INDEX idx_facturas_estado ON facturas(estado);
CREATE INDEX idx_comprobantes_factura ON comprobantes(factura_id);
CREATE INDEX idx_comprobantes_user ON comprobantes(user_id);
CREATE INDEX idx_comprobantes_estado ON comprobantes(estado);
