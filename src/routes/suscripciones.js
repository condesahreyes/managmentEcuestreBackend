import express from 'express';
import { authenticateToken } from '../middleware/auth.js';
import { supabaseAdmin } from '../config/supabase.js';

const router = express.Router();

// Obtener suscripción activa del usuario
router.get('/mi-suscripcion', authenticateToken, async (req, res) => {
  try {
    const { data: suscripcion, error } = await supabaseAdmin
      .from('suscripciones')
      .select(`
        *,
        planes:plan_id(*)
      `)
      .eq('user_id', req.user.id)
      .eq('activa', true)
      .single();

    if (error && error.code !== 'PGRST116') {
      throw error;
    }

    if (!suscripcion) {
      return res.json({ suscripcion: null, mensaje: 'No tienes una suscripción activa' });
    }

    // Calcular clases disponibles
    const clasesDisponibles = suscripcion.clases_incluidas - suscripcion.clases_usadas;

    res.json({
      ...suscripcion,
      clases_disponibles: clasesDisponibles
    });
  } catch (error) {
    console.error('Error al obtener suscripción:', error);
    res.status(500).json({ error: 'Error al obtener suscripción' });
  }
});

// Crear suscripción
router.post('/', authenticateToken, async (req, res) => {
  try {
    const { plan_id, fecha_inicio } = req.body;

    if (!plan_id) {
      return res.status(400).json({ error: 'Debes especificar un plan' });
    }

    // Obtener plan
    const { data: plan, error: planError } = await supabaseAdmin
      .from('planes')
      .select('*')
      .eq('id', plan_id)
      .single();

    if (planError || !plan) {
      return res.status(404).json({ error: 'Plan no encontrado' });
    }

    // Desactivar suscripciones anteriores
    await supabaseAdmin
      .from('suscripciones')
      .update({ activa: false })
      .eq('user_id', req.user.id)
      .eq('activa', true);

    // Calcular fecha fin (1 mes desde inicio)
    const inicio = fecha_inicio ? new Date(fecha_inicio) : new Date();
    const fin = new Date(inicio);
    fin.setMonth(fin.getMonth() + 1);

    // Crear nueva suscripción
    const { data: suscripcion, error } = await supabaseAdmin
      .from('suscripciones')
      .insert({
        user_id: req.user.id,
        plan_id: plan_id,
        fecha_inicio: inicio.toISOString().split('T')[0],
        fecha_fin: fin.toISOString().split('T')[0],
        clases_incluidas: plan.clases_mes,
        clases_usadas: 0,
        activa: true
      })
      .select(`
        *,
        planes:plan_id(*)
      `)
      .single();

    if (error) throw error;

    res.status(201).json(suscripcion);
  } catch (error) {
    console.error('Error al crear suscripción:', error);
    res.status(500).json({ error: 'Error al crear suscripción' });
  }
});

export default router;
