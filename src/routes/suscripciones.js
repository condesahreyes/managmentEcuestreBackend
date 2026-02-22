import express from 'express';
import { authenticateToken } from '../middleware/auth.js';
import { supabaseAdmin } from '../config/supabase.js';

const router = express.Router();

// Obtener suscripción activa del usuario
router.get('/mi-suscripcion', authenticateToken, async (req, res) => {
  try {
    const { data: suscripcion, error } = await supabaseAdmin
      .from('suscripciones')
      .select(`
        *,
        planes:plan_id(*)
      `)
      .eq('user_id', req.user.id)
      .eq('activa', true)
      .single();

    if (error && error.code !== 'PGRST116') {
      throw error;
    }

    if (!suscripcion) {
      return res.json({ suscripcion: null, mensaje: 'No tienes una suscripción activa' });
    }

    // Calcular clases disponibles
    const clasesDisponibles = suscripcion.clases_incluidas - suscripcion.clases_usadas;

    res.json({
      ...suscripcion,
      clases_disponibles: clasesDisponibles
    });
  } catch (error) {
    console.error('Error al obtener suscripción:', error);
    res.status(500).json({ error: 'Error al obtener suscripción' });
  }
});

// Obtener historial de suscripciones del usuario
router.get('/historial', authenticateToken, async (req, res) => {
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
router.post('/', authenticateToken, async (req, res) => {
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

    // Para escuelita, crear horarios fijos y generar clases automáticamente
    if (req.user.rol === 'escuelita') {
      // Validar horarios
      if (!horarios || !Array.isArray(horarios) || horarios.length === 0) {
        await supabaseAdmin.from('suscripciones').delete().eq('id', suscripcion.id);
        return res.status(400).json({
          error: 'Debes especificar al menos un horario fijo',
        });
      }

      // Validar que la cantidad de horarios coincida con el plan
      const clasesPorSemana = plan.clases_mes / 4;
      if (horarios.length !== clasesPorSemana) {
        await supabaseAdmin.from('suscripciones').delete().eq('id', suscripcion.id);
        return res.status(400).json({
          error: `Este plan requiere ${clasesPorSemana} horario(s) fijo(s) por semana. Has proporcionado ${horarios.length}.`,
        });
      }

      // Validar que cada horario tenga todos los campos
      for (const horario of horarios) {
        if (!horario.profesor_id || horario.dia_semana === undefined || !horario.hora || !horario.caballo_id) {
          await supabaseAdmin.from('suscripciones').delete().eq('id', suscripcion.id);
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

      // Crear todos los horarios fijos
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
          // Si falla algún horario, eliminar la suscripción y los horarios creados
          await supabaseAdmin.from('suscripciones').delete().eq('id', suscripcion.id);
          await supabaseAdmin.from('horarios_fijos').delete().in('id', horariosFijosCreados.map(h => h.id));
          throw horarioError;
        }

        horariosFijosCreados.push(horarioFijo);
      }

      // Generar clases automáticamente para el mes
      const mes = `${inicio.getFullYear()}-${String(inicio.getMonth() + 1).padStart(2, '0')}`;
      const { EscuelitaService } = await import('../services/escuelitaService.js');
      const resultado = await EscuelitaService.generarClasesMensuales(req.user.id, mes);

      if (!resultado.exito && resultado.clasesCreadas === 0) {
        console.warn('No se pudieron generar todas las clases:', resultado.errores);
      }

      return res.status(201).json({
        ...suscripcion,
        horarios_fijos: horariosFijosCreados,
        clases_generadas: resultado.clasesCreadas,
        mensaje: `Suscripción creada y ${resultado.clasesCreadas} clases generadas automáticamente`,
      });
    }

    res.status(201).json(suscripcion);
  } catch (error) {
    console.error('Error al crear suscripción:', error);
    res.status(500).json({ error: 'Error al crear suscripción', details: error.message });
  }
});

export default router;
