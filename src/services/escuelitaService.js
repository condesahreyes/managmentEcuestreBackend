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
    // Obtener horario fijo del usuario
    const { data: horarioFijo } = await supabaseAdmin
      .from('horarios_fijos')
      .select('*, profesores(*)')
      .eq('user_id', userId)
      .eq('activo', true)
      .single();

    if (!horarioFijo) {
      return { exito: false, error: 'No tienes un horario fijo configurado' };
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

    // Calcular cuántas clases debe tener (1 o 2 por semana)
    const clasesPorSemana = suscripcion.clases_incluidas / 4; // Asumiendo 4 semanas
    const diaSemana = horarioFijo.dia_semana;

    // Obtener todas las fechas del mes que corresponden al día de la semana
    const [año, mesNum] = mes.split('-').map(Number);
    const fechas = this.obtenerFechasDelMes(año, mesNum, diaSemana);

    // Limitar a las clases del plan
    const fechasLimitadas = fechas.slice(0, suscripcion.clases_incluidas);

    // Obtener un caballo disponible (tipo escuela)
    const { data: caballos } = await supabaseAdmin
      .from('caballos')
      .select('id')
      .eq('tipo', 'escuela')
      .eq('estado', 'activo')
      .eq('activo', true)
      .limit(1);

    if (!caballos || caballos.length === 0) {
      return { exito: false, error: 'No hay caballos de escuela disponibles' };
    }

    const caballoId = caballos[0].id;

    // Calcular hora fin (asumiendo 1 hora de duración)
    const [hora, minuto] = horarioFijo.hora.split(':');
    const horaFin = `${String(parseInt(hora) + 1).padStart(2, '0')}:${minuto}`;

    // Crear clases
    const clasesCreadas = [];
    const errores = [];

    for (const fecha of fechasLimitadas) {
      // Validar disponibilidad antes de crear
      const { data: conflicto } = await supabaseAdmin
        .from('clases')
        .select('id')
        .eq('profesor_id', horarioFijo.profesor_id)
        .eq('fecha', fecha)
        .eq('hora_inicio', horarioFijo.hora)
        .eq('estado', 'programada');

      if (conflicto && conflicto.length > 0) {
        errores.push(`Conflicto en ${fecha}`);
        continue;
      }

      const { data: clase, error } = await supabaseAdmin
        .from('clases')
        .insert({
          user_id: userId,
          profesor_id: horarioFijo.profesor_id,
          caballo_id: caballoId,
          fecha,
          hora_inicio: horarioFijo.hora,
          hora_fin: horaFin,
          estado: 'programada'
        })
        .select()
        .single();

      if (error) {
        errores.push(`Error al crear clase para ${fecha}: ${error.message}`);
      } else {
        clasesCreadas.push(clase);
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
