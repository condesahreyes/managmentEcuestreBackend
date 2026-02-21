import express from 'express';
import { authenticateToken } from '../middleware/auth.js';
import { supabaseAdmin } from '../config/supabase.js';

const router = express.Router();

// Obtener profesores disponibles
router.get('/disponibles', authenticateToken, async (req, res) => {
  try {
    const { fecha, hora_inicio, hora_fin } = req.query;

    // Obtener todos los profesores activos
    const { data: profesores, error: profesoresError } = await supabaseAdmin
      .from('profesores')
      .select(`
        *,
        users:user_id(id, nombre, apellido, email, telefono)
      `)
      .eq('activo', true);

    if (profesoresError) throw profesoresError;

    // Si se proporciona fecha y hora, filtrar los disponibles
    if (fecha && hora_inicio && hora_fin) {
      const { data: clasesOcupadas } = await supabaseAdmin
        .from('clases')
        .select('profesor_id')
        .eq('fecha', fecha)
        .eq('estado', 'programada')
        .or(`hora_inicio.eq.${hora_inicio},and(hora_inicio.lt.${hora_fin},hora_fin.gt.${hora_inicio})`);

      const profesoresOcupadosIds = new Set(clasesOcupadas?.map(c => c.profesor_id) || []);

      // Filtrar profesores disponibles
      const profesoresDisponibles = profesores.filter(p => !profesoresOcupadosIds.has(p.id));

      return res.json(profesoresDisponibles);
    }

    res.json(profesores);
  } catch (error) {
    console.error('Error al obtener profesores:', error);
    res.status(500).json({ error: 'Error al obtener profesores' });
  }
});

export default router;
