import { supabaseAdmin } from '../config/supabase.js';

/**
 * Servicio para calcular pagos mensuales de profesores
 */
export class PagosProfesoresService {
  /**
   * Calcula el pago mensual de un profesor para un mes/año específico
   */
  static async calcularPagoMensual(profesorId, mes, año) {
    try {
      // Obtener información del profesor
      const { data: profesor, error: profesorError } = await supabaseAdmin
        .from('profesores')
        .select('porcentaje_escuelita, porcentaje_pension')
        .eq('id', profesorId)
        .single();

      if (profesorError || !profesor) {
        throw new Error('Profesor no encontrado');
      }

      // Obtener todas las clases del profesor en ese mes
      const fechaInicio = `${año}-${String(mes).padStart(2, '0')}-01`;
      const fechaFin = new Date(año, mes, 0).toISOString().split('T')[0];

      // Obtener clases del profesor en ese mes
      const { data: clases, error: clasesError } = await supabaseAdmin
        .from('clases')
        .select(`
          id,
          user_id,
          fecha,
          estado
        `)
        .eq('profesor_id', profesorId)
        .gte('fecha', fechaInicio)
        .lte('fecha', fechaFin)
        .eq('estado', 'programada');

      if (clasesError) throw clasesError;
      // Obtener suscripciones únicas de usuarios que tienen clases con este profesor
      const userIds = [...new Set((clases || []).map(c => c.user_id))];
      if (userIds.length === 0) {
        return {
          profesor_id: profesorId,
          mes,
          año,
          total_escuelita: 0,
          total_pension: 0,
          clases_escuelita: 0,
          clases_pension: 0,
          porcentaje_escuelita: parseFloat(profesor.porcentaje_escuelita || 0),
          porcentaje_pension: parseFloat(profesor.porcentaje_pension || 0),
          pago_escuelita: 0,
          pago_pension: 0,
          pago_total: 0,
        };
      }

      // Obtener suscripciones activas de esos usuarios
      const { data: suscripciones, error: suscripcionesError } = await supabaseAdmin
        .from('suscripciones')
        .select(`
          id,
          user_id,
          plan_id,
          fecha_inicio,
          fecha_fin,
          planes:plan_id(precio, tipo)
        `)
        .eq('activa', true)
        .in('user_id', userIds);

      if (suscripcionesError) throw suscripcionesError;

      // Calcular totales por tipo de plan
      const suscripcionesEscuelitaUnicas = new Set();
      const suscripcionesPensionUnicas = new Set();
      let totalEscuelita = 0;
      let totalPension = 0;
      let clasesEscuelita = 0;
      let clasesPension = 0;
      for (const suscripcion of suscripciones || []) {
        if (!suscripcion.planes) continue;

        // Verificar que la suscripción esté activa en ese mes
        const inicioSuscripcion = new Date(suscripcion.fecha_inicio);
        const finSuscripcion = suscripcion.fecha_fin ? new Date(suscripcion.fecha_fin) : null;
        const inicioMes = new Date(fechaInicio);
        const finMes = new Date(fechaFin);

        if (inicioSuscripcion > finMes || (finSuscripcion && finSuscripcion < inicioMes)) {
          continue;
        }

        const key = suscripcion.id;
        if (suscripcion.planes.tipo === 'escuelita') {
          if (!suscripcionesEscuelitaUnicas.has(key)) {
            suscripcionesEscuelitaUnicas.add(key);
            totalEscuelita += parseFloat(suscripcion.planes.precio);
            clasesEscuelita++;
          }
        } else if (['pension_completa', 'media_pension'].includes(suscripcion.planes.tipo)) {
          if (!suscripcionesPensionUnicas.has(key)) {
            suscripcionesPensionUnicas.add(key);
            totalPension += parseFloat(suscripcion.planes.precio);
            clasesPension++;
          }
        }
      }

      // Calcular pagos según porcentajes
      const pagoEscuelita = (totalEscuelita * parseFloat(profesor.porcentaje_escuelita || 0)) / 100;
      const pagoPension = (totalPension * parseFloat(profesor.porcentaje_pension || 0)) / 100;
      const pagoTotal = pagoEscuelita + pagoPension;

      return {
        profesor_id: profesorId,
        mes,
        año,
        total_escuelita: totalEscuelita,
        total_pension: totalPension,
        clases_escuelita: clasesEscuelita,
        clases_pension: clasesPension,
        porcentaje_escuelita: parseFloat(profesor.porcentaje_escuelita || 0),
        porcentaje_pension: parseFloat(profesor.porcentaje_pension || 0),
        pago_escuelita: pagoEscuelita,
        pago_pension: pagoPension,
        pago_total: pagoTotal,
      };
    } catch (error) {
      console.error('Error al calcular pago mensual:', error);
      throw error;
    }
  }

  /**
   * Calcula los pagos de todos los profesores para un mes/año
   */
  static async calcularPagosMensuales(mes, año) {
    try {
      const { data: profesores, error } = await supabaseAdmin
        .from('profesores')
        .select('id, user_id')
        .eq('activo', true);

      if (error) throw error;

      const pagos = await Promise.all(
        (profesores || []).map(async (profesor) => {
          try {
                const { data: user, error } = await supabaseAdmin
                .from('users')
                .select('nombre, apellido')
                .eq('id', profesor.user_id)
                .single();

             let response = await this.calcularPagoMensual(profesor.id, mes, año);
              response.profesor = {
                nombre: user.nombre,
                apellido: user.apellido
              }
             return response;
          } catch (error) {
            console.error(`Error al calcular pago para profesor ${profesor.id}:`, error);
            return null;
          }
        })
      );

      return pagos.filter(p => p !== null);
    } catch (error) {
      console.error('Error al calcular pagos mensuales:', error);
      throw error;
    }
  }
}
