# Implementación: Soporte para Caballos Compartidos en Media Pensión

## Descripción

Implementación de la capacidad de asignar hasta 2 propietarios a un caballo para usuarios de **media pensión**:

- **Pensión Completa**: 1 propietario (columna `dueno_id`)
- **Media Pensión**: Hasta 2 propietarios compartidos (columnas `dueno_id` + `dueno_id2`)

Cuando un usuario de media pensión intenta reservar un caballo compartido, se valida que **no haya conflicto de horario** con el co-propietario.

## Cambios de Base de Datos

### Migración: Agregar columna `dueno_id2`

```sql
ALTER TABLE caballos
ADD COLUMN IF NOT EXISTS dueno_id2 UUID REFERENCES users(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_caballos_dueno_id2 ON caballos(dueno_id2);
```

**Archivo**: `src/database/migration-caballos-dueno-compartido.sql`

Ejecutar esta migración en Supabase:

```bash
# En Supabase → SQL Editor → Copiar y ejecutar el contenido del archivo
```

## Cambios en el Código

### 1. ReservaService (`src/services/reservaService.js`)

**Nuevos métodos**:

#### `obtenerCoPropietario(caballoId, userIdActual)`

- Obtiene el ID del co-propietario de un caballo
- Retorna `null` si no hay co-propietario

#### `obtenerClasesDelCoPropietario(caballoId, userIdActual, fecha, horaInicio, horaFin)`

- Busca clases del co-propietario que se superponen en horario
- Valida que no haya conflicto de tiempo

**Validación mejorada en `validarReserva()`**:

- Paso 8: Para media pensión, verifica que NO haya conflicto con el co-propietario
- Mensaje de error claro si hay conflicto de horario

### 2. Rutas de Admin (`src/routes/admin.js`)

**Actualizado GET `/admin/caballos`**:

- Ahora retorna `dueno` (propietario 1) y `dueno2` (propietario 2)
- Incluye información de ambos usuarios

**Actualizado PATCH `/admin/caballos/:id`**:

- Permite actualizar `dueno_id2` como campo normal
- Al cambiar tipo a 'escuela', limpia ambos `dueno_id` y `dueno_id2`

### 3. Rutas de Caballos (`src/routes/caballos.js`)

**Actualizado GET `/caballos/disponibles`**:

- Busca caballos donde el usuario es `dueno_id` **O** `dueno_id2`
- Usa query: `or(dueno_id.eq.userId,dueno_id2.eq.userId)`

## Flujo de Uso

### 1. Crear un caballo compartido para media pensión

**Crear el caballo** (admin):

```bash
POST /admin/caballos
{
  "nombre": "Tormenta",
  "tipo": "privado",
  "estado": "activo",
  "limite_clases_dia": 3
}
```

Response: `{ id, nombre, tipo, ... }`

### 2. Asignar propietarios

**Asignar primer propietario** (admin):

```bash
PATCH /admin/caballos/{caballoId}
{
  "dueno_id": "{usuarioMediaPension1}"
}
```

**Asignar segundo propietario** (admin):

```bash
PATCH /admin/caballos/{caballoId}
{
  "dueno_id2": "{usuarioMediaPension2}"
}
```

O ambos en un solo PATCH:

```bash
PATCH /admin/caballos/{caballoId}
{
  "dueno_id": "{usuarioMediaPension1}",
  "dueno_id2": "{usuarioMediaPension2}"
}
```

### 3. Verificar caballos compartidos

```bash
GET /admin/caballos

Response:
[
  {
    id: "...",
    nombre: "Tormenta",
    tipo: "privado",
    dueno_id: "uuid1",
    dueno: { id: "uuid1", nombre: "Juan", apellido: "Pérez", email: "juan@..." },
    dueno_id2: "uuid2",
    dueno2: { id: "uuid2", nombre: "María", apellido: "García", email: "maria@..." },
    ...
  }
]
```

### 4. Reservar una clase (Usuario media pensión)

**Usuario 1 intenta reservar**:

```bash
POST /clases
{
  "profesorId": "...",
  "caballoId": "...",
  "fecha": "2026-02-25",
  "horaInicio": "10:00",
  "horaFin": "11:00"
}
```

**Validaciones internas**:

1. ✅ Usuario activo
2. ✅ Plan vigente
3. ✅ Clases disponibles
4. ✅ Acceso mensual por pagos
5. ✅ Profesor disponible
6. ✅ Caballo disponible (limite diario)
7. ✅ Sin conflicto de horario con usuario 1
8. ✅ **SIN conflicto con usuario 2 (co-propietario)**

Si Usuario 2 tiene clase de 10:30-11:30 en el mismo caballo:

```
❌ Error: "No puedes reservar en ese horario. Tu co-propietario del caballo
   ya tiene una clase programada en ese horario."
```

## Retrocompatibilidad

- Los caballos existentes con solo `dueno_id` siguen funcionando normalmente
- El campo `dueno_id2` es opcional (NULL por defecto)
- Los caballos de escuela mantienen ambos campos en NULL

## Validaciones de Negocio Implementadas

| Regla                                    | Estado | Método                            |
| ---------------------------------------- | ------ | --------------------------------- |
| No se permiten reservas de meses pasados | ✅     | `validarAccesoMensualPorPagos()`  |
| Solo mes actual o siguiente              | ✅     | `validarAccesoMensualPorPagos()`  |
| No saltar meses sin pagar                | ✅     | `validarAccesoMensualPorPagos()`  |
| Mes actual ≤ día 10 sin pago             | ✅     | `validarAccesoMensualPorPagos()`  |
| Mes actual > día 10 requiere pago        | ✅     | `validarAccesoMensualPorPagos()`  |
| Mes siguiente requiere pago actual       | ✅     | `validarAccesoMensualPorPagos()`  |
| Caballo compartido sin conflicto         | ✅     | `obtenerClasesDelCoPropietario()` |

## Testing

### Caso 1: Co-propietarios con horarios conflictivos

```
Setup:
- Caballo "Tormenta" con dueno_id=User1, dueno_id2=User2
- User1 ya tiene clase 25/02 de 10:00-11:00

Intento:
- User2 intenta reservar 25/02 de 10:30-11:30

Resultado: ❌ Error - conflicto con co-propietario
```

### Caso 2: Co-propietarios sin conflicto

```
Setup:
- Mismo caballo compartido
- User1 tiene clase 25/02 de 10:00-11:00

Intento:
- User2 intenta reservar 25/02 de 11:00-12:00

Resultado: ✅ Éxito - horarios no se superponen
```

### Caso 3: Validación de pagos activa

```
Setup:
- User media_pension intenta reservar
- Hoy: 25/02 (> día 10)
- Sin pago para febrero

Intento:
- Reservar para 25/02

Resultado: ❌ Error - mes adeudado
```

## Estructura Final de la Tabla

```sql
CREATE TABLE caballos (
  id UUID PRIMARY KEY,
  nombre VARCHAR(255) NOT NULL,
  tipo horse_type,           -- 'escuela' o 'privado'
  estado horse_status,       -- 'activo', 'descanso', 'lesionado'
  limite_clases_dia INTEGER DEFAULT 3,
  dueno_id UUID,             -- 📌 Propietario 1 / Pensión Completa
  dueno_id2 UUID,            -- 📌 Propietario 2 / Media Pensión
  activo BOOLEAN DEFAULT true,
  created_at TIMESTAMP,
  updated_at TIMESTAMP,

  FOREIGN KEY (dueno_id) REFERENCES users(id),
  FOREIGN KEY (dueno_id2) REFERENCES users(id),
  INDEX idx_caballos_dueno_id2(dueno_id2)
);
```

## API Endpoints Relevantes

| Endpoint                | Método | Descripción                                                  |
| ----------------------- | ------ | ------------------------------------------------------------ |
| `/admin/caballos`       | GET    | Listar caballos con propietarios                             |
| `/admin/caballos`       | POST   | Crear caballo                                                |
| `/admin/caballos/:id`   | PATCH  | Actualizar caballo (incluye dueno_id2)                       |
| `/caballos/disponibles` | GET    | Obtener caballos del usuario (busca en dueno_id y dueno_id2) |
| `/clases`               | POST   | Crear reserva (valida conflicto con co-propietario)          |
