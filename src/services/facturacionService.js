import { supabaseAdmin } from '../config/supabase.js';

/**
 * Servicio para generar facturas mensuales automáticamente
 */
export class FacturacionService {
  /**
   * Calcula el día 10 hábil de un mes
   */
  static calcularDia10Habil(mes, año) {
    let fecha = new Date(año, mes - 1, 1);
    let diasHabiles = 0;
    let diaActual = 1;

    while (diasHabiles < 10) {
      const diaSemana = fecha.getDay();
      // Lunes a Viernes son hábiles (1-5)
      if (diaSemana >= 1 && diaSemana <= 5) {
        diasHabiles++;
        if (diasHabiles === 10) {
          return fecha.toISOString().split('T')[0];
        }
      }
      fecha.setDate(++diaActual);
    }
    return fecha.toISOString().split('T')[0];
  }

  /**
   * Genera facturas para todos los alumnos activos con suscripciones activas
   * Se ejecuta el día 1 de cada mes
   */
  static async generarFacturasMensuales() {
    const ahora = new Date();
    const mes = ahora.getMonth() + 1; // 1-12
    const año = ahora.getFullYear();

    try {
      // Obtener todos los usuarios activos con suscripciones activas
      const { data: usuarios, error: usuariosError } = await supabaseAdmin
        .from('users')
        .select(`
          id,
          nombre,
          apellido,
          email,
          rol,
          suscripciones!inner(
            id,
            plan_id,
            fecha_fin,
            activa,
            planes:plan_id(id, precio, nombre)
          )
        `)
        .eq('activo', true)
        .eq('suscripciones.activa', true)
        .in('rol', ['escuelita', 'pension_completa', 'media_pension']);

      if (usuariosError) throw usuariosError;

      const facturasCreadas = [];
      const errores = [];

      for (const usuario of usuarios || []) {
        const suscripcion = usuario.suscripciones?.[0];
        if (!suscripcion || !suscripcion.planes) continue;

        // Verificar si ya existe factura para este mes
        const { data: facturaExistente } = await supabaseAdmin
          .from('facturas')
          .select('id')
          .eq('user_id', usuario.id)
          .eq('mes', mes)
          .eq('año', año)
          .single();

        if (facturaExistente) {
          continue; // Ya existe factura para este mes
        }

        // Calcular fecha de vencimiento (día 10 hábil)
        const fechaVencimiento = this.calcularDia10Habil(mes, año);

        // Crear factura
        const { data: factura, error: facturaError } = await supabaseAdmin
          .from('facturas')
          .insert({
            user_id: usuario.id,
            suscripcion_id: suscripcion.id,
            mes,
            año,
            monto: suscripcion.planes.precio,
            estado: 'pendiente',
            fecha_vencimiento: fechaVencimiento,
            pagada: false,
          })
          .select()
          .single();

        if (facturaError) {
          errores.push(`Error al crear factura para ${usuario.email}: ${facturaError.message}`);
        } else {
          facturasCreadas.push(factura);
        }
      }

      return {
        exito: facturasCreadas.length > 0,
        facturasCreadas: facturasCreadas.length,
        errores,
      };
    } catch (error) {
      console.error('Error al generar facturas:', error);
      throw error;
    }
  }

  /**
   * Obtiene las facturas pendientes de un usuario
   */
  static async obtenerFacturasPendientes(userId) {
    const { data, error } = await supabaseAdmin
      .from('facturas')
      .select(`
        *,
        suscripciones:suscripcion_id(
          planes:plan_id(nombre, precio)
        )
      `)
      .eq('user_id', userId)
      .eq('pagada', false)
      .order('año', { ascending: false })
      .order('mes', { ascending: false });

    if (error) throw error;
    return data || [];
  }

  /**
   * Obtiene todas las facturas de un usuario (últimos 3 meses)
   */
  static async obtenerFacturasHistorial(userId, meses = 3) {
    const hoy = new Date();
    const fechaLimite = new Date(hoy);
    fechaLimite.setMonth(fechaLimite.getMonth() - meses);

    const { data, error } = await supabaseAdmin
      .from('facturas')
      .select(`
        *,
        suscripciones:suscripcion_id(
          planes:plan_id(nombre, precio)
        ),
        comprobantes:comprobantes(
          id,
          estado,
          fecha_subida,
          observaciones
        )
      `)
      .eq('user_id', userId)
      .gte('created_at', fechaLimite.toISOString())
      .order('año', { ascending: false })
      .order('mes', { ascending: false });

    if (error) throw error;

    // Enriquecer con estado calculado (vencida, pendiente, pagada)
    const facturasEnriquecidas = (data || []).map((factura) => {
      const fechaVencimiento = new Date(factura.fecha_vencimiento);
      const hoy = new Date();
      hoy.setHours(0, 0, 0, 0);
      fechaVencimiento.setHours(0, 0, 0, 0);

      let estadoCalculado = factura.pagada ? 'pagada' : 'pendiente';
      if (!factura.pagada && fechaVencimiento < hoy) {
        estadoCalculado = 'vencida';
      }

      // Verificar si tiene comprobante pendiente
      const tieneComprobantePendiente = factura.comprobantes?.some(
        (c) => c.estado === 'pendiente'
      );

      return {
        ...factura,
        estado_calculado: estadoCalculado,
        tiene_comprobante_pendiente: tieneComprobantePendiente,
      };
    });

    return facturasEnriquecidas;
  }

  /**
   * Marca una factura como pagada cuando se aprueba un comprobante
   */
  static async marcarFacturaComoPagada(facturaId) {
    const { data, error } = await supabaseAdmin
      .from('facturas')
      .update({
        pagada: true,
        estado: 'pagada',
        fecha_pago: new Date().toISOString().split('T')[0],
      })
      .eq('id', facturaId)
      .select()
      .single();

    if (error) throw error;
    return data;
  }
}
