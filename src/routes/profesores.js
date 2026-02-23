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
      // Obtener el día de la semana (0 = Domingo, 6 = Sábado)
      const fechaObj = new Date(fecha);
      const diaSemana = fechaObj.getDay();

      // Obtener profesores con horarios activos para ese día
      const { data: horariosProfesores } = await supabaseAdmin
        .from('horarios_profesores')
        .select('profesor_id, hora_inicio, hora_fin')
        .eq('dia_semana', diaSemana)
        .eq('activo', true);

      // Filtrar profesores que tienen horario en ese día y el horario solicitado está dentro de su rango
      const profesoresConHorario = profesores.filter((profesor) => {
        const horariosDelProfesor = horariosProfesores?.filter((h) => h.profesor_id === profesor.id) || [];
        return horariosDelProfesor.some((horario) => {
          // Verificar que el horario solicitado esté dentro del rango del profesor
          return hora_inicio >= horario.hora_inicio && hora_fin <= horario.hora_fin;
        });
      });

      // Si no hay horarios definidos, permitir todos los profesores activos (comportamiento anterior)
      const profesoresParaValidar = horariosProfesores && horariosProfesores.length > 0 
        ? profesoresConHorario 
        : profesores;

      // Verificar que no tengan clases programadas en ese horario
      const { data: clasesOcupadas } = await supabaseAdmin
        .from('clases')
        .select('profesor_id')
        .eq('fecha', fecha)
        .eq('estado', 'programada')
        .or(`hora_inicio.eq.${hora_inicio},and(hora_inicio.lt.${hora_fin},hora_fin.gt.${hora_inicio})`);

      const profesoresOcupadosIds = new Set(clasesOcupadas?.map(c => c.profesor_id) || []);

      // Filtrar profesores disponibles (tienen horario Y no están ocupados)
      const profesoresDisponibles = profesoresParaValidar.filter(
        p => !profesoresOcupadosIds.has(p.id)
      );

      return res.json(profesoresDisponibles);
    }

    res.json(profesores);
  } catch (error) {
    console.error('Error al obtener profesores:', error);
    res.status(500).json({ error: 'Error al obtener profesores' });
  }
});

// Obtener horarios de disponibilidad de un profesor
router.get('/:id/horarios', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    
    const { data: horarios, error } = await supabaseAdmin
      .from('horarios_profesores')
      .select('*')
      .eq('profesor_id', id)
      .eq('activo', true)
      .order('dia_semana', { ascending: true })
      .order('hora_inicio', { ascending: true });

    if (error) throw error;

    res.json(horarios || []);
  } catch (error) {
    console.error('Error al obtener horarios del profesor:', error);
    res.status(500).json({ error: 'Error al obtener horarios del profesor' });
  }
});

export default router;
