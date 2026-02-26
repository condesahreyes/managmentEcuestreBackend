import { supabaseAdmin } from '../config/supabase.js';
import { ClasesMensualesService } from './clasesMensualesService.js';

/**
 * Servicio para validar y crear reservas con todas las validaciones requeridas
 */
export class ReservaService {

  // ---------------------------------------------------------------------------
  // NUEVA REGLA DE NEGOCIO: Validación de acceso mensual por pagos
  // ---------------------------------------------------------------------------

  /**
   * Verifica si existe un pago registrado para el usuario en un mes/año dado.
   * Busca en la tabla `pagos` los registros con estado 'pagado'/'aprobado'/etc.
   */
  static async tienePagoRegistrado(userId, mes, año) {
    const { data, error } = await supabaseAdmin
      .from('facturas')
      .select('id')
      .eq('user_id', userId)
      .eq('mes', mes)
      .eq('año', año)
      .in('estado', ['pagado', 'pagada', 'aprobado', 'confirmado'])
      .maybeSingle();

    if (error) {
      console.error('[tienePagoRegistrado] Error consultando pagos:', error);
      return false;
    }
    return !!data;
  }

  /**
   * Valida si el usuario (pension_completa / media_pension) puede reservar
   * para la fecha dada, según las reglas de acceso mensual por pagos.
   *
   * Reglas:
   *  - No se permiten reservas en meses pasados.
   *  - Solo se puede reservar el mes actual o el mes inmediatamente siguiente.
   *  - No se puede "saltar" meses sin tenerlos pagos.
   *
   *  Mes actual:
   *    · día actual ≤ 10 → permitir aunque no haya pago.
   *    · día actual > 10 → requiere pago del mes actual.
   *
   *  Mes siguiente:
   *    · Solo si tiene pago del mes actual.
   *    · Si día actual > 10 del mes siguiente → también requiere pago de ese mes siguiente.
   *      (Caso que no debería ocurrir normalmente, pero se cubre por robustez.)
   *
   * @returns {{ valido: boolean, error?: string, mesAdeudado?: number, añoAdeudado?: number }}
   */
  static async validarAccesoMensualPorPagos(userId, fecha) {
    const hoy = new Date();
    const diaHoy = hoy.getDate();
    const mesHoy = hoy.getMonth() + 1;   // 1-12
    const añoHoy = hoy.getFullYear();

    const fechaClase = new Date(fecha);
    const mesClase = fechaClase.getMonth() + 1;
    const añoClase = fechaClase.getFullYear();

    // Helper: comparar mes/año como número entero (yyyymm)
    const toYYYYMM = (m, a) => a * 100 + m;
    const claseYYYYMM  = toYYYYMM(mesClase, añoClase);
    const actualYYYYMM = toYYYYMM(mesHoy, añoHoy);

    // Calcular mes siguiente al actual
    const mesSiguiente = mesHoy === 12 ? 1 : mesHoy + 1;
    const añoSiguiente = mesHoy === 12 ? añoHoy + 1 : añoHoy;
    const siguienteYYYYMM = toYYYYMM(mesSiguiente, añoSiguiente);

    const nombreMes = (m, a) => `${m}/${a}`;

    // 1. No se permiten meses pasados
    if (claseYYYYMM < actualYYYYMM) {
      return {
        valido: false,
        error: `No se pueden hacer reservas en meses pasados (${nombreMes(mesClase, añoClase)}).`,
      };
    }

    // 2. No se permiten meses más allá del siguiente
    if (claseYYYYMM > siguienteYYYYMM) {
      return {
        valido: false,
        error: `Solo puedes reservar para el mes actual (${nombreMes(mesHoy, añoHoy)}) o el siguiente (${nombreMes(mesSiguiente, añoSiguiente)}).`,
      };
    }

    // ------------------------------------------------------------------
    // 3. Reserva en el MES ACTUAL
    // ------------------------------------------------------------------
    if (claseYYYYMM === actualYYYYMM) {
      if (diaHoy <= 10) {
        // Período de gracia — se permite sin pago
        return { valido: true };
      }

      // Día > 10 → requiere pago del mes actual
      const pagado = await this.tienePagoRegistrado(userId, mesHoy, añoHoy);
      if (!pagado) {
        return {
          valido: false,
          mesAdeudado: mesHoy,
          añoAdeudado: añoHoy,
          error: `Tu pago de ${nombreMes(mesHoy, añoHoy)} está pendiente. Por favor regulariza tu situación para continuar reservando.`,
        };
      }

      return { valido: true };
    }

    // ------------------------------------------------------------------
    // 4. Reserva en el MES SIGUIENTE
    // ------------------------------------------------------------------
    if (claseYYYYMM === siguienteYYYYMM) {
      // Verificar que el mes actual esté pago
      const pagadoActual = diaHoy <= 10
        ? true
        : await this.tienePagoRegistrado(userId, mesHoy, añoHoy);

      if (!pagadoActual) {
        return {
          valido: false,
          mesAdeudado: mesHoy,
          añoAdeudado: añoHoy,
          error: `Debes tener el mes ${nombreMes(mesHoy, añoHoy)} al día antes de reservar en ${nombreMes(mesSiguiente, añoSiguiente)}.`,
        };
      }
      // Si estamos en período de gracia (día ≤ 10), solo permitir hasta el día 10 del mes siguiente
      const pagadoSiguiente = await this.tienePagoRegistrado(userId, mesSiguiente, añoSiguiente);
      const diaClase = fechaClase.getDate();

      if (diaClase <= 10) {
        return { valido: true };
      }

      // Día actual > 10 → requiere pago del mes siguiente
      if (!pagadoSiguiente) {
        return {
          valido: false,
          mesAdeudado: mesSiguiente,
          añoAdeudado: añoSiguiente,
          error: `Tu pago de ${nombreMes(mesSiguiente, añoSiguiente)} está pendiente. Por favor regulariza tu situación para continuar reservando.`,
        };
      }
    }
    // Fallback (no debería llegar aquí)
    return { valido: true };
  }

  // ---------------------------------------------------------------------------
  // VALIDACIÓN DE CABALLOS COMPARTIDOS (media pensión)
  // ---------------------------------------------------------------------------

  /**
   * Obtiene el co-propietario de un caballo (para media pensión)
   * @returns { user_id, rol } o null
   */
  static async obtenerCoPropietario(caballoId, userIdActual) {
    const { data: caballo } = await supabaseAdmin
      .from('caballos')
      .select('dueno_id, dueno_id2')
      .eq('id', caballoId)
      .single();

    if (!caballo) return null;

    // Retornar el otro propietario
    if (caballo.dueno_id === userIdActual && caballo.dueno_id2) {
      return caballo.dueno_id2;
    } else if (caballo.dueno_id2 === userIdActual && caballo.dueno_id) {
      return caballo.dueno_id;
    }

    return null;
  }

  /**
   * Obtiene las clases del co-propietario que se superponen en horario
   * @returns array de clases que entran en conflicto
   */
  static async obtenerClasesDelCoPropietario(caballoId, userIdActual, fecha, horaInicio, horaFin) {
    const coPropietarioId = await this.obtenerCoPropietario(caballoId, userIdActual);

    if (!coPropietarioId) return [];

    const { data: clases } = await supabaseAdmin
      .from('clases')
      .select('id, user_id, hora_inicio, hora_fin')
      .eq('caballo_id', caballoId)
      .eq('user_id', coPropietarioId)
      .eq('fecha', fecha)
      .eq('estado', 'programada');

    if (!clases) return [];

    // Verificar si hay superposición de horario
    return clases.filter(clase => {
      const claseInicio = clase.hora_inicio;
      const claseFin = clase.hora_fin;
      // Hay superposición si NO es: fin ≤ inicio O inicio ≥ fin
      return !(horaFin <= claseInicio || horaInicio >= claseFin);
    });
  }

  // ---------------------------------------------------------------------------
  // MÉTODO PRINCIPAL DE VALIDACIÓN
  // ---------------------------------------------------------------------------

  /**
   * Valida todas las condiciones para una reserva
   * Orden de validación:
   * 1. Usuario activo
   * 2. Plan vigente
   * 3. Tiene clases disponibles
   * 3b. [NUEVO] Acceso mensual por pagos (pension / media_pension)
   * 4. Profesor disponible
   * 5. Caballo disponible
   * 6. No supera límite diario del caballo
   * 7. No hay conflicto de horario
   * 8. [NUEVO] Para media pensión: no hay conflicto con co-propietario 
   */
  static async validarReserva(userId, profesorId, caballoId, fecha, horaInicio, horaFin) {
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

        // 1b. Validar que la fecha no sea pasada (solo pension y media_pension)
    if (['pension_completa', 'media_pension'].includes(user.rol)) {
      const hoy = new Date();
      hoy.setHours(0, 0, 0, 0);
      const fechaReserva = new Date(fecha + 'T00:00:00');
      fechaReserva.setHours(0, 0, 0, 0);

      if (fechaReserva < hoy) {
        return { valido: false, error: 'No puedes reservar clases en fechas pasadas.' };
      }
    }

    // 2. Validar plan vigente (solo para escuelita y pension)
    if (['escuelita', 'pension_completa', 'media_pension'].includes(user.rol)) {
      const hoy = new Date().toISOString().split('T')[0];
      const { data: suscripcion } = await supabaseAdmin
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
        const fechaClase = new Date(fecha);
        const mes = fechaClase.getMonth() + 1;
        const año = fechaClase.getFullYear();

        const clasesMes = await ClasesMensualesService.obtenerClasesDisponibles(suscripcion.id, mes, año);
        if (clasesMes.clasesDisponibles <= 0) {
          return {
            valido: false,
            error: `No tienes clases disponibles para ${mes}/${año}. Has usado ${clasesMes.clasesUsadas} de ${clasesMes.clasesIncluidas} clases.`,
          };
        }

        // 3b. [NUEVO] Validar acceso mensual por pagos
        const accesoMensual = await this.validarAccesoMensualPorPagos(userId, fecha);
        if (!accesoMensual.valido) {
          return { valido: false, error: accesoMensual.error };
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

    // 7. Validar conflicto de horario del usuario (para pensión/media pensión)
    if (['pension_completa', 'media_pension'].includes(user.rol)) {
      const { data: userClases } = await supabaseAdmin
        .from('clases')
        .select('id')
        .eq('user_id', userId)
        .eq('fecha', fecha)
        .eq('estado', 'programada');

      if (userClases && userClases.length > 0) {
        return { valido: false, error: 'Ya tienes una clase programada para ese día.' };
      }

      // 8. [NUEVO] Para media pensión: validar que no haya conflicto con el co-propietario del caballo
      if (user.rol === 'media_pension') {
        const clasesConflictoCopropietario = await this.obtenerClasesDelCoPropietario(caballoId, userId, fecha, horaInicio, horaFin);
        
        if (clasesConflictoCopropietario && clasesConflictoCopropietario.length > 0) {
          return {
            valido: false,
            error: `No puedes reservar en ese horario. Tu co-propietario del caballo ya tiene una clase programada en ese horario.`,
          };
        }
      }
    }

    return { valido: true };
  }

  // ---------------------------------------------------------------------------
  // CREAR RESERVA
  // ---------------------------------------------------------------------------

  /**
   * Crea una reserva validando todas las condiciones
   */
  static async crearReserva(userId, profesorId, caballoId, fecha, horaInicio, horaFin, notas = null) {
    const validacion = await this.validarReserva(userId, profesorId, caballoId, fecha, horaInicio, horaFin);
    if (!validacion.valido) {
      return { exito: false, error: validacion.error };
    }

    const { data: user } = await supabaseAdmin
      .from('users')
      .select('rol')
      .eq('id', userId)
      .single();

    let esExtra = false;
    const fechaClase = new Date(fecha);
    const mes = fechaClase.getMonth() + 1;
    const año = fechaClase.getFullYear();

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
        notas,
      })
      .select()
      .single();

    if (error) {
      return { exito: false, error: 'Error al crear la reserva' };
    }

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

  // ---------------------------------------------------------------------------
  // REAGENDAR
  // ---------------------------------------------------------------------------

  /**
   * Reagenda una clase (mínimo 24 horas de anticipación)
   */
  static async reagendarClase(claseId, nuevaFecha, nuevaHoraInicio, nuevaHoraFin, userId) {
    const { data: clase } = await supabaseAdmin
      .from('clases')
      .select('*')
      .eq('id', claseId)
      .eq('user_id', userId)
      .single();

    if (!clase) {
      return { exito: false, error: 'Clase no encontrada' };
    }

    const ahora = new Date();
    const fechaClase = new Date(`${nuevaFecha}T${nuevaHoraInicio}`);
    const diferenciaHoras = (fechaClase - ahora) / (1000 * 60 * 60);

    if (diferenciaHoras < 24) {
      return { exito: false, error: 'Debes reagendar con al menos 24 horas de anticipación' };
    }

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

    const { data: user } = await supabaseAdmin
      .from('users')
      .select('rol')
      .eq('id', userId)
      .single();

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

        if (mesOriginal !== mesNueva || añoOriginal !== añoNueva) {
          await ClasesMensualesService.decrementarClasesUsadas(suscripcion.id, mesOriginal, añoOriginal);
          await ClasesMensualesService.incrementarClasesUsadas(suscripcion.id, mesNueva, añoNueva);
        }
      }
    }

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
        notas: clase.notas,
      })
      .select()
      .single();

    if (error) {
      return { exito: false, error: 'Error al reagendar la clase' };
    }

    return { exito: true, clase: nuevaClase };
  }
}