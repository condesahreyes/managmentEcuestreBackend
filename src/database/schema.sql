-- Tipos de usuario
CREATE TYPE user_role AS ENUM ('escuelita', 'pension_completa', 'media_pension', 'admin', 'profesor');
CREATE TYPE horse_type AS ENUM ('escuela', 'privado');
CREATE TYPE horse_status AS ENUM ('activo', 'descanso', 'lesionado');
CREATE TYPE class_status AS ENUM ('programada', 'completada', 'cancelada', 'reagendada');

-- Usuarios
CREATE TABLE users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email VARCHAR(255) UNIQUE NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  nombre VARCHAR(255) NOT NULL,
  apellido VARCHAR(255) NOT NULL,
  telefono VARCHAR(50),
  rol user_role NOT NULL,
  activo BOOLEAN DEFAULT true,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- Profesores
CREATE TABLE profesores (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  especialidad TEXT,
  activo BOOLEAN DEFAULT true,
  created_at TIMESTAMP DEFAULT NOW()
);

-- Horarios de disponibilidad de profesores
CREATE TABLE horarios_profesores (
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

-- Caballos
CREATE TABLE caballos (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  nombre VARCHAR(255) NOT NULL,
  tipo horse_type NOT NULL,
  estado horse_status DEFAULT 'activo',
  limite_clases_dia INTEGER DEFAULT 3,
  dueno_id UUID REFERENCES users(id) ON DELETE SET NULL,
  activo BOOLEAN DEFAULT true,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- Planes
CREATE TABLE planes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  nombre VARCHAR(255) NOT NULL,
  tipo user_role NOT NULL,
  clases_mes INTEGER NOT NULL,
  precio DECIMAL(10, 2) NOT NULL,
  activo BOOLEAN DEFAULT true,
  created_at TIMESTAMP DEFAULT NOW()
);

-- Suscripciones de usuarios
CREATE TABLE suscripciones (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  plan_id UUID REFERENCES planes(id),
  fecha_inicio DATE NOT NULL,
  fecha_fin DATE NOT NULL,
  activa BOOLEAN DEFAULT true,
  clases_incluidas INTEGER NOT NULL,
  clases_usadas INTEGER DEFAULT 0,
  created_at TIMESTAMP DEFAULT NOW()
);

-- Asociaciones de alumnos escuelita (día y hora fijos)
CREATE TABLE horarios_fijos (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  profesor_id UUID REFERENCES profesores(id),
  caballo_id UUID REFERENCES caballos(id) ON DELETE SET NULL,
  dia_semana INTEGER NOT NULL CHECK (dia_semana BETWEEN 0 AND 6), -- 0 = Domingo, 6 = Sábado
  hora TIME NOT NULL,
  activo BOOLEAN DEFAULT true,
  created_at TIMESTAMP DEFAULT NOW()
);

-- Clases
CREATE TABLE clases (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  profesor_id UUID REFERENCES profesores(id),
  caballo_id UUID REFERENCES caballos(id),
  fecha DATE NOT NULL,
  hora_inicio TIME NOT NULL,
  hora_fin TIME NOT NULL,
  estado class_status DEFAULT 'programada',
  es_extra BOOLEAN DEFAULT false, -- Para clases que exceden el plan
  es_reagendada BOOLEAN DEFAULT false,
  clase_original_id UUID REFERENCES clases(id) ON DELETE SET NULL,
  notas TEXT,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),
  UNIQUE(profesor_id, fecha, hora_inicio),
  UNIQUE(caballo_id, fecha, hora_inicio)
);

-- Pagos
CREATE TABLE pagos (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  suscripcion_id UUID REFERENCES suscripciones(id),
  monto DECIMAL(10, 2) NOT NULL,
  fecha_pago DATE NOT NULL,
  metodo_pago VARCHAR(50),
  estado VARCHAR(50) DEFAULT 'pendiente',
  created_at TIMESTAMP DEFAULT NOW()
);

-- Índices para optimización
CREATE INDEX idx_clases_fecha ON clases(fecha);
CREATE INDEX idx_clases_user ON clases(user_id);
CREATE INDEX idx_clases_profesor ON clases(profesor_id);
CREATE INDEX idx_clases_caballo ON clases(caballo_id);
CREATE INDEX idx_suscripciones_user ON suscripciones(user_id);
CREATE INDEX idx_suscripciones_activa ON suscripciones(activa);
CREATE INDEX idx_horarios_fijos_user ON horarios_fijos(user_id);
CREATE INDEX idx_horarios_profesores_profesor ON horarios_profesores(profesor_id);
CREATE INDEX idx_horarios_profesores_dia ON horarios_profesores(dia_semana);
