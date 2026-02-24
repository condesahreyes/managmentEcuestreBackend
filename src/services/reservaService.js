import { supabaseAdmin } from '../config/supabase.js';
import { ClasesMensualesService } from './clasesMensualesService.js';

/**
 * Servicio para validar y crear reservas con todas las validaciones requeridas
 */
export class ReservaService {
  /**
   * Valida todas las condiciones para una reserva
   * Orden de validación:
   * 1. Usuario activo
   * 2. Plan vigente
   * 3. Tiene clases disponibles
   * 4. Profesor disponible
   * 5. Caballo disponible
   * 6. No supera límite diario del caballo
   * 7. No hay conflicto de horario
   */
  static async validarReserva(userId, profesorId, caballoId, fecha, horaInicio, horaFin) {
    const errores = [];

    // 1. Validar usuario activo
    const { data: user, error: userError } = await supabaseAdmin
      .from('users')
      .select('activo, rol')
      .eq('id', userId)
      .single();

    if (userError || !user) {
      return { valido: false, error: 'Usuario no encontrado' };
    }

    if (!user.activo) {
      return { valido: false, error: 'Usuario bloqueado. Contacta al administrador.' };
    }

    // 2. Validar plan vigente (solo para escuelita y pension)
    if (['escuelita', 'pension_completa', 'media_pension'].includes(user.rol)) {
      const hoy = new Date().toISOString().split('T')[0];
      const { data: suscripcion, error } = await supabaseAdmin
        .from('suscripciones')
        .select('*')
        .eq('user_id', userId)
        .eq('activa', true)
        .lte('fecha_inicio', hoy)
        .or(`fecha_fin.is.null,fecha_fin.gte.${hoy}`)
        .maybeSingle();

      if (!suscripcion) {
        return { valido: false, error: 'No tienes un plan activo. Renueva tu suscripción.' };
      }

      // 3. Validar clases disponibles
      if (user.rol === 'escuelita') {
        const clasesDisponibles = suscripcion.clases_incluidas - suscripcion.clases_usadas;
        if (clasesDisponibles <= 0) {
          return { valido: false, error: 'No tienes clases disponibles en tu plan.' };
        }
      } else if (['pension_completa', 'media_pension'].includes(user.rol)) {
        // Para pensión/media pensión, validar clases del mes específico
        const fechaClase = new Date(fecha);
        const mes = fechaClase.getMonth() + 1;
        const año = fechaClase.getFullYear();
        
        const clasesMes = await ClasesMensualesService.obtenerClasesDisponibles(suscripcion.id, mes, año);
        if (clasesMes.clasesDisponibles <= 0) {
          return { valido: false, error: `No tienes clases disponibles para ${mes}/${año}. Has usado ${clasesMes.clasesUsadas} de ${clasesMes.clasesIncluidas} clases.` };
        }
      }
    }

    // 4. Validar profesor disponible
    const { data: profesorClases } = await supabaseAdmin
      .from('clases')
      .select('id')
      .eq('profesor_id', profesorId)
      .eq('fecha', fecha)
      .eq('estado', 'programada')
      .or(`hora_inicio.eq.${horaInicio},and(hora_inicio.lt.${horaFin},hora_fin.gt.${horaInicio})`);

    if (profesorClases && profesorClases.length > 0) {
      return { valido: false, error: 'El profesor no está disponible en ese horario.' };
    }

    // 5. Validar caballo disponible
    const { data: caballoClases } = await supabaseAdmin
      .from('clases')
      .select('id')
      .eq('caballo_id', caballoId)
      .eq('fecha', fecha)
      .eq('estado', 'programada')
      .or(`hora_inicio.eq.${horaInicio},and(hora_inicio.lt.${horaFin},hora_fin.gt.${horaInicio})`);

    if (caballoClases && caballoClases.length > 0) {
      return { valido: false, error: 'El caballo no está disponible en ese horario.' };
    }

    // 6. Validar límite diario del caballo
    const { data: caballo } = await supabaseAdmin
      .from('caballos')
      .select('limite_clases_dia, estado')
      .eq('id', caballoId)
      .single();

    if (!caballo) {
      return { valido: false, error: 'Caballo no encontrado' };
    }

    if (caballo.estado !== 'activo') {
      return { valido: false, error: `El caballo está en estado: ${caballo.estado}` };
    }

    const { count } = await supabaseAdmin
      .from('clases')
      .select('*', { count: 'exact', head: true })
      .eq('caballo_id', caballoId)
      .eq('fecha', fecha)
      .eq('estado', 'programada');

    if (count >= caballo.limite_clases_dia) {
      return { valido: false, error: `El caballo ha alcanzado su límite diario de ${caballo.limite_clases_dia} clases.` };
    }

    // 7. Validar conflicto de horario del usuario (solo para media pensión)
    if (user.rol === 'media_pension') {
      const { data: userClases } = await supabaseAdmin
        .from('clases')
        .select('id')
        .eq('user_id', userId)
        .eq('fecha', fecha)
        .eq('estado', 'programada')
        .or(`hora_inicio.eq.${horaInicio},and(hora_inicio.lt.${horaFin},hora_fin.gt.${horaInicio})`);

      if (userClases && userClases.length > 0) {
        return { valido: false, error: 'Ya tienes una clase programada en ese horario.' };
      }
    }

    return { valido: true };
  }

  /**
   * Crea una reserva validando todas las condiciones
   */
  static async crearReserva(userId, profesorId, caballoId, fecha, horaInicio, horaFin, notas = null) {
    // Validar primero
    const validacion = await this.validarReserva(userId, profesorId, caballoId, fecha, horaInicio, horaFin);
    if (!validacion.valido) {
      return { exito: false, error: validacion.error };
    }

    // Obtener información del usuario para determinar si es clase extra
    const { data: user } = await supabaseAdmin
      .from('users')
      .select('rol')
      .eq('id', userId)
      .single();

    let esExtra = false;
    const fechaClase = new Date(fecha);
    const mes = fechaClase.getMonth() + 1;
    const año = fechaClase.getFullYear();

    // Verificar si excede el plan
    if (user.rol === 'escuelita') {
      const { data: suscripcion } = await supabaseAdmin
        .from('suscripciones')
        .select('*')
        .eq('user_id', userId)
        .eq('activa', true)
        .single();

      if (suscripcion) {
        const clasesDisponibles = suscripcion.clases_incluidas - suscripcion.clases_usadas;
        esExtra = clasesDisponibles <= 0;
      } else {
        return { exito: false, error: 'Debes tener una suscripción activa para reservar clases' };
      }
    } else if (['pension_completa', 'media_pension'].includes(user.rol)) {
      const { data: suscripcion } = await supabaseAdmin
        .from('suscripciones')
        .select('*')
        .eq('user_id', userId)
        .eq('activa', true)
        .single();

      if (suscripcion) {
        const clasesMes = await ClasesMensualesService.obtenerClasesDisponibles(suscripcion.id, mes, año);
        esExtra = clasesMes.clasesDisponibles <= 0;
      }
    }

    // Crear la clase
    const { data: clase, error } = await supabaseAdmin
      .from('clases')
      .insert({
        user_id: userId,
        profesor_id: profesorId,
        caballo_id: caballoId,
        fecha,
        hora_inicio: horaInicio,
        hora_fin: horaFin,
        es_extra: esExtra,
        notas
      })
      .select()
      .single();

    if (error) {
      return { exito: false, error: 'Error al crear la reserva' };
    }

    // Actualizar contador de clases usadas si no es extra
    if (!esExtra) {
      if (user.rol === 'escuelita') {
        const { data: suscripcion } = await supabaseAdmin
          .from('suscripciones')
          .select('*')
          .eq('user_id', userId)
          .eq('activa', true)
          .single();

        if (suscripcion) {
          await supabaseAdmin
            .from('suscripciones')
            .update({ clases_usadas: suscripcion.clases_usadas + 1 })
            .eq('id', suscripcion.id);
        }
      } else if (['pension_completa', 'media_pension'].includes(user.rol)) {
        const { data: suscripcion } = await supabaseAdmin
          .from('suscripciones')
          .select('*')
          .eq('user_id', userId)
          .eq('activa', true)
          .single();

        if (suscripcion) {
          await ClasesMensualesService.incrementarClasesUsadas(suscripcion.id, mes, año);
        }
      }
    }

    return { exito: true, clase };
  }

  /**
   * Reagenda una clase (mínimo 24 horas de anticipación)
   */
  static async reagendarClase(claseId, nuevaFecha, nuevaHoraInicio, nuevaHoraFin, userId) {
    // Verificar que la clase pertenece al usuario
    const { data: clase } = await supabaseAdmin
      .from('clases')
      .select('*')
      .eq('id', claseId)
      .eq('user_id', userId)
      .single();

    if (!clase) {
      return { exito: false, error: 'Clase no encontrada' };
    }

    // Validar 24 horas de anticipación
    const ahora = new Date();
    const fechaClase = new Date(`${nuevaFecha}T${nuevaHoraInicio}`);
    const diferenciaHoras = (fechaClase - ahora) / (1000 * 60 * 60);

    if (diferenciaHoras < 24) {
      return { exito: false, error: 'Debes reagendar con al menos 24 horas de anticipación' };
    }

    // Validar nueva disponibilidad
    const validacion = await this.validarReserva(
      userId,
      clase.profesor_id,
      clase.caballo_id,
      nuevaFecha,
      nuevaHoraInicio,
      nuevaHoraFin
    );

    if (!validacion.valido) {
      return { exito: false, error: validacion.error };
    }

    // Obtener información del usuario
    const { data: user } = await supabaseAdmin
      .from('users')
      .select('rol')
      .eq('id', userId)
      .single();

    // Si no era extra, ajustar contadores de clases mensuales si cambia de mes
    if (!clase.es_extra && ['pension_completa', 'media_pension'].includes(user?.rol)) {
      const { data: suscripcion } = await supabaseAdmin
        .from('suscripciones')
        .select('*')
        .eq('user_id', userId)
        .eq('activa', true)
        .single();

      if (suscripcion) {
        const fechaOriginal = new Date(clase.fecha);
        const mesOriginal = fechaOriginal.getMonth() + 1;
        const añoOriginal = fechaOriginal.getFullYear();

        const fechaNueva = new Date(nuevaFecha);
        const mesNueva = fechaNueva.getMonth() + 1;
        const añoNueva = fechaNueva.getFullYear();

        // Si cambia de mes, decrementar del mes original e incrementar del nuevo
        if (mesOriginal !== mesNueva || añoOriginal !== añoNueva) {
          await ClasesMensualesService.decrementarClasesUsadas(suscripcion.id, mesOriginal, añoOriginal);
          await ClasesMensualesService.incrementarClasesUsadas(suscripcion.id, mesNueva, añoNueva);
        }
      }
    }

    // Marcar clase original como reagendada y crear nueva
    await supabaseAdmin
      .from('clases')
      .update({ estado: 'reagendada' })
      .eq('id', claseId);

    const { data: nuevaClase, error } = await supabaseAdmin
      .from('clases')
      .insert({
        user_id: userId,
        profesor_id: clase.profesor_id,
        caballo_id: clase.caballo_id,
        fecha: nuevaFecha,
        hora_inicio: nuevaHoraInicio,
        hora_fin: nuevaHoraFin,
        es_reagendada: true,
        clase_original_id: claseId,
        es_extra: clase.es_extra,
        notas: clase.notas
      })
      .select()
      .single();

    if (error) {
      return { exito: false, error: 'Error al reagendar la clase' };
    }

    return { exito: true, clase: nuevaClase };
  }
}
