import express from 'express';
import multer from 'multer';
import { authenticateToken, requireRole } from '../middleware/auth.js';
import { supabaseAdmin } from '../config/supabase.js';
import { FacturacionService } from '../services/facturacionService.js';

const router = express.Router();

// Configurar multer para almacenar archivos en memoria
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 10 * 1024 * 1024, // 10MB
  },
  fileFilter: (req, file, cb) => {
    const allowedTypes = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp', 'application/pdf'];
    if (allowedTypes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('Tipo de archivo no permitido. Solo se permiten imágenes (JPEG, PNG, WEBP) y PDFs.'));
    }
  },
});

// Subir comprobante de pago
router.post('/subir', authenticateToken, upload.single('archivo'), async (req, res) => {
  try {
    const { factura_id, monto } = req.body;

    if (!factura_id || !monto || !req.file) {
      return res.status(400).json({ error: 'Faltan campos requeridos' });
    }

    // Verificar que la factura pertenece al usuario
    const { data: factura, error: facturaError } = await supabaseAdmin
      .from('facturas')
      .select('*')
      .eq('id', factura_id)
      .eq('user_id', req.user.id)
      .single();

    if (facturaError || !factura) {
      return res.status(404).json({ error: 'Factura no encontrada' });
    }

    // Verificar que el monto coincida
    if (parseFloat(monto) !== parseFloat(factura.monto)) {
      return res.status(400).json({ error: 'El monto no coincide con el de la factura' });
    }

    // Verificar que no esté vencida (opcional, puedes permitir pagos vencidos)
    const hoy = new Date();
    const fechaVencimiento = new Date(factura.fecha_vencimiento);
    if (hoy > fechaVencimiento) {
      // Permitir pero marcar como vencida
    }

    // Subir archivo a Supabase Storage
    const fileExt = req.file.originalname.split('.').pop();
    const fileName = `${req.user.id}/${factura_id}/${Date.now()}.${fileExt}`;
    const filePath = `comprobantes/${fileName}`;

    const { data: uploadData, error: uploadError } = await supabaseAdmin.storage
      .from('comprobantes')
      .upload(filePath, req.file.buffer, {
        contentType: req.file.mimetype,
        upsert: false,
      });

    if (uploadError) {
      console.error('Error al subir archivo:', uploadError);
      return res.status(500).json({ error: 'Error al subir el archivo' });
    }

    // Obtener URL pública del archivo
    const { data: urlData } = supabaseAdmin.storage
      .from('comprobantes')
      .getPublicUrl(filePath);

    // Crear registro de comprobante
    const { data: comprobante, error: comprobanteError } = await supabaseAdmin
      .from('comprobantes')
      .insert({
        factura_id,
        user_id: req.user.id,
        archivo_url: urlData.publicUrl,
        nombre_archivo: req.file.originalname,
        tipo_archivo: req.file.mimetype,
        monto: parseFloat(monto),
        estado: 'pendiente',
      })
      .select()
      .single();

    if (comprobanteError) {
      // Si falla, eliminar archivo subido
      await supabaseAdmin.storage.from('comprobantes').remove([filePath]);
      throw comprobanteError;
    }

    res.status(201).json({
      mensaje: 'Comprobante subido exitosamente. Será revisado por el administrador.',
      comprobante,
    });
  } catch (error) {
    console.error('Error al subir comprobante:', error);
    res.status(500).json({ error: error.message || 'Error al subir comprobante' });
  }
});

// Obtener comprobantes del usuario
router.get('/mis-comprobantes', authenticateToken, async (req, res) => {
  try {
    const { data, error } = await supabaseAdmin
      .from('comprobantes')
      .select(`
        *,
        facturas:factura_id(
          mes,
          año,
          monto,
          fecha_vencimiento
        )
      `)
      .eq('user_id', req.user.id)
      .order('created_at', { ascending: false });

    if (error) throw error;

    res.json(data || []);
  } catch (error) {
    console.error('Error al obtener comprobantes:', error);
    res.status(500).json({ error: 'Error al obtener comprobantes' });
  }
});

// Obtener todos los comprobantes pendientes (admin)
router.get('/pendientes', requireRole('admin'), async (req, res) => {
  try {
    const { data, error } = await supabaseAdmin
      .from('comprobantes')
      .select(`
        *,
        users:user_id(id, nombre, apellido, email),
        facturas:factura_id(
          mes,
          año,
          monto,
          fecha_vencimiento
        )
      `)
      .eq('estado', 'pendiente')
      .order('fecha_subida', { ascending: true });

    if (error) throw error;

    res.json(data || []);
  } catch (error) {
    console.error('Error al obtener comprobantes pendientes:', error);
    res.status(500).json({ error: 'Error al obtener comprobantes pendientes' });
  }
});

// Aprobar comprobante (admin)
router.post('/:id/aprobar', requireRole('admin'), async (req, res) => {
  try {
    const { id } = req.params;

    // Obtener comprobante
    const { data: comprobante, error: comprobanteError } = await supabaseAdmin
      .from('comprobantes')
      .select('*, facturas:factura_id(*)')
      .eq('id', id)
      .single();

    if (comprobanteError || !comprobante) {
      return res.status(404).json({ error: 'Comprobante no encontrado' });
    }

    // Actualizar comprobante
    const { data: comprobanteActualizado, error: updateError } = await supabaseAdmin
      .from('comprobantes')
      .update({
        estado: 'aprobado',
        fecha_revision: new Date().toISOString(),
        revisado_por: req.user.id,
      })
      .eq('id', id)
      .select()
      .single();

    if (updateError) throw updateError;

    // Marcar factura como pagada
    await FacturacionService.marcarFacturaComoPagada(comprobante.factura_id);

    res.json({
      mensaje: 'Comprobante aprobado y factura marcada como pagada',
      comprobante: comprobanteActualizado,
    });
  } catch (error) {
    console.error('Error al aprobar comprobante:', error);
    res.status(500).json({ error: 'Error al aprobar comprobante' });
  }
});

// Rechazar comprobante (admin)
router.post('/:id/rechazar', requireRole('admin'), async (req, res) => {
  try {
    const { id } = req.params;
    const { observaciones } = req.body;

    const { data: comprobante, error: comprobanteError } = await supabaseAdmin
      .from('comprobantes')
      .select('*')
      .eq('id', id)
      .single();

    if (comprobanteError || !comprobante) {
      return res.status(404).json({ error: 'Comprobante no encontrado' });
    }

    const { data: comprobanteActualizado, error: updateError } = await supabaseAdmin
      .from('comprobantes')
      .update({
        estado: 'rechazado',
        fecha_revision: new Date().toISOString(),
        revisado_por: req.user.id,
        observaciones: observaciones || null,
      })
      .eq('id', id)
      .select()
      .single();

    if (updateError) throw updateError;

    res.json({
      mensaje: 'Comprobante rechazado',
      comprobante: comprobanteActualizado,
    });
  } catch (error) {
    console.error('Error al rechazar comprobante:', error);
    res.status(500).json({ error: 'Error al rechazar comprobante' });
  }
});

export default router;
