# Sistema de Facturación y Comprobantes

## Configuración Inicial

### 1. Base de Datos

Ejecuta el script de migración para crear las tablas necesarias:

```sql
-- Ejecutar en Supabase SQL Editor
\i backend/src/database/schema-facturacion.sql
```

Esto creará las tablas:
- `facturas`: Facturas mensuales generadas automáticamente
- `comprobantes`: Comprobantes de pago subidos por los usuarios

### 2. Supabase Storage

Necesitas crear un bucket en Supabase Storage para almacenar los comprobantes:

1. Ve a Supabase Dashboard > Storage
2. Crea un nuevo bucket llamado `comprobantes`
3. Configura las políticas de acceso:
   - **Política de lectura pública** (para que los admins puedan ver los comprobantes):
     ```sql
     CREATE POLICY "Public Access" ON storage.objects FOR SELECT USING (bucket_id = 'comprobantes');
     ```
   - **Política de escritura para usuarios autenticados**:
     ```sql
     CREATE POLICY "Users can upload" ON storage.objects FOR INSERT 
     WITH CHECK (bucket_id = 'comprobantes' AND auth.role() = 'authenticated');
     ```

### 3. Generación Automática de Facturas

Las facturas se generan automáticamente el día 1 de cada mes. Tienes dos opciones:

#### Opción A: Cron Job Manual (Recomendado para producción)

Usa un servicio de cron como:
- **Vercel Cron Jobs** (si usas Vercel)
- **GitHub Actions** con schedule
- **cron-job.org** (servicio externo)
- **Supabase Edge Functions** con cron

Ejemplo con Vercel Cron:
```json
// vercel.json
{
  "crons": [{
    "path": "/api/cron/generar-facturas",
    "schedule": "0 0 1 * *"
  }]
}
```

#### Opción B: Ejecutar Manualmente

Puedes ejecutar manualmente desde el panel admin o haciendo una petición POST:

```bash
curl -X POST http://localhost:3001/api/cron/generar-facturas
```

O desde el código del admin, agregar un botón que llame a este endpoint.

## Flujo de Trabajo

### Para Alumnos de Escuelita

1. **Comprar Suscripción**: El alumno va a `/comprar-suscripcion` y selecciona un plan
2. **Se genera la factura**: Automáticamente el día 1 del mes siguiente
3. **Subir comprobante**: Antes del día 10 hábil, el alumno sube su comprobante en `/comprobantes`
4. **Revisión**: El admin revisa y aprueba/rechaza el comprobante

### Para Alumnos de Pensión/Media Pensión

1. **Suscripción activa**: El sistema genera facturas automáticamente cada mes
2. **Subir comprobante**: El alumno sube su comprobante en `/comprobantes`
3. **Revisión**: El admin revisa y aprueba/rechaza

## Endpoints

### Facturas
- `GET /api/facturas/mis-facturas` - Obtener facturas del usuario
- `GET /api/facturas` - Obtener todas las facturas (admin)
- `POST /api/facturas/generar-mensuales` - Generar facturas manualmente (admin)

### Comprobantes
- `POST /api/comprobantes/subir` - Subir comprobante (usuario)
- `GET /api/comprobantes/mis-comprobantes` - Obtener comprobantes del usuario
- `GET /api/comprobantes/pendientes` - Obtener comprobantes pendientes (admin)
- `POST /api/comprobantes/:id/aprobar` - Aprobar comprobante (admin)
- `POST /api/comprobantes/:id/rechazar` - Rechazar comprobante (admin)

### Cron
- `POST /api/cron/generar-facturas` - Generar facturas mensuales (público, para cron jobs)

## Notas Importantes

1. **Día 10 Hábil**: El sistema calcula automáticamente el día 10 hábil de cada mes (excluyendo fines de semana)
2. **Validación de Monto**: El sistema valida que el monto del comprobante coincida con el de la factura
3. **Estados de Comprobante**: `pendiente`, `aprobado`, `rechazado`
4. **Tipos de Archivo Permitidos**: JPEG, PNG, WEBP, PDF (máximo 10MB)
