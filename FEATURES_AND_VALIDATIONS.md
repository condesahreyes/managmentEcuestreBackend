# Features y Validaciones - Sistema de Reservas Ecuestre

## Descripción General

Sistema backend para gestionar reservas de clases ecuestre, con soporte para múltiples tipos de usuarios, planes, pagos y validaciones complejas de disponibilidad.

---

## 1. TIPOS DE USUARIOS (ROLES)

Todos los roles están definidos en el enum `user_role`:

| Rol | Descripción | Acceso a Reservas | Suscripción |
|-----|-------------|-------------------|------------|
| **escuelita** | Alumno ocasional | Sí | Mensual (con fecha_fin) |
| **pension_completa** | Pensión completa del caballo | Sí | Indefinida (fecha_fin = NULL) |
| **media_pension** | Media pensión (caballo compartido) | Sí | Indefinida (fecha_fin = NULL) |
| **profesor** | Instructor/profesor | No (solo dicta clases) | N/A |
| **admin** | Administrador del sistema | N/A | N/A |

---

## 2. MODELOS DE DATOS PRINCIPALES

### 2.1 Usuarios
- **id**: UUID (PK)
- **email**: VARCHAR(255) UNIQUE
- **password_hash**: VARCHAR(255)
- **nombre**: VARCHAR(255)
- **apellido**: VARCHAR(255)
- **telefono**: VARCHAR(50)
- **rol**: user_role (enum)
- **activo**: BOOLEAN (default: true)
- **created_at**, **updated_at**: TIMESTAMP

**Validaciones**:
- Solo usuarios activos pueden hacer reservas
- Si usuario está bloqueado (activo=false), no puede reservar

### 2.2 Caballos
- **id**: UUID (PK)
- **nombre**: VARCHAR(255)
- **tipo**: horse_type (enum: 'escuela', 'privado')
- **estado**: horse_status (enum: 'activo', 'descanso', 'lesionado')
- **limite_clases_dia**: INTEGER (default: 3)
- **dueno_id**: UUID (FK users) - propietario principal
- **dueno_id2**: UUID (FK users) - co-propietario (para media_pension)
- **activo**: BOOLEAN (default: true)

**Validaciones**:
- Solo caballos con estado='activo' pueden ser reservados
- No se puede exceder el límite_clases_dia
- Un caballo 'privado' solo puede ser reservado por su(s) propietario(s)
- Un caballo 'escuela' puede ser reservado por usuarios 'escuelita'

### 2.3 Planes
- **id**: UUID (PK)
- **nombre**: VARCHAR(255)
- **tipo**: user_role (enum: 'escuelita', 'pension_completa', 'media_pension')
- **clases_mes**: INTEGER - cantidad de clases mensuales incluidas
- **precio**: DECIMAL(10, 2)
- **activo**: BOOLEAN

**Validaciones**:
- El tipo de plan debe coincidir con el rol del usuario que lo contrata
- clases_mes > 0

### 2.4 Suscripciones
- **id**: UUID (PK)
- **user_id**: UUID (FK users)
- **plan_id**: UUID (FK planes)
- **fecha_inicio**: DATE
- **fecha_fin**: DATE (NULL para pensiones indefinidas)
- **activa**: BOOLEAN
- **clases_incluidas**: INTEGER
- **clases_usadas**: INTEGER (default: 0)

**Validaciones**:
- Solo una suscripción activa por usuario a la vez (para escuelita)
- Para pensión/media pensión: fecha_fin = NULL (indefinida)
- fecha_inicio ≤ hoy ≤ fecha_fin (o sin fecha_fin si es indefinida)
- clases_usadas ≤ clases_incluidas

### 2.5 Clases
- **id**: UUID (PK)
- **user_id**: UUID (FK users)
- **profesor_id**: UUID (FK profesores)
- **caballo_id**: UUID (FK caballos)
- **fecha**: DATE
- **hora_inicio**: TIME
- **hora_fin**: TIME
- **estado**: class_status (enum: 'programada', 'completada', 'cancelada', 'reagendada')
- **notas**: TEXT (opcional)
- **es_extra**: BOOLEAN (default: false) - usa clases extra no incluidas en plan

**Validaciones**:
- Estado inicial: 'programada'
- fecha no puede ser pasada (para pension/media_pension)
- hora_inicio < hora_fin
- No puede haber dos clases del mismo usuario en el mismo día (pension/media_pension)

### 2.6 Clases Mensuales
- **id**: UUID (PK)
- **suscripcion_id**: UUID (FK suscripciones)
- **mes**: INTEGER (1-12)
- **año**: INTEGER
- **clases_usadas**: INTEGER (default: 0)
- **UNIQUE**: (suscripcion_id, mes, año)

**Validaciones**:
- 1 ≤ mes ≤ 12
- año ≥ 2020
- Se crea automáticamente al necesitar

### 2.7 Facturas
- **id**: UUID (PK)
- **user_id**: UUID (FK users)
- **suscripcion_id**: UUID (FK suscripciones)
- **mes**: INTEGER (1-12)
- **año**: INTEGER
- **monto**: DECIMAL(10, 2)
- **estado**: VARCHAR (valores: 'pagado', 'pagada', 'pendiente', 'vencida', 'aprobado', 'confirmado')
- **fecha_vencimiento**: DATE
- **created_at**: TIMESTAMP

**Validaciones**:
- Se genera automáticamente el día 1 de cada mes
- Vencimiento: día 10 hábil del mes (si es fin de semana → lunes)
- Solo se genera para suscripciones activas con fecha_fin = NULL

### 2.8 Comprobantes
- **id**: UUID (PK)
- **user_id**: UUID (FK users)
- **factura_id**: UUID (FK facturas)
- **archivo_url**: VARCHAR(512) - ruta en Storage
- **estado**: VARCHAR (valores: 'pendiente', 'aprobado', 'rechazado')
- **razon_rechazo**: TEXT (opcional)
- **created_at**: TIMESTAMP

**Validaciones**:
- Estado inicial: 'pendiente'
- Solo un comprobante por factura
- Tamaño máximo de archivo: depende configuración

### 2.9 Profesores
- **id**: UUID (PK)
- **user_id**: UUID (FK users)
- **especialidad**: TEXT
- **porcentaje_escuelita**: DECIMAL(5, 2) - comisión por clase escuelita
- **porcentaje_pension**: DECIMAL(5, 2) - comisión por clase pensión
- **activo**: BOOLEAN

**Validaciones**:
- 0 ≤ porcentaje_escuelita ≤ 100
- 0 ≤ porcentaje_pension ≤ 100

### 2.10 Horarios de Profesores
- **id**: UUID (PK)
- **profesor_id**: UUID (FK profesores)
- **dia_semana**: INTEGER (0-6, donde 0=domingo, 6=sábado)
- **hora_inicio**: TIME
- **hora_fin**: TIME
- **activo**: BOOLEAN

**Validaciones**:
- 0 ≤ dia_semana ≤ 6
- hora_inicio < hora_fin
- UNIQUE: (profesor_id, dia_semana, hora_inicio, hora_fin)

### 2.11 Horarios Fijos (Escuelita)
- **id**: UUID (PK)
- **user_id**: UUID (FK users)
- **profesor_id**: UUID (FK profesores)
- **caballo_id**: UUID (FK caballos)
- **dia_semana**: INTEGER (0-6)
- **hora**: TIME
- **activo**: BOOLEAN

**Validaciones**:
- 0 ≤ dia_semana ≤ 6
- La cantidad de horarios debe coincidir con clases_mes/4

---

## 3. ENDPOINTS PRINCIPALES

### 3.1 Autenticación (auth.js)

#### POST /api/auth/register
- **Públicos**: Sí
- **Body**: email, password, nombre, apellido, telefono, rol
- **Validaciones**:
  - email formato válido y único
  - password ≥ 6 caracteres
  - rol en enum válido
  - nombre, apellido no vacíos
- **Respuesta**: token JWT, user

#### POST /api/auth/login
- **Autenticación**: No
- **Body**: email, password
- **Validaciones**:
  - email existe
  - password correcto
  - usuario activo
- **Respuesta**: token JWT, user

#### POST /api/auth/cambiar-password
- **Autenticación**: Sí
- **Body**: password_antiguo, password_nuevo
- **Validaciones**:
  - password_antiguo coincide con hash actual
  - password_nuevo ≥ 6 caracteres
  - password_nuevo ≠ password_antiguo

---

### 3.2 Clases y Reservas (clases.js)

#### GET /api/clases/mis-clases
- **Autenticación**: Sí
- **Validaciones**: Usuario debe estar completo (caballo + suscripción para pension/media_pension)
- **Query params**: fecha_inicio (optional), fecha_fin (optional)
- **Respuesta**: Array de clases del usuario con estado 'programada'

#### POST /api/clases/reservar
- **Autenticación**: Sí
- **Body**: profesor_id, caballo_id, fecha, hora_inicio, hora_fin, notas (opcional)
- **Validaciones principales** (10 puntos, en orden):
  1. Usuario existe y está activo
  2. Fecha no es pasada (solo pension/media_pension)
  3. **[NUEVO]** Al menos 24 horas de anticipación (solo pension/media_pension)
  4. Usuario tiene suscripción activa y vigente
  5. Usuario tiene clases disponibles en su plan
  6. **[NUEVO]** Validación de acceso mensual por pagos (solo pension/media_pension) - VER SECCIÓN 5
  7. Profesor existe y está disponible en ese horario (no tiene clase)
  8. Caballo existe, está activo y no supera límite_clases_dia
  9. Usuario no tiene conflicto de horario en ese día (pension/media_pension)
  10. **[NUEVO]** Para media_pension: co-propietario no tiene clase en ese horario - VER SECCIÓN 6
- **Respuesta**: clase creada

#### POST /api/clases/reagendar/:claseId
- **Autenticación**: Sí
- **Body**: fecha, hora_inicio, hora_fin
- **Validaciones**:
  - Clase pertenece al usuario
  - Nueva fecha no es pasada
  - Todas las validaciones de la nueva fecha/hora (profesor, caballo, usuario, co-propietario)
- **Acción**: Actualiza clase con nuevo horario

#### POST /api/clases/cancelar/:claseId
- **Autenticación**: Sí
- **Validaciones**:
  - Clase pertenece al usuario
  - Al menos 24 horas de anticipación
- **Acción**: Marca clase como 'cancelada', devuelve clase al contador

#### POST /api/clases/generar-mensuales
- **Autenticación**: Sí
- **Rol requerido**: 'escuelita'
- **Body**: mes (YYYY-MM)
- **Validaciones**:
  - Rol es escuelita
  - mes ≥ actual
  - No existe suscripción para ese mes
  - Datos de horarios rellenos
- **Acción**: Crea clases recurrentes para el mes en horarios fijos

---

### 3.3 Suscripciones (suscripciones.js)

#### GET /api/suscripciones/mi-suscripcion
- **Autenticación**: Sí
- **Respuesta**: Suscripción activa del usuario + clases disponibles
- Para pension/media_pension: clases del mes actual
- Para escuelita: clases totales disponibles

#### GET /api/suscripciones/historial
- **Autenticación**: Sí
- **Query params**: meses (default: 3)
- **Respuesta**: Array de suscripciones con:
  - estado: 'activa', 'finalizada', 'vencida'
  - tiene_facturas_pendientes: boolean
  - tiene_facturas_vencidas: boolean
  - facturas relacionadas

#### POST /api/suscripciones
- **Autenticación**: Sí
- **Body**: plan_id, fecha_inicio (opcional), horarios (array para escuelita)
- **Validaciones**:
  - Plan existe y está activo
  - Tipo de plan coincide con rol del usuario
  - Si es escuelita: fecha_inicio ≥ hoy y no en pasado
  - Si hay solapamiento de fechas con otra suscripción
  - **horarios**: array de objetos {dia_semana, hora}
    - Cantidad debe coincidir con clases_mes/4
    - Cada horario: 0 ≤ dia_semana ≤ 6, hora formato HH:MM
- **Acción**: 
  - Crea suscripción
  - Si es escuelita: crea horarios_fijos

---

### 3.4 Facturas (facturas.js)

#### GET /api/facturas/mis-facturas
- **Autenticación**: Sí
- **Respuesta**: Facturas del usuario

#### GET /api/facturas/pendientes
- **Autenticación**: Sí
- **Respuesta**: Facturas con estado != 'pagado'

#### GET /api/facturas/historial
- **Autenticación**: Sí
- **Respuesta**: Historial de facturas

#### POST /api/facturas/generar-mensuales
- **Autenticación**: Sí
- **Rol requerido**: admin
- **Acción**: 
  - Genera facturas para todas las suscripciones activas indefinidas (pension/media_pension)
  - Busca últimas facturas del mes anterior
  - Crea una factura por cada suscripción

#### POST /api/cron/generar-facturas
- **Autenticación**: No (para cron jobs)
- **Acción**: Igual a POST /api/facturas/generar-mensuales pero sin autenticación
- **Implementación**: Ejecutar el día 1 cada mes

---

### 3.5 Comprobantes (comprobantes.js)

#### POST /api/comprobantes/subir
- **Autenticación**: Sí
- **Multipart**: archivo (file)
- **Body**: factura_id
- **Validaciones**:
  - Factura existe y pertenece al usuario
  - Archivo está presente
  - Tipo de archivo válido (PDF, imágenes)
  - Tamaño < 5MB
- **Acción**: Sube archivo a Storage y crea registro de comprobante

#### GET /api/comprobantes/mis-comprobantes
- **Autenticación**: Sí
- **Respuesta**: Array de comprobantes del usuario

#### GET /api/comprobantes/pendientes
- **Autenticación**: Sí
- **Rol requerido**: admin
- **Respuesta**: Array de comprobantes con estado='pendiente'

#### POST /api/comprobantes/:id/aprobar
- **Autenticación**: Sí
- **Rol requerido**: admin
- **Acción**:
  - Actualiza comprobante: estado = 'aprobado'
  - Actualiza factura: estado = 'pagado'
  - Restar comisión del profesor (si corresponde)

#### POST /api/comprobantes/:id/rechazar
- **Autenticación**: Sí
- **Rol requerido**: admin
- **Body**: razon_rechazo
- **Acción**:
  - Actualiza comprobante: estado = 'rechazado', razon_rechazo
  - Usuario debe resubir comprobante

---

### 3.6 Caballos (caballos.js)

#### GET /api/caballos/disponibles
- **Autenticación**: Sí
- **Respuesta**: 
  - Si usuario es 'escuelita': caballos con tipo='escuela'
  - Si usuario es 'pension_completa' o 'media_pension': caballos donde dueno_id=usuario o dueno_id2=usuario
- **Datos retornados**:
  - id, nombre, tipo, estado, limite_clases_dia
  - dueno: {id, nombre, apellido, rol}
  - dueno2: {id, nombre, apellido, rol} (si existe)

#### GET /api/caballos/:id
- **Autenticación**: Sí
- **Validaciones**: Usuario debe estar completo (para pension/media_pension)
- **Respuesta**: Detalles del caballo

---

### 3.7 Admin - Caballos (admin.js)

#### GET /admin/caballos
- **Rol requerido**: admin
- **Respuesta**: Todos los caballos con sus propietarios

#### POST /admin/caballos
- **Rol requerido**: admin
- **Body**: nombre, tipo, estado, limite_clases_dia, dueno_id, dueno_id2 (opcional)
- **Validaciones**:
  - nombre no vacío
  - tipo en enum válido
  - estado en enum válido
  - limite_clases_dia > 0
  - Si dueno_id: debe ser usuario con rol 'pension_completa' o 'media_pension'
  - Si dueno_id2: debe ser usuario con rol 'media_pension'
  - dueno_id ≠ dueno_id2 (no ser el mismo usuario)
  - Si es 'privado': debe tener dueno_id
- **Acción**: Crea caballo

#### PATCH /admin/caballos/:id
- **Rol requerido**: admin
- **Body**: nombre, tipo, estado, limite_clases_dia, dueno_id, dueno_id2
- **Validaciones**: Igual a POST
- **UUID Handling**: Convierte strings vacíos a null antes de actualizar
- **Acción**: Actualiza caballo

#### DELETE /admin/caballos/:id
- **Rol requerido**: admin
- **Acción**: Marca caballo como inactivo (soft delete)

#### PATCH /admin/caballos/:id/estado
- **Rol requerido**: admin
- **Body**: estado
- **Validaciones**: estado en enum válido
- **Acción**: Actualiza estado del caballo

---

### 3.8 Admin - Usuarios (admin.js)

#### GET /admin/alumnos
- **Rol requerido**: admin
- **Respuesta**: Todos los usuarios (no-admin, no-profesor)

#### PATCH /admin/alumnos/:id/bloquear
- **Rol requerido**: admin
- **Body**: bloqueado (boolean)
- **Acción**: Actualiza campo activo del usuario

---

### 3.9 Admin - Profesores (admin.js)

#### GET /admin/profesores
- **Rol requerido**: admin
- **Respuesta**: Lista de profesores

#### POST /admin/profesores
- **Rol requerido**: admin
- **Body**: user_id, especialidad, porcentaje_escuelita, porcentaje_pension
- **Validaciones**:
  - user_id existe y rol es 'profesor'
  - 0 ≤ porcentaje_escuelita, porcentaje_pension ≤ 100

#### PATCH /admin/profesores/:id
- **Rol requerido**: admin
- **Body**: especialidad, porcentaje_escuelita, porcentaje_pension
- **Validaciones**: Igual a POST

#### POST /admin/profesores/:id/horarios
- **Rol requerido**: admin
- **Body**: dia_semana, hora_inicio, hora_fin
- **Validaciones**:
  - 0 ≤ dia_semana ≤ 6
  - hora_inicio < hora_fin
  - No existe horario duplicado
- **Acción**: Crea horario disponible para profesor

---

### 3.10 Admin - Planes (admin.js)

#### GET /admin/planes
- **Rol requerido**: admin
- **Respuesta**: Todos los planes

#### POST /admin/planes
- **Rol requerido**: admin
- **Body**: nombre, tipo, clases_mes, precio
- **Validaciones**:
  - nombre no vacío
  - tipo en enum válido
  - clases_mes > 0
  - precio > 0
- **Acción**: Crea plan

#### PATCH /admin/planes/:id
- **Rol requerido**: admin
- **Body**: nombre, tipo, clases_mes, precio
- **Validaciones**: Igual a POST
- **Acción**: Actualiza plan

#### DELETE /admin/planes/:id
- **Rol requerido**: admin
- **Acción**: Marca plan como inactivo

---

### 3.11 Admin - Suscripciones (admin.js)

#### POST /admin/alumnos/:id/suscripcion
- **Rol requerido**: admin
- **Body**: plan_id, fecha_inicio, fecha_fin (opcional)
- **Acción**: 
  - Asigna suscripción a usuario
  - Si es pensión: fecha_fin = NULL
  - Si es escuelita: fecha_fin = último día del mes

#### PATCH /admin/suscripciones/:id
- **Rol requerido**: admin
- **Body**: plan_id, fecha_inicio, fecha_fin, activa, clases_incluidas
- **Acción**: Actualiza suscripción

#### DELETE /admin/suscripciones/:id
- **Rol requerido**: admin
- **Acción**: Marca suscripción como inactiva

---

## 4. VALIDACIONES DE USUARIO

### Middleware: validarUsuarioCompleto

Se aplica a todas las rutas de reserva (clases.js, suscripciones.js).

**Validación**:
- Solo aplica a usuarios con rol 'pension_completa' o 'media_pension'
- El usuario debe tener:
  - Un caballo con dueno_id=usuario y activo=true
  - Una suscripción activa (activa=true, fecha_inicio ≤ hoy ≤ fecha_fin)

**Si falta**:
- Respuesta: 403
- Error: 'PENDIENTE_APROBACION'
- Mensaje: "Tu cuenta está pendiente de aprobación. El administrador debe asignarte un caballo y una suscripción."
- Incluye: tiene_caballo, tiene_suscripcion

---

## 5. VALIDACIÓN DE ACCESO MENSUAL POR PAGOS

**Aplica a**: usuarios con rol 'pension_completa' o 'media_pension'

**Regla General**:
- No se permiten reservas en meses pasados
- Solo se puede reservar el mes actual o el mes inmediatamente siguiente
- No se puede "saltar" meses sin haberlos pagado

### Lógica Detallada

#### A. Mes Actual

**Si día actual ≤ 10**:
- ✅ Permitir reserva sin necesidad de pago (período de gracia)

**Si día actual > 10**:
- Verificar que exista pago en facturas para (mes_actual, año_actual)
- Estados de pago válidos: 'pagado', 'pagada', 'aprobado', 'confirmado'
- ❌ Si no tiene pago: rechazar, señalar que mes está adeudado

#### B. Mes Siguiente

**Precondición**: El mes actual debe estar pagado o en período de gracia
- Si día_actual ≤ 10: considerar mes_actual como pagado
- Si día_actual > 10: verificar pago del mes_actual antes de permitir mes_siguiente

**Período de gracia del mes siguiente** (días 1-10):
- ✅ Permitir reserva sin pago del mes siguiente

**Después del día 10 del mes siguiente**:
- Verificar pago del mes siguiente
- ❌ Si no tiene: rechazar

### Error Message

```json
{
  "valido": false,
  "mesAdeudado": 1,
  "añoAdeudado": 2024,
  "error": "Tu pago de 1/2024 está pendiente. Por favor regulariza tu situación para continuar reservando."
}
```

---

## 6. VALIDACIÓN DE CABALLOS COMPARTIDOS (media_pension)

**Aplica a**: usuarios con rol 'media_pension'

**Contexto**: Un caballo 'privado' puede tener dos propietarios (dueno_id y dueno_id2) cuando ambos son usuarios 'media_pension'.

### Validación de Co-propietario

**Before**: No se puede crear clase con caballo compartido

**Check**:
1. Obtener caballo: si tiene dueno_id2, existe co-propietario
2. Obtener clases del co-propietario donde:
   - caballo_id = caballo compartido
   - fecha = fecha de la clase que se quiere crear
   - estado = 'programada'
3. Verificar superposición de horarios:
   - Si hora_fin_nueva > hora_inicio_existente AND hora_inicio_nueva < hora_fin_existente → conflicto

**Si hay conflicto**:
- ❌ Rechazar
- Error: "No puedes reservar en ese horario. Tu co-propietario del caballo ya tiene una clase programada en ese horario."

### Validación de Conflict Detection en Reserva

La validación ocurre en paso 8 del validarReserva():
```
Validar conflicto de horario del usuario
↓
Si rol == media_pension:
  ↓
  obtenerClasesDelCoPropietario()
  ↓
  if conflicto: rechazar
```

### Ejemplo Scenario

**Caso 1**: Dos media_pension comparten un caballo
- Usuario A: quiere reservar caballo compartido para 2024-01-15, 10:00-11:00
- Usuario B (co-propietario): ya tiene clase el 2024-01-15, 10:30-11:30
- ❌ Rechazar: conflicto de horario

**Caso 2**: Mismo caballo, horarios que NO se superponen
- Usuario A: quiere reservar 2024-01-15, 10:00-11:00
- Usuario B: tiene clase el 2024-01-15, 11:00-12:00
- ✅ Permitir: fin de A = inicio de B (sin solapamiento)

---

## 7. VALIDACIONES DE CLASES Y HORARIOS

### Validación de Anticipación (24 horas)

**Aplica a**: Solo usuarios con rol 'pension_completa' o 'media_pension'

**Regla**:
- No se puede agendar una clase si falta menos de 24 horas para el inicio de la misma
- Se calcula: diferencia (fecha_clase + hora_inicio) - (ahora)
- Si diferencia < 24 horas → rechazar

**Error Message**:
```json
{
  "valido": false,
  "error": "Debes reservar con al menos 24 horas de anticipación."
}
```

**Ejemplo Scenario**:
- Hoy: 2024-01-15 a las 10:00 AM
- Usuario intenta reservar para: 2024-01-16 a las 09:00 AM (23 horas)
- ❌ Rechazar: menos de 24 horas
- Usuario intenta reservar para: 2024-01-16 a las 10:01 AM (24 horas y 1 minuto)
- ✅ Permitir: más de 24 horas

### Disponibilidad de Profesor

**Verificación**: El profesor debe:
1. Tener un horario registrado en horarios_profesores para ese día de la semana
2. No tener clase programada en ese horario
3. Estar activo (activo = true)

**Query**:
```sql
SELECT * FROM clases 
WHERE profesor_id = ? 
  AND fecha = ?
  AND estado = 'programada'
  AND (hora_inicio = ? OR (hora_inicio < ? AND hora_fin > ?))
```

Si retorna resultados → profesor no disponible

### Disponibilidad de Caballo

**Verificación**: El caballo debe:
1. Estar activo (estado = 'activo')
2. No tener clase programada en ese horario
3. No superar límite_clases_dia

**Query**:
```sql
SELECT COUNT(*) FROM clases 
WHERE caballo_id = ? 
  AND fecha = ?
  AND estado = 'programada'
```

Si COUNT ≥ limite_clases_dia → caballo no disponible

### Conflicto de Horario del Usuario (Pension/Media_Pension)

**Validación**: Un usuario de pension/media_pension solo puede tener una clase por día

**Query**:
```sql
SELECT * FROM clases 
WHERE user_id = ? 
  AND fecha = ?
  AND estado = 'programada'
```

Si retorna algún resultado → usuario ya tiene clase ese día

---

## 8. GESTIÓN DE CLASES MENSUALES

### Para Pensión / Media Pensión

Cada mes se hace tracking de clases usadas por suscripción:

**Tabla**: clases_mensuales
- Estructura: (suscripcion_id, mes, año, clases_usadas)
- PRIMARY KEY: (suscripcion_id, mes, año)

**Flujo**:
1. Al crear clase: se llama a `ClasesMensualesService.incrementarClasesUsadas(suscripcion_id, mes, año)`
2. Al cancelar clase: se llama a `ClasesMensualesService.decrementarClasesUsadas(suscripcion_id, mes, año)`
3. Al consultar disponibles: `ClasesMensualesService.obtenerClasesDisponibles(suscripcion_id, mes, año)`
   - Retorna: {clasesIncluidas, clasesUsadas, clasesDisponibles}

**Validación**:
- clases_disponibles = clases_incluidas - clases_usadas
- Si clases_disponibles ≤ 0 → no permitir nueva clase

### Para Escuelita

**Tabla**: suscripciones
- Campos: clases_incluidas, clases_usadas

**Flujo**:
1. Al crear clase: incrementar clases_usadas
2. Al cancelar: decrementar clases_usadas
3. Validar: clases_usadas < clases_incluidas

---

## 9. GESTIÓN DE FACTURAS Y COMPROBANTES

### Generación Automática de Facturas

**Cuándo**: Day 1 de cada mes (scheduled via cron job)

**Para quién**: Usuarios con suscripción activa indefinida (fecha_fin = NULL)
- Tipos: 'pension_completa', 'media_pension'

**Qué se genera**:
- Una factura por suscripción
- Monto: precio del plan
- Vencimiento: día 10 hábil del mes
  - Si día 10 es fin de semana → lunes siguiente

**Validación**:
- No crear factura duplicada (verificar si ya existe para ese mes/año)

### Estados de Factura

| Estado | Descripción |
|--------|-------------|
| **pendiente** | Factura generada, aguardando pago |
| **vencida** | Factura pasada la fecha de vencimiento sin pago |
| **pagado/pagada** | Comprobante aprobado por admin |
| **aprobado/confirmado** | Alternativas de "pagado" |

### Flujo de Pago

1. **Usuario sube comprobante**: POST /api/comprobantes/subir
   - Archivo a Storage
   - Crea registro con estado='pendiente'

2. **Admin revisa**: GET /api/comprobantes/pendientes

3. **Admin aprueba o rechaza**:
   - APRUEBA: 
     - Comprobante: estado='aprobado'
     - Factura: estado='pagado'
     - Resuelve el acceso mensual para futuras reservas
   - RECHAZA:
     - Comprobante: estado='rechazado', razon_rechazo
     - Usuario debe resubir

---

## 10. CASOS DE PRUEBA CRÍTICOS

### TC-001: Creación de Reserva - Flujo Completo Happiness Path

**Setup**:
- Usuario 'escuelita' con plan activo, 5 clases/mes, 0 usadas
- Profesor disponible el martes 10-11
- Caballo tipo 'escuela' activo, 3 límite/día, 0 clases ese día
- Fecha: próximo martes

**Steps**:
1. POST /api/clases/reservar con datos válidos
2. Validar que la clase se crea con estado='programada'
3. Validar que clases_usadas aumenta a 1
4. Validar que GET /api/clases/mis-clases retorna la clase

**Expected**: 201, clase creada

---

### TC-003: Validación de Anticipación - Menos de 24 horas

**Setup**:
- Hoy = 15 de enero a las 10:00 AM
- Usuario 'pension_completa' intenta reservar para el 16 de enero a las 09:30 AM (23.5 horas)

**Steps**:
1. POST /api/clases/reservar para 16 de enero 09:30
2. Validar error sobre anticipación

**Expected**: 400, error: "Debes reservar con al menos 24 horas de anticipación."

---

### TC-004: Validación de Anticipación - Exactamente 24 horas

**Setup**:
- Hoy = 15 de enero a las 10:00 AM
- Usuario 'pension_completa' intenta reservar para el 16 de enero a las 10:00 AM (exactamente 24 horas)

**Steps**:
1. POST /api/clases/reservar para 16 de enero 10:00
2. Debería permitir (está en el límite)

**Expected**: 201, clase creada

---

### TC-005: Validación de Acceso Mensual - Período de Gracia (≤10)

**Setup**:
- Hoy = 8 de enero (día actual ≤ 10)
- Usuario 'pension_completa', NO tiene pago de enero en facturas
- Quiere reservar para el 15 de enero

**Steps**:
1. POST /api/clases/reservar para 15 de enero
2. Debería pasar validación de pago (período de gracia)

**Expected**: 201, clase creada (no requiere pago)

---

### TC-006: Validación de Acceso Mensual - Sin Pago Después del 10

**Setup**:
- Hoy = 12 de enero (día > 10)
- Usuario 'pension_completa', NO tiene pago de enero en facturas
- Quiere reservar para el 20 de enero

**Steps**:
1. POST /api/clases/reservar para 20 de enero
2. Validar error sobre pago pendiente

**Expected**: 400, error: "Tu pago de 1/2024 está pendiente..."

---

### TC-007: Validación de Acceso Mensual - Reserva Mes Siguiente con Pago

**Setup**:
- Hoy = 12 de enero (día > 10)
- Usuario 'pension_completa', tiene pago de enero en facturas
- Quiere reservar para el 15 de febrero

**Steps**:
1. POST /api/clases/reservar para 15 de febrero
2. Validar que se permite (mes actual pagado)

**Expected**: 201, clase creada

---

### TC-008: Caballo Compartido - Conflicto de Horario Co-propietario

**Setup**:
- Dos usuarios 'media_pension': A y B
- Caballo compartido: dueno_id=A, dueno_id2=B
- Clase existente de B: 2024-01-15, 10:00-11:00
- Usuario A quiere reservar: 2024-01-15, 10:30-11:30 (solapamiento)

**Steps**:
1. POST /api/clases/reservar para usuario A
2. Validar error sobre conflicto con co-propietario

**Expected**: 400, error: "No puedes reservar en ese horario. Tu co-propietario..."

---

### TC-009: Caballo Compartido - Sin Conflicto (Horarios Consecutivos)

**Setup**:
- Dos usuarios 'media_pension': A y B
- Caballo compartido: dueno_id=A, dueno_id2=B
- Clase existente de B: 2024-01-15, 10:00-11:00
- Usuario A quiere reservar: 2024-01-15, 11:00-12:00 (sin solapamiento)

**Steps**:
1. POST /api/clases/reservar para usuario A
2. Validar que se permite

**Expected**: 201, clase creada

---

### TC-007: Exceeding Daily Horse Limit

**Setup**:
- Caballo limite_clases_dia=2
- Ya tiene 2 clases programadas el 15 de enero
- Usuario quiere reservar para el 15 de enero

**Steps**:
1. POST /api/clases/reservar para el 15 de enero
2. Validar error sobre límite diario

**Expected**: 400, error: "El caballo ha alcanzado su límite diario de 2 clases."

---

### TC-008: Cancelación con Menos de 24h

**Setup**:
- Clase programada para mañana a las 10:00
- Hoy: 23:30 (menos de 24h)
- Usuario intenta cancelar

**Steps**:
1. POST /api/clases/cancelar/:claseId
2. Validar error

**Expected**: 400, error: "Debes cancelar con al menos 24 horas de anticipación"

---

### TC-009: Cancelación - Devolver Clase (Escuelita)

**Setup**:
- Escuelita con 5 clases/mes, 3 usadas
- Cancela una clase (no extra)
- Verifica clases_usadas

**Steps**:
1. POST /api/clases/cancelar/:claseId
2. GET /api/suscripciones/mi-suscripcion
3. Validar clases_usadas = 2

**Expected**: clases_usadas decrementado

---

### TC-010: Factura Generation - Auto-Generated on Day 1

**Setup**:
- Usuario 'pension_completa' con suscripción indefinida
- Plan precio: $1000
- Ejecutar cron on 2024-02-01

**Steps**:
1. POST /api/cron/generar-facturas
2. Verificar que se crea factura para febrero 2024

**Expected**: 
- Factura creada
- estado = 'pendiente'
- fecha_vencimiento = día 10 hábil de febrero
- monto = 1000

---

### TC-011: Comprobante Upload y Aprobación

**Setup**:
- Factura con estado='pendiente'
- Usuario sube comprobante (PDF)

**Steps**:
1. POST /api/comprobantes/subir con archivo + factura_id
2. Admin: GET /api/comprobantes/pendientes
3. Admin: POST /api/comprobantes/:id/aprobar
4. Verificar factura estado='pagado'

**Expected**:
- Comprobante estado='aprobado'
- Factura estado='pagado'
- Usuario puede hacer reservas del mes

---

### TC-012: Usuario Bloqueado No Puede Reservar

**Setup**:
- Usuario existe pero activo=false
- Intenta hacer reserva

**Steps**:
1. POST /api/clases/reservar
2. Validar error

**Expected**: 400, error: "Usuario bloqueado. Contacta al administrador."

---

### TC-013: Pension Usuario Falta Caballo

**Setup**:
- Usuario 'pension_completa' SIN caballo asignado
- Intenta hacer reserva

**Steps**:
1. POST /api/clases/reservar
2. Validar middleware rechaza

**Expected**: 403, error: 'PENDIENTE_APROBACION', tiene_caballo=false

---

### TC-014: Escuelita Supera Clases Mensuales

**Setup**:
- Plan: 4 clases/mes
- Usuario ha usado 4 clases
- Intenta reservar otra

**Steps**:
1. POST /api/clases/reservar
2. Validar error

**Expected**: 400, error: "No tienes clases disponibles en tu plan."

---

### TC-015: Reagendar - Cambiar Horario

**Setup**:
- Clase: 2024-01-15, 10:00-11:00
- Intenta cambiar a: 2024-01-15, 14:00-15:00
- Nuevo horario disponible (profesor, caballo, user)

**Steps**:
1. POST /api/clases/reagendar/:claseId con fecha/horas nuevas
2. GET /api/clases/mis-clases
3. Verificar que clase está en nuevo horario

**Expected**: 200, clase actualizada

---

### TC-016: Reagendar - Conflicto en Nuevo Horario

**Setup**:
- Clase A: 2024-01-15, 10:00-11:00, Profesor X
- Clase B: 2024-01-15, 14:00-15:00, Profesor X (ya existe)
- Usuario intenta mover Clase A a 14:00-15:00

**Steps**:
1. POST /api/clases/reagendar/:claseId con 14:00-15:00
2. Validar error

**Expected**: 400, error: "El profesor no está disponible en ese horario."

---

### TC-017: Suscripción Temporal (Escuelita) - No Posterior

**Setup**:
- Hoy: 2024-01-15
- Usuario 'escuelita' intenta comprar plan para enero (mes pasado)

**Steps**:
1. POST /api/suscripciones con fecha_inicio='2024-01-01'
2. Validar error

**Expected**: 400, error: "No puedes comprar cuponeras para meses anteriores al actual."

---

### TC-018: Suscripción Escuelita - Horarios Mismatch

**Setup**:
- Plan: 8 clases/mes (2 por semana)
- Usuario envía 3 horarios

**Steps**:
1. POST /api/suscripciones con 3 horarios
2. Validar erro

**Expected**: 400, error: "Este plan requiere 2 horario(s) fijo(s) por semana. Has proporcionado 3."

---

### TC-019: Admin - Crear Caballo Privado con Dos Owners

**Setup**:
- Usuario A: rol='media_pension'
- Usuario B: rol='media_pension'
- Admin crea caballo

**Steps**:
1. POST /admin/caballos
   - nombre='Tornado'
   - tipo='privado'
   - dueno_id=A
   - dueno_id2=B

**Expected**: 201, caballo creado con ambos propietarios

---

### TC-020: Admin - Actualizar Caballo - Empty String to NULL

**Setup**:
- Caballo con dueno_id2 = User X
- Admin intenta limpiar dueno_id2 enviando string vacío

**Steps**:
1. PATCH /admin/caballos/:id con dueno_id2=''
2. GET /admin/caballos/:id
3. Verificar dueno_id2=null

**Expected**: 
- PATCH: 200
- dueno_id2 NULL en BD (no string vacío)

---

## 11. SUMMARY TABLE - ENDPOINTS POR ROL

| Endpoint | GET | POST | PATCH | DELETE | Admin | Profesor | Pension | Media P | Escuelita |
|----------|-----|------|-------|--------|-------|----------|---------|---------|-----------|
| /clases/mis-clases | ✅ | | | | | | ✅ | ✅ | ✅ |
| /clases/reservar | | ✅ | | | | | ✅ | ✅ | ✅ |
| /clases/reagendar | | ✅ | | | | | ✅ | ✅ | ✅ |
| /clases/cancelar | | ✅ | | | | | ✅ | ✅ | ✅ |
| /suscripciones/mi-suscripcion | ✅ | | | | | | ✅ | ✅ | ✅ |
| /suscripciones/ | | ✅ | | | | | ✅ | ✅ | ✅ |
| /facturas/mis-facturas | ✅ | | | | | | ✅ | ✅ | ✅ |
| /comprobantes/subir | | ✅ | | | | | ✅ | ✅ | ✅ |
| /caballos/disponibles | ✅ | | | | | | ✅ | ✅ | ✅ |
| /admin/caballos | ✅ | ✅ | ✅ | ✅ | ✅ | | | | |
| /admin/planes | ✅ | ✅ | ✅ | ✅ | ✅ | | | | |
| /admin/profesores | ✅ | ✅ | ✅ | ✅ | ✅ | | | | |
| /admin/alumnos | ✅ | | ✅ | | ✅ | | | | |
| /admin/suscripciones | | ✅ | ✅ | ✅ | ✅ | | | | |
| /comprobantes/pendientes | ✅ | | | | | | | | |
| /comprobantes/aprobar | | ✅ | | | ✅ | | | | |

---

## 12. NOTAS PARA TEST GENERATION

1. **Payment Validation is Complex**: Implementa día 10, período de gracia, meses siguientes - múltiples combinaciones
2. **Shared Horse Conflicts**: Test todos los escenarios de superposición de horarios
3. **Role-Based Access**: Verifica que cada rol solo acceda a endpoints autorizados
4. **Date/Time Logic**: Prueba edge cases (fin de semana, horas límite)
5. **Cascade Operations**: Al cancelar clase, devuelve contador; al aprobar comprobante, actualiza factura
6. **Soft Deletes**: Verificar que DELETE marca como inactivo, no borra
7. **UUID Validation**: Especialmente en PATCH con strings vacíos
8. **Concurrent Requests**: Probra condiciones de carrera en reservas simultáneas
9. **Invalid Data Types**: Cantidad de clases negativa, porcentajes >100, etc.
10. **Middleware Chain**: validarUsuarioCompleto + authenticateToken + requireRole
