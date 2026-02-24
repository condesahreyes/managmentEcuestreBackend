-- Tabla para rastrear clases usadas por mes para suscripciones indefinidas
CREATE TABLE IF NOT EXISTS clases_mensuales (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  suscripcion_id UUID REFERENCES suscripciones(id) ON DELETE CASCADE,
  mes INTEGER NOT NULL CHECK (mes BETWEEN 1 AND 12),
  año INTEGER NOT NULL,
  clases_usadas INTEGER DEFAULT 0,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),
  UNIQUE(suscripcion_id, mes, año)
);

CREATE INDEX idx_clases_mensuales_suscripcion ON clases_mensuales(suscripcion_id);
CREATE INDEX idx_clases_mensuales_mes_año ON clases_mensuales(mes, año);
