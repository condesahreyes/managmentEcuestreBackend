import express from 'express';
import { authenticateToken } from '../middleware/auth.js';
import { supabaseAdmin } from '../config/supabase.js';

const router = express.Router();

// Obtener horario fijo del usuario (solo escuelita)
router.get('/mi-horario', authenticateToken, async (req, res) => {
  try {
    if (req.user.rol !== 'escuelita') {
      return res.status(403).json({ error: 'Solo disponible para alumnos escuelita' });
    }

    const { data, error } = await supabaseAdmin
      .from('horarios_fijos')
      .select(`
        *,
        profesores:profesor_id(id, users:user_id(nombre, apellido))
      `)
      .eq('user_id', req.user.id)
      .eq('activo', true)
      .single();

    if (error && error.code !== 'PGRST116') {
      throw error;
    }

    res.json(data || null);
  } catch (error) {
    console.error('Error al obtener horario:', error);
    res.status(500).json({ error: 'Error al obtener horario' });
  }
});

// Crear o actualizar horario fijo
router.post('/', authenticateToken, async (req, res) => {
  try {
    if (req.user.rol !== 'escuelita') {
      return res.status(403).json({ error: 'Solo disponible para alumnos escuelita' });
    }

    const { profesor_id, dia_semana, hora } = req.body;

    if (!profesor_id || dia_semana === undefined || !hora) {
      return res.status(400).json({ error: 'Faltan campos requeridos' });
    }

    // Desactivar horarios anteriores
    await supabaseAdmin
      .from('horarios_fijos')
      .update({ activo: false })
      .eq('user_id', req.user.id)
      .eq('activo', true);

    // Crear nuevo horario
    const { data, error } = await supabaseAdmin
      .from('horarios_fijos')
      .insert({
        user_id: req.user.id,
        profesor_id,
        dia_semana,
        hora,
        activo: true
      })
      .select(`
        *,
        profesores:profesor_id(id, users:user_id(nombre, apellido))
      `)
      .single();

    if (error) throw error;

    res.status(201).json(data);
  } catch (error) {
    console.error('Error al crear horario:', error);
    res.status(500).json({ error: 'Error al crear horario' });
  }
});

export default router;
