import express from 'express';
import { authenticateToken } from '../middleware/auth.js';
import { PagosProfesoresService } from '../services/pagosProfesoresService.js';

const router = express.Router();

// Todas las rutas requieren autenticación
router.use(authenticateToken);

router.get('', async (req, res) => {
  try {
    const {mes, año} = req.query;
    const facturas = await PagosProfesoresService.calcularPagosMensuales(mes, año);
    res.json(facturas);
  } catch (error) {
    console.error('Error al obtener pagos profesores:', error);
    res.status(500).json({ error: 'Error al obtener pagos profesores' });
  }
});


export default router;
