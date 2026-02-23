import express from 'express';
import { authenticateToken, requireRole } from '../middleware/auth.js';
import { supabaseAdmin } from '../config/supabase.js';
import { FacturacionService } from '../services/facturacionService.js';

const router = express.Router();

// Obtener facturas pendientes del usuario
router.get('/mis-facturas', authenticateToken, async (req, res) => {
  try {
    const facturas = await FacturacionService.obtenerFacturasPendientes(req.user.id);
    res.json(facturas);
  } catch (error) {
    console.error('Error al obtener facturas:', error);
    res.status(500).json({ error: 'Error al obtener facturas' });
  }
});

// Alias para obtener facturas pendientes
router.get('/pendientes', authenticateToken, async (req, res) => {
  try {
    const facturas = await FacturacionService.obtenerFacturasPendientes(req.user.id);
    res.json(facturas);
  } catch (error) {
    console.error('Error al obtener facturas pendientes:', error);
    res.status(500).json({ error: 'Error al obtener facturas pendientes' });
  }
});

// Obtener historial de facturas del usuario (últimos 3 meses)
router.get('/historial', authenticateToken, async (req, res) => {
  try {
    const { meses } = req.query;
    const mesesNum = meses ? parseInt(meses) : 3;
    const facturas = await FacturacionService.obtenerFacturasHistorial(req.user.id, mesesNum);
    res.json(facturas);
  } catch (error) {
    console.error('Error al obtener historial de facturas:', error);
    res.status(500).json({ error: 'Error al obtener historial de facturas' });
  }
});

// Generar facturas mensuales (solo admin, se puede ejecutar manualmente o por cron)
router.post('/generar-mensuales', authenticateToken, requireRole('admin'), async (req, res) => {
  try {
    const resultado = await FacturacionService.generarFacturasMensuales();
    res.json({
      mensaje: `Se generaron ${resultado.facturasCreadas} facturas`,
      facturasCreadas: resultado.facturasCreadas,
      errores: resultado.errores,
    });
  } catch (error) {
    console.error('Error al generar facturas:', error);
    res.status(500).json({ error: 'Error al generar facturas' });
  }
});

// Obtener todas las facturas (admin)
router.get('/', authenticateToken, requireRole('admin'), async (req, res) => {
  try {
    const { estado, mes, año } = req.query;

    let query = supabaseAdmin
      .from('facturas')
      .select(`
        *,
        users:user_id(id, nombre, apellido, email),
        suscripciones:suscripcion_id(
          planes:plan_id(nombre, precio)
        )
      `)
      .order('año', { ascending: false })
      .order('mes', { ascending: false });

    if (estado) {
      query = query.eq('estado', estado);
    }
    if (mes) {
      query = query.eq('mes', parseInt(mes));
    }
    if (año) {
      query = query.eq('año', parseInt(año));
    }

    const { data, error } = await query;

    if (error) throw error;

    res.json(data || []);
  } catch (error) {
    console.error('Error al obtener facturas:', error);
    res.status(500).json({ error: 'Error al obtener facturas' });
  }
});

export default router;
