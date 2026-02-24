import { supabaseAdmin } from '../config/supabase.js';

/**
 * Servicio para manejar clases mensuales de suscripciones indefinidas (pensión/media pensión)
 */
export class ClasesMensualesService {
  /**
   * Obtiene o crea el registro de clases mensuales para una suscripción y mes/año
   */
  static async obtenerOCrearClasesMensuales(suscripcionId, mes, año) {
    // Intentar obtener registro existente
    const { data: existente, error: selectError } = await supabaseAdmin
      .from('clases_mensuales')
      .select('*')
      .eq('suscripcion_id', suscripcionId)
      .eq('mes', mes)
      .eq('año', año)
      .maybeSingle();

    if (selectError && selectError.code !== 'PGRST116') {
      throw selectError;
    }

    if (existente) {
      return existente;
    }

    // Si no existe, crear uno nuevo
    const { data: nuevo, error: insertError } = await supabaseAdmin
      .from('clases_mensuales')
      .insert({
        suscripcion_id: suscripcionId,
        mes,
        año,
        clases_usadas: 0,
      })
      .select()
      .single();

    if (insertError) {
      throw insertError;
    }

    return nuevo;
  }

  /**
   * Obtiene las clases disponibles para un mes específico
   */
  static async obtenerClasesDisponibles(suscripcionId, mes, año) {
    const { data: suscripcion } = await supabaseAdmin
      .from('suscripciones')
      .select(`
        *,
        planes:plan_id(clases_mes)
      `)
      .eq('id', suscripcionId)
      .single();

    if (!suscripcion || !suscripcion.planes) {
      return { clasesIncluidas: 0, clasesUsadas: 0, clasesDisponibles: 0 };
    }

    const clasesIncluidas = suscripcion.planes.clases_mes;

    // Obtener o crear registro mensual
    const clasesMensuales = await this.obtenerOCrearClasesMensuales(suscripcionId, mes, año);
    const clasesUsadas = clasesMensuales.clases_usadas || 0;

    return {
      clasesIncluidas,
      clasesUsadas,
      clasesDisponibles: clasesIncluidas - clasesUsadas,
    };
  }

  /**
   * Incrementa el contador de clases usadas para un mes
   */
  static async incrementarClasesUsadas(suscripcionId, mes, año) {
    const clasesMensuales = await this.obtenerOCrearClasesMensuales(suscripcionId, mes, año);

    const { data, error } = await supabaseAdmin
      .from('clases_mensuales')
      .update({ clases_usadas: clasesMensuales.clases_usadas + 1 })
      .eq('id', clasesMensuales.id)
      .select()
      .single();

    if (error) throw error;
    return data;
  }

  /**
   * Decrementa el contador de clases usadas para un mes
   */
  static async decrementarClasesUsadas(suscripcionId, mes, año) {
    const { data: clasesMensuales } = await supabaseAdmin
      .from('clases_mensuales')
      .select('*')
      .eq('suscripcion_id', suscripcionId)
      .eq('mes', mes)
      .eq('año', año)
      .maybeSingle();

    if (!clasesMensuales) {
      return null;
    }

    const { data, error } = await supabaseAdmin
      .from('clases_mensuales')
      .update({ clases_usadas: Math.max(0, clasesMensuales.clases_usadas - 1) })
      .eq('id', clasesMensuales.id)
      .select()
      .single();

    if (error) throw error;
    return data;
  }

  /**
   * Inicializa el tracking de clases para un mes (usado al generar facturas)
   */
  static async inicializarMes(suscripcionId, mes, año) {
    return await this.obtenerOCrearClasesMensuales(suscripcionId, mes, año);
  }
}
