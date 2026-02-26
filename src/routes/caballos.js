import express from 'express';
import { authenticateToken } from '../middleware/auth.js';
import { supabaseAdmin } from '../config/supabase.js';
import { validarUsuarioCompleto } from '../middleware/validarUsuario.js';

const router = express.Router();

// Obtener caballos disponibles
router.get('/disponibles', authenticateToken, async (req, res) => {
  try {
    const { fecha, hora_inicio, hora_fin, dia_semana, hora, mes } = req.query;

    let caballosQuery = supabaseAdmin
      .from('caballos')
      .select('*')
      .eq('activo', true)
      .eq('estado', 'activo');

    // Filtrar caballos según el rol del usuario
    if (req.user.rol === 'escuelita') {
      // Escuelita solo ve caballos de tipo "escuela"
      caballosQuery = caballosQuery.eq('tipo', 'escuela');
    } else if (['pension_completa', 'media_pension'].includes(req.user.rol)) {
      // Pensión/Media Pensión: obtener caballos donde son propietarios (dueno_id o dueno_id2)
      caballosQuery = caballosQuery.or(`dueno_id.eq.${req.user.id},dueno_id2.eq.${req.user.id}`);
    }

    const { data: caballos, error: caballosError } = await caballosQuery;

    if (caballosError) throw caballosError;

    // Si se proporciona dia_semana y hora (para horarios fijos de escuelita), calcular disponibilidad para todo el mes
    if (dia_semana !== undefined && hora && mes && req.user.rol === 'escuelita') {
      const [año, mesNum] = mes.split('-').map(Number);
      const { EscuelitaService } = await import('../services/escuelitaService.js');
      const fechas = EscuelitaService.obtenerFechasDelMes(año, mesNum, parseInt(dia_semana));
      
      // Normalizar hora (puede venir con segundos)
      const horaNormalizada = hora.includes(':') ? hora.substring(0, 5) : hora;
      const [horaNum, minutoNum] = horaNormalizada.split(':').map(Number);
      const horaFin = `${String((horaNum + 1) % 24).padStart(2, '0')}:${String(minutoNum).padStart(2, '0')}`;

      // Verificar disponibilidad para todas las fechas del mes
      const caballosDisponibles = await Promise.all(
        caballos.map(async (caballo) => {
          let disponibleParaTodoElMes = true;
          const conflictos = [];

          for (const fecha of fechas) {
            // Verificar si el caballo está ocupado en esta fecha/hora
            const { data: conflicto } = await supabaseAdmin
              .from('clases')
              .select('id')
              .eq('caballo_id', caballo.id)
              .eq('fecha', fecha)
              .eq('estado', 'programada')
              .eq('hora_inicio', horaNormalizada);

            if (conflicto && conflicto.length > 0) {
              disponibleParaTodoElMes = false;
              conflictos.push(fecha);
              break; // Si hay conflicto en una fecha, no está disponible
            }

            // Verificar límite diario
            const { count } = await supabaseAdmin
              .from('clases')
              .select('*', { count: 'exact', head: true })
              .eq('caballo_id', caballo.id)
              .eq('fecha', fecha)
              .eq('estado', 'programada');

            if (count >= caballo.limite_clases_dia) {
              disponibleParaTodoElMes = false;
              conflictos.push(`${fecha} (límite diario alcanzado)`);
              break;
            }
          }

          return {
            ...caballo,
            disponible: disponibleParaTodoElMes,
            conflictos: conflictos.length > 0 ? conflictos : undefined
          };
        })
      );

      // Filtrar solo los disponibles
      const caballosFiltrados = caballosDisponibles.filter(c => c.disponible);
      return res.json(caballosFiltrados);
    }

    // Si se proporciona fecha y hora, filtrar los disponibles
    if (fecha && hora_inicio && hora_fin) {
      // Obtener clases ocupadas con información del usuario
      const { data: clasesOcupadas } = await supabaseAdmin
        .from('clases')
        .select('caballo_id, user_id')
        .eq('fecha', fecha)
        .eq('estado', 'programada')
        .or(`hora_inicio.eq.${hora_inicio},and(hora_inicio.lt.${hora_fin},hora_fin.gt.${hora_inicio})`);

      const caballosOcupadosIds = new Set(clasesOcupadas?.map(c => c.caballo_id) || []);
      
      // Para pensión/media pensión, verificar si su caballo está ocupado por ellos mismos
      const esPension = ['pension_completa', 'media_pension'].includes(req.user.rol);
      
      // Verificar límite diario y disponibilidad
      const caballosConDisponibilidad = await Promise.all(
        caballos.map(async (caballo) => {
          // Verificar si el caballo está ocupado
          const estaOcupado = caballosOcupadosIds.has(caballo.id);
          
          // Si está ocupado, verificar si es por el mismo usuario (para pensión/media pensión)
          let ocupadoPorUsuario = false;
          if (estaOcupado && esPension) {
            const claseOcupada = clasesOcupadas?.find(c => c.caballo_id === caballo.id);
            ocupadoPorUsuario = claseOcupada?.user_id === req.user.id;
          }

          // Contar clases del día
          const { count } = await supabaseAdmin
            .from('clases')
            .select('*', { count: 'exact', head: true })
            .eq('caballo_id', caballo.id)
            .eq('fecha', fecha)
            .eq('estado', 'programada');

          const disponible = !estaOcupado && (count || 0) < caballo.limite_clases_dia;

          return {
            ...caballo,
            clases_hoy: count || 0,
            disponible,
            ocupado: estaOcupado,
            ocupado_por_usuario: ocupadoPorUsuario, // Indica si está ocupado por una clase del mismo usuario
          };
        })
      );

      // Para pensión/media pensión, siempre devolver su caballo (aunque no esté disponible)
      // Para escuelita, solo devolver los disponibles
      if (esPension) {
        return res.json(caballosConDisponibilidad);
      } else {
        return res.json(caballosConDisponibilidad.filter(c => c.disponible));
      }
    }

    res.json(caballos);
  } catch (error) {
    console.error('Error al obtener caballos:', error);
    res.status(500).json({ error: 'Error al obtener caballos' });
  }
});

// Obtener caballo por ID (requiere validación completa)
router.get('/:id', authenticateToken, validarUsuarioCompleto, async (req, res) => {
  try {
    const { data, error } = await supabaseAdmin
      .from('caballos')
      .select('*')
      .eq('id', req.params.id)
      .single();

    if (error) throw error;
    if (!data) {
      return res.status(404).json({ error: 'Caballo no encontrado' });
    }

    res.json(data);
  } catch (error) {
    console.error('Error al obtener caballo:', error);
    res.status(500).json({ error: 'Error al obtener caballo' });
  }
});

export default router;
