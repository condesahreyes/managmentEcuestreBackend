import { supabaseAdmin } from '../config/supabase.js';

/**
 * Servicio para actualizar clases usadas basándose en clases que ya ocurrieron
 */
export class ClasesService {
  /**
   * Actualiza el contador de clases_usadas para todas las suscripciones activas
   * basándose en clases que ya pasaron (fecha < hoy)
   */
  static async actualizarClasesUsadas() {
    const hoy = new Date();
    hoy.setHours(0, 0, 0, 0);
    const fechaHoy = hoy.toISOString().split('T')[0];

    try {
      // Primero obtener todos los usuarios escuelita
      const { data: usuariosEscuelita, error: usuariosError } = await supabaseAdmin
        .from('users')
        .select('id')
        .eq('rol', 'escuelita')
        .eq('activo', true);

      if (usuariosError) {
        console.error('[ClasesService] Error al obtener usuarios escuelita:', usuariosError);
        return { exito: false, error: usuariosError.message };
      }

      const userIdsEscuelita = usuariosEscuelita?.map(u => u.id) || [];

      if (userIdsEscuelita.length === 0) {
        console.log('[ClasesService] No hay usuarios escuelita activos');
        return { exito: true, actualizaciones: 0, detalles: [] };
      }

      // Obtener todas las suscripciones activas de escuelita
      const { data: suscripciones, error: suscripcionesError } = await supabaseAdmin
        .from('suscripciones')
        .select('id, user_id, clases_incluidas, clases_usadas')
        .eq('activa', true)
        .in('user_id', userIdsEscuelita);

      if (suscripcionesError) {
        console.error('[ClasesService] Error al obtener suscripciones:', suscripcionesError);
        return { exito: false, error: suscripcionesError.message };
      }

      const actualizaciones = [];

      for (const suscripcion of suscripciones || []) {
        // Contar clases que ya pasaron (fecha < hoy) para este usuario
        const { data: clasesPasadas, error: clasesError } = await supabaseAdmin
          .from('clases')
          .select('id', { count: 'exact', head: false })
          .eq('user_id', suscripcion.user_id)
          .eq('estado', 'programada')
          .lt('fecha', fechaHoy);

        if (clasesError) {
          console.error(`[ClasesService] Error al contar clases pasadas para suscripción ${suscripcion.id}:`, clasesError);
          continue;
        }

        const clasesPasadasCount = clasesPasadas?.length || 0;

        // Solo actualizar si el número de clases pasadas es diferente al contador actual
        if (clasesPasadasCount !== suscripcion.clases_usadas) {
          const { error: updateError } = await supabaseAdmin
            .from('suscripciones')
            .update({ clases_usadas: clasesPasadasCount })
            .eq('id', suscripcion.id);

          if (updateError) {
            console.error(`[ClasesService] Error al actualizar clases_usadas para suscripción ${suscripcion.id}:`, updateError);
          } else {
            console.log(`[ClasesService] Actualizada suscripción ${suscripcion.id}: ${suscripcion.clases_usadas} -> ${clasesPasadasCount}`);
            actualizaciones.push({
              suscripcion_id: suscripcion.id,
              clases_usadas_anterior: suscripcion.clases_usadas,
              clases_usadas_nueva: clasesPasadasCount
            });
          }
        }
      }

      return {
        exito: true,
        actualizaciones: actualizaciones.length,
        detalles: actualizaciones
      };
    } catch (error) {
      console.error('[ClasesService] Error general:', error);
      return { exito: false, error: error.message };
    }
  }
}
