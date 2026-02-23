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
    console.log(`[EscuelitaService] Generando clases para usuario ${userId}, mes ${mes}`);
    
    // Obtener todos los horarios fijos activos del usuario
    const { data: horariosFijos, error: horariosError } = await supabaseAdmin
      .from('horarios_fijos')
      .select('*')
      .eq('user_id', userId)
      .eq('activo', true)
      .order('dia_semana', { ascending: true })
      .order('hora', { ascending: true });

    if (horariosError) {
      console.error('[EscuelitaService] Error al obtener horarios fijos:', horariosError);
      return { exito: false, error: 'Error al obtener horarios fijos', clasesCreadas: 0, errores: [horariosError.message] };
    }

    if (!horariosFijos || horariosFijos.length === 0) {
      console.log('[EscuelitaService] No se encontraron horarios fijos');
      return { exito: false, error: 'No tienes horarios fijos configurados', clasesCreadas: 0, errores: [] };
    }

    console.log(`[EscuelitaService] Encontrados ${horariosFijos.length} horario(s) fijo(s)`);

    const fechaInicioMes = `${mes}-01`;
    // Obtener suscripción activa
    const { data: suscripcion, error: suscripcionError } = await supabaseAdmin
      .from('suscripciones')
      .select('*')
      .eq('user_id', userId)
      .eq('activa', true)
      .eq('fecha_inicio', fechaInicioMes)
      .maybeSingle();
      
    if (suscripcionError) {
      console.error('[EscuelitaService] Error al obtener suscripción:', suscripcionError);
      return { exito: false, error: 'Error al obtener suscripción activa', clasesCreadas: 0, errores: [suscripcionError.message] };
    }

    if (!suscripcion) {
      console.log('[EscuelitaService] No se encontró suscripción activa');
      return { exito: false, error: 'No tienes una suscripción activa', clasesCreadas: 0, errores: [] };
    }

    console.log(`[EscuelitaService] Suscripción encontrada: ${suscripcion.id}, clases incluidas: ${suscripcion.clases_incluidas}`);

    // Calcular cuántas clases por semana
    const clasesPorSemana = suscripcion.clases_incluidas / 4; // Asumiendo 4 semanas

    if (horariosFijos.length !== clasesPorSemana) {
      return { 
        exito: false, 
        error: `Debes tener ${clasesPorSemana} horario(s) fijo(s) configurado(s) para este plan`,
        clasesCreadas: 0,
        errores: []
      };
    }

    const [año, mesNum] = mes.split('-').map(Number);
    console.log(`[EscuelitaService] Procesando mes: año ${año}, mes ${mesNum}`);
    
    const clasesCreadas = [];
    const errores = [];

    // Generar clases para cada horario fijo
    for (const horarioFijo of horariosFijos) {
      console.log(`[EscuelitaService] Procesando horario: día ${horarioFijo.dia_semana} (${this.getNombreDia(horarioFijo.dia_semana)}), hora ${horarioFijo.hora}, caballo: ${horarioFijo.caballo_id}`);
      
      if (!horarioFijo.caballo_id) {
        const errorMsg = `No hay caballo asignado en el horario del ${this.getNombreDia(horarioFijo.dia_semana)}`;
        console.warn(`[EscuelitaService] ${errorMsg}`);
        errores.push(errorMsg);
        continue;
      }

      // Obtener todas las fechas del mes que corresponden al día de la semana
      const fechas = this.obtenerFechasDelMes(año, mesNum, horarioFijo.dia_semana);
      console.log(`[EscuelitaService] Fechas encontradas para ${this.getNombreDia(horarioFijo.dia_semana)}: ${fechas.length} fechas`, fechas);

      // Normalizar hora (puede venir con segundos "09:00:00" o sin "09:00")
      const horaInicio = horarioFijo.hora.includes(':') 
        ? horarioFijo.hora.substring(0, 5) // Tomar solo HH:MM
        : horarioFijo.hora;
      
      // Calcular hora fin (asumiendo 1 hora de duración)
      const [hora, minuto] = horaInicio.split(':');
      const horaFin = `${String(parseInt(hora) + 1).padStart(2, '0')}:${minuto}`;
      
      console.log(`[EscuelitaService] Hora inicio: ${horaInicio}, Hora fin: ${horaFin}`);

      // Crear clases para este horario
      for (const fecha of fechas) {
        console.log(`[EscuelitaService] Intentando crear clase para ${fecha} ${horarioFijo.hora}`);
        
        // Validar disponibilidad antes de crear
        const { data: conflicto, error: errorConflicto } = await supabaseAdmin
          .from('clases')
          .select('id')
          .eq('profesor_id', horarioFijo.profesor_id)
          .eq('fecha', fecha)
          .eq('hora_inicio', horaInicio)
          .eq('estado', 'programada');

        if (errorConflicto) {
          console.error(`[EscuelitaService] Error al verificar conflicto de profesor:`, errorConflicto);
        }

        if (conflicto && conflicto.length > 0) {
          const errorMsg = `Conflicto en ${fecha} ${horarioFijo.hora}`;
          console.warn(`[EscuelitaService] ${errorMsg}`);
          errores.push(errorMsg);
          continue;
        }

        // Validar conflicto con caballo
        const { data: conflictoCaballo, error: errorConflictoCaballo } = await supabaseAdmin
          .from('clases')
          .select('id')
          .eq('caballo_id', horarioFijo.caballo_id)
          .eq('fecha', fecha)
          .eq('hora_inicio', horaInicio)
          .eq('estado', 'programada');

        if (errorConflictoCaballo) {
          console.error(`[EscuelitaService] Error al verificar conflicto de caballo:`, errorConflictoCaballo);
        }

        if (conflictoCaballo && conflictoCaballo.length > 0) {
          const errorMsg = `Conflicto de caballo en ${fecha} ${horarioFijo.hora}`;
          console.warn(`[EscuelitaService] ${errorMsg}`);
          errores.push(errorMsg);
          continue;
        }

        const { data: clase, error } = await supabaseAdmin
          .from('clases')
          .insert({
            user_id: userId,
            profesor_id: horarioFijo.profesor_id,
            caballo_id: horarioFijo.caballo_id,
            fecha,
            hora_inicio: horaInicio,
            hora_fin: horaFin,
            estado: 'programada'
          })
          .select()
          .single();

        if (error) {
          const errorMsg = `Error al crear clase para ${fecha} ${horarioFijo.hora}: ${error.message}`;
          console.error(`[EscuelitaService] ${errorMsg}`, error);
          errores.push(errorMsg);
        } else {
          console.log(`[EscuelitaService] Clase creada exitosamente: ${clase.id}`);
          clasesCreadas.push(clase);
        }
      }
    }

    // NO actualizar clases_usadas aquí - esto solo se incrementa cuando la clase realmente ocurre
    // Las clases se generan pero no se cuentan como "usadas" hasta que pasen
    console.log(`[EscuelitaService] ${clasesCreadas.length} clases generadas. clases_usadas permanece en ${suscripcion.clases_usadas} (solo se incrementa cuando la clase ocurre)`);

    console.log(`[EscuelitaService] Resumen: ${clasesCreadas.length} clases creadas, ${errores.length} errores`);
    if (errores.length > 0) {
      console.log('[EscuelitaService] Errores:', errores);
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

  /**
   * Calcula el total de clases que habrá en un mes basándose en los horarios fijos
   * @param {Array} horariosFijos - Array de horarios fijos
   * @param {number} año - Año
   * @param {number} mes - Mes (1-12)
   * @returns {number} Total de clases en el mes
   */
  static calcularClasesDelMes(horariosFijos, año, mes) {
    let totalClases = 0;
    
    for (const horarioFijo of horariosFijos) {
      const fechas = this.obtenerFechasDelMes(año, mes, horarioFijo.dia_semana);
      totalClases += fechas.length;
    }
    
    return totalClases;
  }
}
