-- Agregar columna caballo_id a horarios_fijos para escuelita
ALTER TABLE horarios_fijos 
ADD COLUMN IF NOT EXISTS caballo_id UUID REFERENCES caballos(id) ON DELETE SET NULL;
