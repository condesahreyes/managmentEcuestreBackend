import express from 'express';
import { authenticateToken } from '../middleware/auth.js';
import { supabaseAdmin } from '../config/supabase.js';

const router = express.Router();

// Obtener caballos disponibles
router.get('/disponibles', authenticateToken, async (req, res) => {
  try {
    const { fecha, hora_inicio, hora_fin } = req.query;

    // Obtener todos los caballos activos
    const { data: caballos, error: caballosError } = await supabaseAdmin
      .from('caballos')
      .select('*')
      .eq('activo', true)
      .eq('estado', 'activo');

    if (caballosError) throw caballosError;

    // Si se proporciona fecha y hora, filtrar los disponibles
    if (fecha && hora_inicio && hora_fin) {
      const { data: clasesOcupadas } = await supabaseAdmin
        .from('clases')
        .select('caballo_id')
        .eq('fecha', fecha)
        .eq('estado', 'programada')
        .or(`hora_inicio.eq.${hora_inicio},and(hora_inicio.lt.${hora_fin},hora_fin.gt.${hora_inicio})`);

      const caballosOcupadosIds = new Set(clasesOcupadas?.map(c => c.caballo_id) || []);

      // Filtrar caballos disponibles
      const caballosDisponibles = caballos.filter(c => !caballosOcupadosIds.has(c.id));

      // Verificar límite diario
      const caballosConDisponibilidad = await Promise.all(
        caballosDisponibles.map(async (caballo) => {
          const { count } = await supabaseAdmin
            .from('clases')
            .select('*', { count: 'exact', head: true })
            .eq('caballo_id', caballo.id)
            .eq('fecha', fecha)
            .eq('estado', 'programada');

          return {
            ...caballo,
            clases_hoy: count || 0,
            disponible: (count || 0) < caballo.limite_clases_dia
          };
        })
      );

      return res.json(caballosConDisponibilidad.filter(c => c.disponible));
    }

    res.json(caballos);
  } catch (error) {
    console.error('Error al obtener caballos:', error);
    res.status(500).json({ error: 'Error al obtener caballos' });
  }
});

// Obtener caballo por ID
router.get('/:id', authenticateToken, async (req, res) => {
  try {
    const { data, error } = await supabaseAdmin
      .from('caballos')
      .select('*')
      .eq('id', req.params.id)
      .single();

    if (error) throw error;
    if (!data) {
      return res.status(404).json({ error: 'Caballo no encontrado' });
    }

    res.json(data);
  } catch (error) {
    console.error('Error al obtener caballo:', error);
    res.status(500).json({ error: 'Error al obtener caballo' });
  }
});

export default router;
