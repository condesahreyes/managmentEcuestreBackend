import express from 'express';
import { authenticateToken, requireRole } from '../middleware/auth.js';
import { supabaseAdmin } from '../config/supabase.js';

const router = express.Router();

// Todas las rutas requieren autenticación y rol admin
router.use(authenticateToken);
router.use(requireRole('admin', 'profesor'));

// Obtener agenda general
router.get('/agenda', async (req, res) => {
  try {
    const { fecha_inicio, fecha_fin, profesor_id, caballo_id } = req.query;

    let query = supabaseAdmin
      .from('clases')
      .select(`
        *,
        users:user_id(id, nombre, apellido, email, rol),
        profesores:profesor_id(id, users:user_id(nombre, apellido)),
        caballos:caballo_id(id, nombre, tipo, estado)
      `)
      .in('estado', ['programada', 'completada'])
      .order('fecha', { ascending: true })
      .order('hora_inicio', { ascending: true });

    if (fecha_inicio) {
      query = query.gte('fecha', fecha_inicio);
    }
    if (fecha_fin) {
      query = query.lte('fecha', fecha_fin);
    }
    if (profesor_id) {
      query = query.eq('profesor_id', profesor_id);
    }
    if (caballo_id) {
      query = query.eq('caballo_id', caballo_id);
    }

    const { data, error } = await query;

    if (error) throw error;

    res.json(data);
  } catch (error) {
    console.error('Error al obtener agenda:', error);
    res.status(500).json({ error: 'Error al obtener agenda' });
  }
});

// Obtener ocupación por caballo
router.get('/ocupacion/caballos', async (req, res) => {
  try {
    const { fecha_inicio, fecha_fin } = req.query;

    const { data: caballos } = await supabaseAdmin
      .from('caballos')
      .select('id, nombre, limite_clases_dia')
      .eq('activo', true);

    const ocupacion = await Promise.all(
      caballos.map(async (caballo) => {
        let query = supabaseAdmin
          .from('clases')
          .select('*', { count: 'exact', head: false })
          .eq('caballo_id', caballo.id)
          .eq('estado', 'programada');

        if (fecha_inicio) {
          query = query.gte('fecha', fecha_inicio);
        }
        if (fecha_fin) {
          query = query.lte('fecha', fecha_fin);
        }

        const { count } = await query;

        return {
          caballo_id: caballo.id,
          nombre: caballo.nombre,
          clases_programadas: count || 0,
          limite_diario: caballo.limite_clases_dia,
          porcentaje_uso: ((count || 0) / (caballo.limite_clases_dia * 30)) * 100 // Aproximado para un mes
        };
      })
    );

    res.json(ocupacion);
  } catch (error) {
    console.error('Error al obtener ocupación:', error);
    res.status(500).json({ error: 'Error al obtener ocupación' });
  }
});

// Obtener ocupación por profesor
router.get('/ocupacion/profesores', async (req, res) => {
  try {
    const { fecha_inicio, fecha_fin } = req.query;

    const { data: profesores } = await supabaseAdmin
      .from('profesores')
      .select(`
        id,
        users:user_id(nombre, apellido)
      `)
      .eq('activo', true);

    const ocupacion = await Promise.all(
      profesores.map(async (profesor) => {
        let query = supabaseAdmin
          .from('clases')
          .select('*', { count: 'exact', head: false })
          .eq('profesor_id', profesor.id)
          .eq('estado', 'programada');

        if (fecha_inicio) {
          query = query.gte('fecha', fecha_inicio);
        }
        if (fecha_fin) {
          query = query.lte('fecha', fecha_fin);
        }

        const { count } = await query;

        return {
          profesor_id: profesor.id,
          nombre: `${profesor.users?.nombre || ''} ${profesor.users?.apellido || ''}`.trim(),
          clases_programadas: count || 0
        };
      })
    );

    res.json(ocupacion);
  } catch (error) {
    console.error('Error al obtener ocupación:', error);
    res.status(500).json({ error: 'Error al obtener ocupación' });
  }
});

// Obtener alumnos activos
router.get('/alumnos', async (req, res) => {
  try {
    const { activo, rol } = req.query;

    let query = supabaseAdmin
      .from('users')
      .select(`
        *,
        suscripciones!inner(*, planes:plan_id(*))
      `)
      .in('rol', ['escuelita', 'pension_completa', 'media_pension']);

    if (activo !== undefined) {
      query = query.eq('activo', activo === 'true');
    }
    if (rol) {
      query = query.eq('rol', rol);
    }

    const { data, error } = await query;

    if (error) throw error;

    res.json(data);
  } catch (error) {
    console.error('Error al obtener alumnos:', error);
    res.status(500).json({ error: 'Error al obtener alumnos' });
  }
});

// Bloquear/desbloquear alumno
router.patch('/alumnos/:id/bloquear', requireRole('admin'), async (req, res) => {
  try {
    const { id } = req.params;
    const { activo } = req.body;

    const { data, error } = await supabaseAdmin
      .from('users')
      .update({ activo: activo !== false })
      .eq('id', id)
      .select()
      .single();

    if (error) throw error;

    res.json({ mensaje: `Alumno ${activo !== false ? 'activado' : 'bloqueado'}`, usuario: data });
  } catch (error) {
    console.error('Error al bloquear alumno:', error);
    res.status(500).json({ error: 'Error al bloquear alumno' });
  }
});

// Cambiar estado de caballo
router.patch('/caballos/:id/estado', requireRole('admin'), async (req, res) => {
  try {
    const { id } = req.params;
    const { estado } = req.body;

    if (!['activo', 'descanso', 'lesionado'].includes(estado)) {
      return res.status(400).json({ error: 'Estado inválido' });
    }

    const { data, error } = await supabaseAdmin
      .from('caballos')
      .update({ estado })
      .eq('id', id)
      .select()
      .single();

    if (error) throw error;

    res.json({ mensaje: 'Estado actualizado', caballo: data });
  } catch (error) {
    console.error('Error al cambiar estado:', error);
    res.status(500).json({ error: 'Error al cambiar estado' });
  }
});

// CRUD de planes (solo admin)
router.get('/planes', requireRole('admin'), async (req, res) => {
  try {
    const { data, error } = await supabaseAdmin
      .from('planes')
      .select('*')
      .order('tipo', { ascending: true })
      .order('precio', { ascending: true });

    if (error) throw error;

    res.json(data);
  } catch (error) {
    console.error('Error al obtener planes:', error);
    res.status(500).json({ error: 'Error al obtener planes' });
  }
});

router.post('/planes', requireRole('admin'), async (req, res) => {
  try {
    const { nombre, tipo, clases_mes, precio } = req.body;

    if (!nombre || !tipo || !clases_mes || !precio) {
      return res.status(400).json({ error: 'Faltan campos requeridos' });
    }

    const { data, error } = await supabaseAdmin
      .from('planes')
      .insert({ nombre, tipo, clases_mes, precio, activo: true })
      .select()
      .single();

    if (error) throw error;

    res.status(201).json(data);
  } catch (error) {
    console.error('Error al crear plan:', error);
    res.status(500).json({ error: 'Error al crear plan' });
  }
});

router.patch('/planes/:id', requireRole('admin'), async (req, res) => {
  try {
    const { id } = req.params;
    const updates = req.body;

    const { data, error } = await supabaseAdmin
      .from('planes')
      .update(updates)
      .eq('id', id)
      .select()
      .single();

    if (error) throw error;

    res.json(data);
  } catch (error) {
    console.error('Error al actualizar plan:', error);
    res.status(500).json({ error: 'Error al actualizar plan' });
  }
});

export default router;
