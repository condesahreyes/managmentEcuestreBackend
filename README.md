# Backend - Centro Ecuestre

API REST para gestión de centro ecuestre con Node.js y Supabase.

## Instalación

```bash
npm install
```

## Configuración

1. Copia `.env.example` a `.env`
2. Configura las variables de entorno con tus credenciales de Supabase

## Base de Datos

Ejecuta el script `src/database/schema.sql` en tu base de datos de Supabase para crear las tablas necesarias.

## Ejecutar

```bash
# Desarrollo
npm run dev

# Producción
npm start
```

## Endpoints Principales

### Autenticación
- `POST /api/auth/register` - Registro de usuario
- `POST /api/auth/login` - Login

### Clases
- `GET /api/clases/mis-clases` - Obtener clases del usuario
- `POST /api/clases/reservar` - Crear reserva
- `POST /api/clases/reagendar/:claseId` - Reagendar clase
- `POST /api/clases/cancelar/:claseId` - Cancelar clase
- `POST /api/clases/generar-mensuales` - Generar clases mensuales (escuelita)

### Caballos
- `GET /api/caballos/disponibles` - Obtener caballos disponibles
- `GET /api/caballos/:id` - Obtener caballo por ID

### Profesores
- `GET /api/profesores/disponibles` - Obtener profesores disponibles

### Planes
- `GET /api/planes` - Obtener planes disponibles
- `GET /api/planes/:id` - Obtener plan por ID

### Suscripciones
- `GET /api/suscripciones/mi-suscripcion` - Obtener suscripción activa
- `POST /api/suscripciones` - Crear suscripción

### Horarios Fijos (Escuelita)
- `GET /api/horarios-fijos/mi-horario` - Obtener horario fijo
- `POST /api/horarios-fijos` - Crear/actualizar horario fijo

### Admin
- `GET /api/admin/agenda` - Agenda general
- `GET /api/admin/ocupacion/caballos` - Ocupación por caballo
- `GET /api/admin/ocupacion/profesores` - Ocupación por profesor
- `GET /api/admin/alumnos` - Alumnos activos
- `PATCH /api/admin/alumnos/:id/bloquear` - Bloquear/desbloquear alumno
- `PATCH /api/admin/caballos/:id/estado` - Cambiar estado de caballo
- `GET /api/admin/planes` - CRUD de planes
