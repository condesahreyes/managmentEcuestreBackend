import express from 'express';
import { authenticateToken } from '../middleware/auth.js';
import { validarUsuarioCompleto } from '../middleware/validarUsuario.js';
import { ReservaService } from '../services/reservaService.js';
import { EscuelitaService } from '../services/escuelitaService.js';
import { supabaseAdmin } from '../config/supabase.js';

const router = express.Router();

// Todas las rutas requieren autenticación
router.use(authenticateToken);
// Validar que usuarios de pensión/media pensión tengan caballo y suscripción
router.use(validarUsuarioCompleto);

// Obtener clases del usuario
router.get('/mis-clases', async (req, res) => {
  try {
    const { fecha_inicio, fecha_fin } = req.query;

    let query = supabaseAdmin
      .from('clases')
      .select(`
        *,
        profesores:profesor_id(id, user_id, especialidad, users:user_id(nombre, apellido)),
        caballos:caballo_id(id, nombre, tipo, estado)
      `)
      .eq('user_id', req.user.id)
      .eq('estado', 'programada')
      .order('fecha', { ascending: true })
      .order('hora_inicio', { ascending: true });

    if (fecha_inicio) {
      query = query.gte('fecha', fecha_inicio);
    }
    if (fecha_fin) {
      query = query.lte('fecha', fecha_fin);
    }

    const { data, error } = await query;

    if (error) throw error;

    res.json(data);
  } catch (error) {
    console.error('Error al obtener clases:', error);
    res.status(500).json({ error: 'Error al obtener clases' });
  }
});

// Crear reserva
router.post('/reservar', async (req, res) => {
  try {
    const { profesor_id, caballo_id, fecha, hora_inicio, hora_fin, notas } = req.body;

    if (!profesor_id || !caballo_id || !fecha || !hora_inicio || !hora_fin) {
      return res.status(400).json({ error: 'Faltan campos requeridos' });
    }

    const resultado = await ReservaService.crearReserva(
      req.user.id,
      profesor_id,
      caballo_id,
      fecha,
      hora_inicio,
      hora_fin,
      notas
    );

    if (!resultado.exito) {
      return res.status(400).json({ error: resultado.error });
    }

    res.status(201).json({ mensaje: 'Reserva creada exitosamente', clase: resultado.clase });
  } catch (error) {
    console.error('Error al crear reserva:', error);
    res.status(500).json({ error: 'Error al crear reserva' });
  }
});

// Reagendar clase
router.post('/reagendar/:claseId', async (req, res) => {
  try {
    const { claseId } = req.params;
    const { fecha, hora_inicio, hora_fin } = req.body;

    if (!fecha || !hora_inicio || !hora_fin) {
      return res.status(400).json({ error: 'Faltan campos requeridos' });
    }

    const resultado = await ReservaService.reagendarClase(
      claseId,
      fecha,
      hora_inicio,
      hora_fin,
      req.user.id
    );

    if (!resultado.exito) {
      return res.status(400).json({ error: resultado.error });
    }

    res.json({ mensaje: 'Clase reagendada exitosamente', clase: resultado.clase });
  } catch (error) {
    console.error('Error al reagendar:', error);
    res.status(500).json({ error: 'Error al reagendar clase' });
  }
});

// Cancelar clase
router.post('/cancelar/:claseId', async (req, res) => {
  try {
    const { claseId } = req.params;

    // Verificar que la clase pertenece al usuario
    const { data: clase } = await supabaseAdmin
      .from('clases')
      .select('*')
      .eq('id', claseId)
      .eq('user_id', req.user.id)
      .single();

    if (!clase) {
      return res.status(404).json({ error: 'Clase no encontrada' });
    }

    // Validar 24 horas de anticipación
    const ahora = new Date();
    const fechaClase = new Date(`${clase.fecha}T${clase.hora_inicio}`);
    const diferenciaHoras = (fechaClase - ahora) / (1000 * 60 * 60);

    if (diferenciaHoras < 24) {
      return res.status(400).json({ error: 'Debes cancelar con al menos 24 horas de anticipación' });
    }

    // Marcar como cancelada
    const { error } = await supabaseAdmin
      .from('clases')
      .update({ estado: 'cancelada' })
      .eq('id', claseId);

    if (error) throw error;

    // Devolver clase al contador si no era extra
    if (!clase.es_extra) {
      const { data: suscripcion } = await supabaseAdmin
        .from('suscripciones')
        .select('*')
        .eq('user_id', req.user.id)
        .eq('activa', true)
        .single();

      if (suscripcion) {
        await supabaseAdmin
          .from('suscripciones')
          .update({ clases_usadas: Math.max(0, suscripcion.clases_usadas - 1) })
          .eq('id', suscripcion.id);
      }
    }

    res.json({ mensaje: 'Clase cancelada exitosamente' });
  } catch (error) {
    console.error('Error al cancelar:', error);
    res.status(500).json({ error: 'Error al cancelar clase' });
  }
});

// Generar clases mensuales (solo para escuelita)
router.post('/generar-mensuales', async (req, res) => {
  try {
    if (req.user.rol !== 'escuelita') {
      return res.status(403).json({ error: 'Solo disponible para alumnos escuelita' });
    }

    const { mes } = req.body; // Formato: YYYY-MM

    if (!mes) {
      return res.status(400).json({ error: 'Debes especificar el mes (YYYY-MM)' });
    }

    const resultado = await EscuelitaService.generarClasesMensuales(req.user.id, mes);

    if (!resultado.exito) {
      return res.status(400).json({ error: resultado.error });
    }

    res.json({
      mensaje: `Se generaron ${resultado.clasesCreadas} clases`,
      clasesCreadas: resultado.clasesCreadas,
      errores: resultado.errores
    });
  } catch (error) {
    console.error('Error al generar clases:', error);
    res.status(500).json({ error: 'Error al generar clases mensuales' });
  }
});

export default router;
