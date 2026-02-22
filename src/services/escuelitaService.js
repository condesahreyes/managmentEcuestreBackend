import { supabaseAdmin } from '../config/supabase.js';

/**
 * Servicio para generar automáticamente las clases mensuales de alumnos escuelita
 */
export class EscuelitaService {
  /**
   * Genera las clases del mes para un alumno escuelita
   * @param {string} userId - ID del usuario
   * @param {string} mes - Mes en formato YYYY-MM
   */
  static async generarClasesMensuales(userId, mes) {
    // Obtener todos los horarios fijos activos del usuario
    const { data: horariosFijos, error: horariosError } = await supabaseAdmin
      .from('horarios_fijos')
      .select('*')
      .eq('user_id', userId)
      .eq('activo', true)
      .order('dia_semana', { ascending: true })
      .order('hora', { ascending: true });

    if (horariosError || !horariosFijos || horariosFijos.length === 0) {
      return { exito: false, error: 'No tienes horarios fijos configurados' };
    }

    // Obtener suscripción activa
    const { data: suscripcion } = await supabaseAdmin
      .from('suscripciones')
      .select('*')
      .eq('user_id', userId)
      .eq('activa', true)
      .single();

    if (!suscripcion) {
      return { exito: false, error: 'No tienes una suscripción activa' };
    }

    // Calcular cuántas clases por semana
    const clasesPorSemana = suscripcion.clases_incluidas / 4; // Asumiendo 4 semanas

    if (horariosFijos.length !== clasesPorSemana) {
      return { 
        exito: false, 
        error: `Debes tener ${clasesPorSemana} horario(s) fijo(s) configurado(s) para este plan` 
      };
    }

    const [año, mesNum] = mes.split('-').map(Number);
    const clasesCreadas = [];
    const errores = [];

    // Generar clases para cada horario fijo
    for (const horarioFijo of horariosFijos) {
      if (!horarioFijo.caballo_id) {
        errores.push(`No hay caballo asignado en el horario del ${this.getNombreDia(horarioFijo.dia_semana)}`);
        continue;
      }

      // Obtener todas las fechas del mes que corresponden al día de la semana
      const fechas = this.obtenerFechasDelMes(año, mesNum, horarioFijo.dia_semana);

      // Calcular hora fin (asumiendo 1 hora de duración)
      const [hora, minuto] = horarioFijo.hora.split(':');
      const horaFin = `${String(parseInt(hora) + 1).padStart(2, '0')}:${minuto}`;

      // Crear clases para este horario
      for (const fecha of fechas) {
        // Validar disponibilidad antes de crear
        const { data: conflicto } = await supabaseAdmin
          .from('clases')
          .select('id')
          .eq('profesor_id', horarioFijo.profesor_id)
          .eq('fecha', fecha)
          .eq('hora_inicio', horarioFijo.hora)
          .eq('estado', 'programada');

        if (conflicto && conflicto.length > 0) {
          errores.push(`Conflicto en ${fecha} ${horarioFijo.hora}`);
          continue;
        }

        // Validar conflicto con caballo
        const { data: conflictoCaballo } = await supabaseAdmin
          .from('clases')
          .select('id')
          .eq('caballo_id', horarioFijo.caballo_id)
          .eq('fecha', fecha)
          .eq('hora_inicio', horarioFijo.hora)
          .eq('estado', 'programada');

        if (conflictoCaballo && conflictoCaballo.length > 0) {
          errores.push(`Conflicto de caballo en ${fecha} ${horarioFijo.hora}`);
          continue;
        }

        const { data: clase, error } = await supabaseAdmin
          .from('clases')
          .insert({
            user_id: userId,
            profesor_id: horarioFijo.profesor_id,
            caballo_id: horarioFijo.caballo_id,
            fecha,
            hora_inicio: horarioFijo.hora,
            hora_fin: horaFin,
            estado: 'programada'
          })
          .select()
          .single();

        if (error) {
          errores.push(`Error al crear clase para ${fecha} ${horarioFijo.hora}: ${error.message}`);
        } else {
          clasesCreadas.push(clase);
        }
      }
    }

    // Actualizar contador de clases usadas
    if (clasesCreadas.length > 0) {
      await supabaseAdmin
        .from('suscripciones')
        .update({ clases_usadas: suscripcion.clases_usadas + clasesCreadas.length })
        .eq('id', suscripcion.id);
    }

    return {
      exito: clasesCreadas.length > 0,
      clasesCreadas: clasesCreadas.length,
      errores
    };
  }

  /**
   * Obtiene el nombre del día de la semana
   */
  static getNombreDia(diaSemana) {
    const dias = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'];
    return dias[diaSemana] || 'Día';
  }

  /**
   * Obtiene todas las fechas de un mes que corresponden a un día de la semana
   */
  static obtenerFechasDelMes(año, mes, diaSemana) {
    const fechas = [];
    const primerDia = new Date(año, mes - 1, 1);
    const ultimoDia = new Date(año, mes, 0);

    // Encontrar el primer día de la semana en el mes
    let fecha = new Date(primerDia);
    while (fecha.getDay() !== diaSemana) {
      fecha.setDate(fecha.getDate() + 1);
    }

    // Agregar todas las fechas de ese día de la semana en el mes
    while (fecha <= ultimoDia) {
      fechas.push(fecha.toISOString().split('T')[0]);
      fecha.setDate(fecha.getDate() + 7);
    }

    return fechas;
  }
}
