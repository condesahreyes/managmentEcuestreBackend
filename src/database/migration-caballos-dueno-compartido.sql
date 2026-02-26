-- Agregar columna para segundo propietario (media pensión compartida)
ALTER TABLE caballos 
ADD COLUMN IF NOT EXISTS dueno_id2 UUID REFERENCES users(id) ON DELETE SET NULL;

-- Índice para búsquedas rápidas
CREATE INDEX IF NOT EXISTS idx_caballos_dueno_id2 ON caballos(dueno_id2);
