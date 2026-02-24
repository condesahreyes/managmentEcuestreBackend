import { supabaseAdmin } from '../config/supabase.js';
import { ClasesMensualesService } from './clasesMensualesService.js';

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
   * Genera facturas mensuales para suscripciones indefinidas (pensión/media pensión)
   * Se ejecuta el día 1 de cada mes
   * Solo genera facturas para usuarios con suscripciones activas donde fecha_fin es NULL
   */
  static async generarFacturasMensuales() {
    const ahora = new Date();
    const mes = ahora.getMonth() + 1; // 1-12
    const año = ahora.getFullYear();

    try {
      // Primero obtener usuarios activos de pensión/media pensión
      const { data: usuarios, error: usuariosError } = await supabaseAdmin
        .from('users')
        .select('id, nombre, apellido, email, rol')
        .eq('activo', true)
        .in('rol', ['pension_completa', 'media_pension']);

      if (usuariosError) throw usuariosError;
      if (!usuarios || usuarios.length === 0) {
        return {
          exito: true,
          facturasCreadas: 0,
          errores: [],
          totalSuscripciones: 0,
        };
      }

      const userIds = usuarios.map(u => u.id);

      // Obtener suscripciones activas e indefinidas de estos usuarios
      const { data: suscripciones, error: suscripcionesError } = await supabaseAdmin
        .from('suscripciones')
        .select(`
          id,
          user_id,
          plan_id,
          fecha_fin,
          activa,
          planes:plan_id(
            id,
            precio,
            nombre,
            tipo
          )
        `)
        .eq('activa', true)
        .is('fecha_fin', null) // Solo suscripciones indefinidas
        .in('user_id', userIds);

      if (suscripcionesError) throw suscripcionesError;

      const facturasCreadas = [];
      const errores = [];

      // Crear un mapa de usuarios por ID para acceso rápido
      const usuariosMap = new Map(usuarios.map(u => [u.id, u]));

      for (const suscripcion of suscripciones || []) {
        if (!suscripcion.planes) continue;

        const usuario = usuariosMap.get(suscripcion.user_id);
        if (!usuario) continue;

        // Verificar si ya existe factura para este mes y suscripción
        const { data: facturaExistente } = await supabaseAdmin
          .from('facturas')
          .select('id')
          .eq('user_id', usuario.id)
          .eq('suscripcion_id', suscripcion.id)
          .eq('mes', mes)
          .eq('año', año)
          .maybeSingle();

        if (facturaExistente) {
          continue; // Ya existe factura para este mes
        }

        // Calcular fecha de vencimiento (día 10 hábil)
        const fechaVencimiento = this.calcularDia10Habil(mes, año);

        // Inicializar tracking de clases para el mes
        try {
          await ClasesMensualesService.inicializarMes(suscripcion.id, mes, año);
        } catch (error) {
          console.error(`Error al inicializar clases mensuales para ${usuario.email}:`, error);
        }

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
        exito: facturasCreadas.length > 0 || errores.length === 0,
        facturasCreadas: facturasCreadas.length,
        errores,
        totalSuscripciones: suscripciones?.length || 0,
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
