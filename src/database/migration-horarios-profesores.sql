-- Tabla para horarios de disponibilidad de profesores
CREATE TABLE IF NOT EXISTS horarios_profesores (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  profesor_id UUID REFERENCES profesores(id) ON DELETE CASCADE,
  dia_semana INTEGER NOT NULL CHECK (dia_semana BETWEEN 0 AND 6), -- 0 = Domingo, 6 = Sábado
  hora_inicio TIME NOT NULL,
  hora_fin TIME NOT NULL,
  activo BOOLEAN DEFAULT true,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),
  UNIQUE(profesor_id, dia_semana, hora_inicio, hora_fin)
);

-- Índice para optimización
CREATE INDEX IF NOT EXISTS idx_horarios_profesores_profesor ON horarios_profesores(profesor_id);
CREATE INDEX IF NOT EXISTS idx_horarios_profesores_dia ON horarios_profesores(dia_semana);
