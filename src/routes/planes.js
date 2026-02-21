import express from 'express';
import { authenticateToken } from '../middleware/auth.js';
import { supabaseAdmin } from '../config/supabase.js';

const router = express.Router();

// Obtener planes disponibles
router.get('/', authenticateToken, async (req, res) => {
  try {
    const { tipo } = req.query; // Filtrar por tipo de usuario

    let query = supabaseAdmin
      .from('planes')
      .select('*')
      .eq('activo', true);

    if (tipo) {
      query = query.eq('tipo', tipo);
    }

    const { data, error } = await query.order('precio', { ascending: true });

    if (error) throw error;

    res.json(data);
  } catch (error) {
    console.error('Error al obtener planes:', error);
    res.status(500).json({ error: 'Error al obtener planes' });
  }
});

// Obtener plan por ID
router.get('/:id', authenticateToken, async (req, res) => {
  try {
    const { data, error } = await supabaseAdmin
      .from('planes')
      .select('*')
      .eq('id', req.params.id)
      .single();

    if (error) throw error;
    if (!data) {
      return res.status(404).json({ error: 'Plan no encontrado' });
    }

    res.json(data);
  } catch (error) {
    console.error('Error al obtener plan:', error);
    res.status(500).json({ error: 'Error al obtener plan' });
  }
});

export default router;
