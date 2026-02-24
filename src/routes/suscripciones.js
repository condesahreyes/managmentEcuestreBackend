import express from 'express';
import { authenticateToken } from '../middleware/auth.js';
import { supabaseAdmin } from '../config/supabase.js';
import { obtenerUltimoDiaDelMes } from '../utils/fechas.js';

const router = express.Router();

// Todas las rutas requieren autenticación
router.use(authenticateToken);

// Obtener suscripción activa del usuario (no requiere validación completa porque se usa para verificar estado)
router.get('/mi-suscripcion', async (req, res) => {
  try {
    const now = new Date()
    const añoActual = now.getFullYear()
    const mesActual = now.getMonth() + 1

    // Para escuelita, buscar por fecha_inicio del mes
    // Para pensión/media pensión, buscar suscripción activa indefinida
    let query = supabaseAdmin
      .from('suscripciones')
      .select(`
        *,
        planes:plan_id(*),
        users:user_id(rol)
      `)
      .eq('user_id', req.user.id)
      .eq('activa', true);

    if (req.user.rol === 'escuelita') {
      const fechaBuscada = `${añoActual}-${String(mesActual).padStart(2, '0')}-01`;
      query = query.eq('fecha_inicio', fechaBuscada);
    } else {
      // Para pensión/media pensión, buscar suscripción indefinida
      query = query.is('fecha_fin', null);
    }

    const { data: suscripcion, error } = await query.maybeSingle();

    if (error && error.code !== 'PGRST116') {
      throw error;
    }

    if (!suscripcion) {
      return res.json({ suscripcion: null, mensaje: 'No tienes una suscripción activa' });
    }

    // Calcular clases disponibles según el tipo de usuario
    let clasesDisponibles;
    if (['pension_completa', 'media_pension'].includes(req.user.rol)) {
      // Para pensión/media pensión, usar clases del mes actual
      const { ClasesMensualesService } = await import('../services/clasesMensualesService.js');
      const clasesMes = await ClasesMensualesService.obtenerClasesDisponibles(suscripcion.id, mesActual, añoActual);
      clasesDisponibles = clasesMes.clasesDisponibles;
      
      res.json({
        ...suscripcion,
        clases_disponibles: clasesDisponibles,
        clases_incluidas: clasesMes.clasesIncluidas,
        clases_usadas: clasesMes.clasesUsadas,
        mes_actual: mesActual,
        año_actual: añoActual,
      });
    } else {
      // Para escuelita, usar clases totales
      clasesDisponibles = suscripcion.clases_incluidas - suscripcion.clases_usadas;
      res.json({
        ...suscripcion,
        clases_disponibles: clasesDisponibles
      });
    }
  } catch (error) {
    console.error('Error al obtener suscripción:', error);
    res.status(500).json({ error: 'Error al obtener suscripción' });
  }
});

// Obtener historial de suscripciones del usuario (no requiere validación completa)
router.get('/historial', async (req, res) => {
  try {
    const { meses } = req.query;
    const mesesNum = meses ? parseInt(meses) : 3;
    
    // Calcular fecha límite
    const hoy = new Date();
    const fechaLimite = new Date(hoy);
    fechaLimite.setMonth(fechaLimite.getMonth() - mesesNum);

    const { data: suscripciones, error } = await supabaseAdmin
      .from('suscripciones')
      .select(`
        *,
        planes:plan_id(*)
      `)
      .eq('user_id', req.user.id)
      .gte('fecha_inicio', fechaLimite.toISOString().split('T')[0])
      .order('fecha_inicio', { ascending: false });

    if (error) throw error;

    // Enriquecer con información de facturas
    const suscripcionesEnriquecidas = await Promise.all(
      (suscripciones || []).map(async (suscripcion) => {
        // Obtener facturas relacionadas
        const { data: facturas } = await supabaseAdmin
          .from('facturas')
          .select('*')
          .eq('suscripcion_id', suscripcion.id)
          .order('año', { ascending: false })
          .order('mes', { ascending: false });

        // Calcular estado de la suscripción
        const hoy = new Date();
        hoy.setHours(0, 0, 0, 0);
        const fechaFin = new Date(suscripcion.fecha_fin);
        fechaFin.setHours(0, 0, 0, 0);

        let estado = 'activa';
        if (!suscripcion.activa) {
          estado = 'finalizada';
        } else if (fechaFin < hoy) {
          estado = 'vencida';
        }

        // Verificar si tiene facturas pendientes o vencidas
        const tieneFacturasPendientes = facturas?.some((f) => !f.pagada);
        const tieneFacturasVencidas = facturas?.some((f) => {
          if (f.pagada) return false;
          const fechaVenc = new Date(f.fecha_vencimiento);
          fechaVenc.setHours(0, 0, 0, 0);
          return fechaVenc < hoy;
        });

        return {
          ...suscripcion,
          estado,
          facturas: facturas || [],
          tiene_facturas_pendientes: tieneFacturasPendientes,
          tiene_facturas_vencidas: tieneFacturasVencidas,
        };
      })
    );

    res.json(suscripcionesEnriquecidas);
  } catch (error) {
    console.error('Error al obtener historial de suscripciones:', error);
    res.status(500).json({ error: 'Error al obtener historial de suscripciones' });
  }
});

// Crear suscripción (ahora permite escuelita comprar sus propias suscripciones)
router.post('/', async (req, res) => {
  try {
    const { plan_id, fecha_inicio, horarios } = req.body; // horarios es un array para escuelita

    if (!plan_id) {
      return res.status(400).json({ error: 'Debes especificar un plan' });
    }

    // Obtener plan
    const { data: plan, error: planError } = await supabaseAdmin
      .from('planes')
      .select('*')
      .eq('id', plan_id)
      .single();

    if (planError || !plan) {
      return res.status(404).json({ error: 'Plan no encontrado' });
    }

    // Verificar que el plan coincida con el rol del usuario
    if (plan.tipo !== req.user.rol) {
      return res.status(400).json({
        error: `El plan seleccionado es para ${plan.tipo}, pero tu rol es ${req.user.rol}`,
      });
    }

    // Para escuelita, validar fechas especiales
    if (req.user.rol === 'escuelita') {
      const hoy = new Date();

      let inicio;

      if (fecha_inicio) {
        const [year, month, day] = fecha_inicio.split('-').map(Number);
        inicio = new Date(year, month - 1, day); // 👈 importante month - 1
      } else {
        inicio = new Date(hoy.getFullYear(), hoy.getMonth(), 1);
      }

      const añoActual = hoy.getFullYear();
      const mesActual = hoy.getMonth();

      const añoInicio = inicio.getFullYear();
      const mesInicio = inicio.getMonth();

      if (
        añoInicio < añoActual ||
        (añoInicio === añoActual && mesInicio < mesActual)
      ) {
        return res.status(400).json({
          error: 'No puedes comprar cuponeras para meses anteriores al actual.',
        });
      }

      // Validar que no exista una suscripción activa para el mismo mes
      const fin = obtenerUltimoDiaDelMes(inicio);
      const inicioStr = inicio.toISOString().split('T')[0];
      const finStr = fin.toISOString().split('T')[0];

      const { data: suscripcionesExistentes } = await supabaseAdmin
        .from('suscripciones')
        .select('id, fecha_inicio, fecha_fin')
        .eq('user_id', req.user.id)
        .eq('activa', true);

      // Verificar si hay solapamiento de fechas
      const haySolapamiento = suscripcionesExistentes?.some((susc) => {
        const suscInicio = new Date(susc.fecha_inicio);
        const suscFin = new Date(susc.fecha_fin);
        // Hay solapamiento si: inicio está dentro del rango de la suscripción existente
        // o fin está dentro del rango, o la suscripción existente está completamente dentro
        return (
          (inicio >= suscInicio && inicio <= suscFin) ||
          (fin >= suscInicio && fin <= suscFin) ||
          (inicio <= suscInicio && fin >= suscFin)
        );
      });

      if (haySolapamiento) {
        return res.status(400).json({
          error: 'Ya tienes una cuponera activa para este mes. No puedes comprar dos cuponeras para el mismo mes.',
        });
      }

      // Para escuelita, crear horarios fijos primero para calcular clases_incluidas
      // Validar horarios
      if (!horarios || !Array.isArray(horarios) || horarios.length === 0) {
        return res.status(400).json({
          error: 'Debes especificar al menos un horario fijo',
        });
      }

      // Validar que la cantidad de horarios coincida con el plan
      const clasesPorSemana = plan.clases_mes / 4;
      if (horarios.length !== clasesPorSemana) {
        return res.status(400).json({
          error: `Este plan requiere ${clasesPorSemana} horario(s) fijo(s) por semana. Has proporcionado ${horarios.length}.`,
        });
      }

      // Validar que cada horario tenga todos los campos
      for (const horario of horarios) {
        if (!horario.profesor_id || horario.dia_semana === undefined || !horario.hora || !horario.caballo_id) {
          return res.status(400).json({
            error: 'Cada horario debe tener: profesor, día de la semana, hora y caballo',
          });
        }
      }

      // Desactivar horarios fijos anteriores
      await supabaseAdmin
        .from('horarios_fijos')
        .update({ activo: false })
        .eq('user_id', req.user.id)
        .eq('activo', true);

      // Crear todos los horarios fijos temporalmente para calcular clases_incluidas
      const horariosFijosCreados = [];
      for (const horario of horarios) {
        const { data: horarioFijo, error: horarioError } = await supabaseAdmin
          .from('horarios_fijos')
          .insert({
            user_id: req.user.id,
            profesor_id: horario.profesor_id,
            dia_semana: parseInt(horario.dia_semana),
            hora: horario.hora,
            caballo_id: horario.caballo_id,
            activo: true
          })
          .select()
          .single();

        if (horarioError) {
          // Si falla algún horario, eliminar los horarios creados
          await supabaseAdmin.from('horarios_fijos').delete().in('id', horariosFijosCreados.map(h => h.id));
          throw horarioError;
        }

        horariosFijosCreados.push(horarioFijo);
      }

      // Calcular clases_incluidas basándose en los días reales del mes
      const { EscuelitaService } = await import('../services/escuelitaService.js');
      const año = inicio.getFullYear();
      const mesNum = inicio.getMonth() + 1;
      const clasesIncluidas = EscuelitaService.calcularClasesDelMes(horariosFijosCreados, año, mesNum);
      
      console.log(`[Suscripciones] Calculadas ${clasesIncluidas} clases para el mes ${año}-${mesNum}`);

      // Si es el mes actual, calcular cuántas clases ya pasaron
      let clasesUsadas = 0;
      const esMesActual = inicio.getMonth() === hoy.getMonth() && inicio.getFullYear() === hoy.getFullYear();
      
      if (esMesActual) {
        // Contar clases que ya pasaron (fecha < hoy) para los horarios fijos
        for (const horarioFijo of horariosFijosCreados) {
          const fechas = EscuelitaService.obtenerFechasDelMes(año, mesNum, horarioFijo.dia_semana);
          const clasesPasadas = fechas.filter(fecha => fecha < hoy.toISOString().split('T')[0]);
          clasesUsadas += clasesPasadas.length;
        }
        console.log(`[Suscripciones] Mes actual detectado. Clases ya pasadas: ${clasesUsadas}`);
      }

      // Crear nueva suscripción con el número correcto de clases
      const { data: suscripcion, error } = await supabaseAdmin
        .from('suscripciones')
        .insert({
          user_id: req.user.id,
          plan_id: plan_id,
          fecha_inicio: inicio.toISOString().split('T')[0],
          fecha_fin: fin.toISOString().split('T')[0],
          clases_incluidas: clasesIncluidas,
          clases_usadas: clasesUsadas, // Si es mes actual, cuenta las clases ya pasadas
          activa: true
        })
        .select(`
          *,
          planes:plan_id(*)
        `)
        .single();

      if (error) {
        // Si falla la suscripción, eliminar los horarios creados
        await supabaseAdmin.from('horarios_fijos').delete().in('id', horariosFijosCreados.map(h => h.id));
        throw error;
      }

      // Generar clases automáticamente para el mes
      const mes = `${inicio.getFullYear()}-${String(inicio.getMonth() + 1).padStart(2, '0')}`;
      const resultado = await EscuelitaService.generarClasesMensuales(req.user.id, mes);

      const clasesGeneradas = resultado?.clasesCreadas || 0;
      
      if (!resultado.exito && clasesGeneradas === 0) {
        console.warn('No se pudieron generar todas las clases:', resultado?.errores || resultado?.error);
      }

      // Crear factura automáticamente para la suscripción
      const { FacturacionService } = await import('../services/facturacionService.js');
      const añoNum = inicio.getFullYear();
      const fechaVencimiento = FacturacionService.calcularDia10Habil(mesNum, añoNum);

      const { data: factura, error: facturaError } = await supabaseAdmin
        .from('facturas')
        .insert({
          user_id: req.user.id,
          suscripcion_id: suscripcion.id,
          mes: mesNum,
          año: añoNum,
          monto: plan.precio,
          estado: 'pendiente',
          fecha_vencimiento: fechaVencimiento,
          pagada: false,
        })
        .select()
        .single();

      if (facturaError) {
        console.error('Error al crear factura:', facturaError);
        // No fallar la creación de suscripción si falla la factura, solo loguear
      } else {
        console.log(`[Suscripciones] Factura creada: ${factura.id} para mes ${mesNum}/${añoNum}`);
      }

      return res.status(201).json({
        ...suscripcion,
        horarios_fijos: horariosFijosCreados,
        clases_generadas: clasesGeneradas,
        factura: factura || null,
        mensaje: `Suscripción creada y ${clasesGeneradas} clases generadas automáticamente. Factura pendiente de pago.`,
      });
    }

    // Para otros roles (pensión completa, media pensión), comportamiento anterior
    // Desactivar suscripciones anteriores
    await supabaseAdmin
      .from('suscripciones')
      .update({ activa: false })
      .eq('user_id', req.user.id)
      .eq('activa', true);

    // Calcular fecha fin (1 mes desde inicio)
    const inicio = fecha_inicio ? new Date(fecha_inicio) : new Date();
    const fin = new Date(inicio);
    fin.setMonth(fin.getMonth() + 1);

    // Crear nueva suscripción
    const { data: suscripcion, error } = await supabaseAdmin
      .from('suscripciones')
      .insert({
        user_id: req.user.id,
        plan_id: plan_id,
        fecha_inicio: inicio.toISOString().split('T')[0],
        fecha_fin: fin.toISOString().split('T')[0],
        clases_incluidas: plan.clases_mes,
        clases_usadas: 0,
        activa: true
      })
      .select(`
        *,
        planes:plan_id(*)
      `)
      .single();

    if (error) throw error;

    res.status(201).json(suscripcion);
  } catch (error) {
    console.error('Error al crear suscripción:', error);
    res.status(500).json({ error: 'Error al crear suscripción', details: error.message });
  }
});

export default router;
