import express from 'express';
import { FacturacionService } from '../services/facturacionService.js';
import { ClasesService } from '../services/clasesService.js';

const router = express.Router();

/**
 * Endpoint para generar facturas mensuales
 * Se puede llamar manualmente o configurar un cron job que lo ejecute el día 1 de cada mes a las 00:00
 * 
 * Ejemplo de cron job (usando node-cron o similar):
 * 0 0 1 * * curl -X POST http://localhost:3001/api/cron/generar-facturas
 */
router.post('/generar-facturas', async (req, res) => {
  try {
    const resultado = await FacturacionService.generarFacturasMensuales();
    res.json({
      mensaje: `Proceso completado. Se generaron ${resultado.facturasCreadas} facturas de ${resultado.totalSuscripciones} suscripciones indefinidas`,
      facturasCreadas: resultado.facturasCreadas,
      totalSuscripciones: resultado.totalSuscripciones,
      errores: resultado.errores,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error('Error al generar facturas:', error);
    res.status(500).json({ error: 'Error al generar facturas', details: error.message });
  }
});

/**
 * Endpoint para actualizar clases usadas
 * Se puede llamar manualmente o configurar un cron job que lo ejecute diariamente
 * 
 * Ejemplo de cron job (usando node-cron o similar):
 * 0 1 * * * curl -X POST http://localhost:3001/api/cron/actualizar-clases-usadas
 */
router.post('/actualizar-clases-usadas', async (req, res) => {
  try {
    const resultado = await ClasesService.actualizarClasesUsadas();
    res.json({
      mensaje: `Proceso completado. Se actualizaron ${resultado.actualizaciones} suscripciones`,
      actualizaciones: resultado.actualizaciones,
      detalles: resultado.detalles,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error('Error al actualizar clases usadas:', error);
    res.status(500).json({ error: 'Error al actualizar clases usadas', details: error.message });
  }
});

export default router;
