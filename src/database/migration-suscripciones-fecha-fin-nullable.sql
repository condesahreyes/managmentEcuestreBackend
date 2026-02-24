-- Migración para hacer fecha_fin nullable en suscripciones
-- Esto permite que las suscripciones de pensión completa y media pensión
-- no tengan fecha de finalización (indeterminadas)

ALTER TABLE suscripciones
ALTER COLUMN fecha_fin DROP NOT NULL;
