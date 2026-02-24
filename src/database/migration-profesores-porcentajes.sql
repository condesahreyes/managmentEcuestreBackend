-- Agregar campos de porcentaje de pago a profesores
ALTER TABLE profesores
ADD COLUMN IF NOT EXISTS porcentaje_escuelita DECIMAL(5, 2) DEFAULT 0.00 CHECK (porcentaje_escuelita >= 0 AND porcentaje_escuelita <= 100),
ADD COLUMN IF NOT EXISTS porcentaje_pension DECIMAL(5, 2) DEFAULT 0.00 CHECK (porcentaje_pension >= 0 AND porcentaje_pension <= 100);
