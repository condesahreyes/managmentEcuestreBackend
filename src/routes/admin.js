import express from 'express';
import { authenticateToken, requireRole } from '../middleware/auth.js';
import { supabaseAdmin } from '../config/supabase.js';
import bcrypt from 'bcryptjs';

const router = express.Router();

// Todas las rutas requieren autenticación
router.use(authenticateToken);

// Obtener agenda general (admin y profesor)
router.get('/agenda', requireRole('admin', 'profesor'), async (req, res) => {
  try {
    const { fecha_inicio, fecha_fin, profesor_id, caballo_id } = req.query;

    let query = supabaseAdmin
      .from('clases')
      .select(`
        *,
        users:user_id(id, nombre, apellido, email, rol),
        profesores:profesor_id(id, users:user_id(nombre, apellido)),
        caballos:caballo_id(id, nombre, tipo, estado)
      `)
      .in('estado', ['programada', 'completada'])
      .order('fecha', { ascending: true })
      .order('hora_inicio', { ascending: true });

    if (fecha_inicio) {
      query = query.gte('fecha', fecha_inicio);
    }
    if (fecha_fin) {
      query = query.lte('fecha', fecha_fin);
    }
    if (profesor_id) {
      query = query.eq('profesor_id', profesor_id);
    }
    if (caballo_id) {
      query = query.eq('caballo_id', caballo_id);
    }

    const { data, error } = await query;

    if (error) throw error;

    res.json(data);
  } catch (error) {
    console.error('Error al obtener agenda:', error);
    res.status(500).json({ error: 'Error al obtener agenda' });
  }
});

// Obtener ocupación por caballo (admin y profesor)
router.get('/ocupacion/caballos', requireRole('admin', 'profesor'), async (req, res) => {
  try {
    const { fecha_inicio, fecha_fin } = req.query;

    const { data: caballos } = await supabaseAdmin
      .from('caballos')
      .select('id, nombre, limite_clases_dia')
      .eq('activo', true);

    const ocupacion = await Promise.all(
      caballos.map(async (caballo) => {
        let query = supabaseAdmin
          .from('clases')
          .select('*', { count: 'exact', head: false })
          .eq('caballo_id', caballo.id)
          .eq('estado', 'programada');

        if (fecha_inicio) {
          query = query.gte('fecha', fecha_inicio);
        }
        if (fecha_fin) {
          query = query.lte('fecha', fecha_fin);
        }

        const { count } = await query;

        return {
          caballo_id: caballo.id,
          nombre: caballo.nombre,
          clases_programadas: count || 0,
          limite_diario: caballo.limite_clases_dia,
          porcentaje_uso: ((count || 0) / (caballo.limite_clases_dia * 30)) * 100 // Aproximado para un mes
        };
      })
    );

    res.json(ocupacion);
  } catch (error) {
    console.error('Error al obtener ocupación:', error);
    res.status(500).json({ error: 'Error al obtener ocupación' });
  }
});

// Obtener ocupación por profesor (admin y profesor)
router.get('/ocupacion/profesores', requireRole('admin', 'profesor'), async (req, res) => {
  try {
    const { fecha_inicio, fecha_fin } = req.query;

    const { data: profesores } = await supabaseAdmin
      .from('profesores')
      .select(`
        id,
        users:user_id(nombre, apellido)
      `)
      .eq('activo', true);

    const ocupacion = await Promise.all(
      profesores.map(async (profesor) => {
        let query = supabaseAdmin
          .from('clases')
          .select('*', { count: 'exact', head: false })
          .eq('profesor_id', profesor.id)
          .eq('estado', 'programada');

        if (fecha_inicio) {
          query = query.gte('fecha', fecha_inicio);
        }
        if (fecha_fin) {
          query = query.lte('fecha', fecha_fin);
        }

        const { count } = await query;

        return {
          profesor_id: profesor.id,
          nombre: `${profesor.users?.nombre || ''} ${profesor.users?.apellido || ''}`.trim(),
          clases_programadas: count || 0
        };
      })
    );

    res.json(ocupacion);
  } catch (error) {
    console.error('Error al obtener ocupación:', error);
    res.status(500).json({ error: 'Error al obtener ocupación' });
  }
});

// Obtener alumnos activos (solo admin)
router.get('/alumnos', requireRole('admin'), async (req, res) => {
  try {
    const { activo, rol, page, limit, search } = req.query;
    const pageNum = page ? parseInt(page) : 1;
    const limitNum = limit ? parseInt(limit) : 1000; // Por defecto sin límite para compatibilidad
    const offset = (pageNum - 1) * limitNum;

    // Primero obtener los usuarios con conteo
    let query = supabaseAdmin
      .from('users')
      .select('*', { count: page && limit ? 'exact' : undefined })
      .in('rol', ['escuelita', 'pension_completa', 'media_pension']);

    if (activo !== undefined) {
      query = query.eq('activo', activo === 'true');
    }
    if (rol) {
      query = query.eq('rol', rol);
    }
    if (search) {
      query = query.or(`nombre.ilike.%${search}%,apellido.ilike.%${search}%,email.ilike.%${search}%`);
    }

    // Si se solicita paginación, aplicarla
    if (page && limit) {
      query = query.range(offset, offset + limitNum - 1);
    }

    query = query.order('nombre', { ascending: true });

    const { data: usuarios, error: usuariosError, count } = await query;

    if (usuariosError) throw usuariosError;

    // Para cada usuario, obtener sus suscripciones
    const alumnosConSuscripciones = await Promise.all(
      (usuarios || []).map(async (usuario) => {
        const { data: suscripciones } = await supabaseAdmin
          .from('suscripciones')
          .select(`
            *,
            planes:plan_id(*)
          `)
          .eq('user_id', usuario.id)
          .order('fecha_inicio', { ascending: false })
          .limit(1);

        return {
          ...usuario,
          suscripciones: suscripciones || [],
        };
      })
    );

    // Si se solicitó paginación, devolver con estructura de paginación
    if (page && limit) {
      res.json({
        alumnos: alumnosConSuscripciones,
        paginacion: {
          pagina: pageNum,
          limite: limitNum,
          total: count || 0,
          totalPaginas: Math.ceil((count || 0) / limitNum),
        },
      });
    } else {
      // Compatibilidad con respuesta antigua
      res.json(alumnosConSuscripciones);
    }
  } catch (error) {
    console.error('Error al obtener alumnos:', error);
    res.status(500).json({ error: 'Error al obtener alumnos', details: error.message });
  }
});

// Bloquear/desbloquear alumno (solo admin)
router.patch('/alumnos/:id/bloquear', requireRole('admin'), async (req, res) => {
  try {
    const { id } = req.params;
    const { activo } = req.body;

    const { data, error } = await supabaseAdmin
      .from('users')
      .update({ activo: activo !== false })
      .eq('id', id)
      .select()
      .single();

    if (error) throw error;

    res.json({ mensaje: `Alumno ${activo !== false ? 'activado' : 'bloqueado'}`, usuario: data });
  } catch (error) {
    console.error('Error al bloquear alumno:', error);
    res.status(500).json({ error: 'Error al bloquear alumno' });
  }
});

// CRUD de Caballos (solo admin)
router.get('/caballos', requireRole('admin'), async (req, res) => {
  try {
    const { data, error } = await supabaseAdmin
      .from('caballos')
      .select(`
        *,
        dueno:dueno_id(id, nombre, apellido, email)
      `)
      .order('nombre', { ascending: true });

    if (error) throw error;

    res.json(data || []);
  } catch (error) {
    console.error('Error al obtener caballos:', error);
    res.status(500).json({ error: 'Error al obtener caballos' });
  }
});

// Obtener dueños disponibles (alumnos de pensión completa o media pensión)
router.get('/duenos', requireRole('admin'), async (req, res) => {
  try {
    const { data, error } = await supabaseAdmin
      .from('users')
      .select('id, nombre, apellido, email')
      .in('rol', ['pension_completa', 'media_pension'])
      .eq('activo', true)
      .order('nombre', { ascending: true });

    if (error) throw error;

    res.json(data || []);
  } catch (error) {
    console.error('Error al obtener dueños:', error);
    res.status(500).json({ error: 'Error al obtener dueños' });
  }
});

router.post('/caballos', requireRole('admin'), async (req, res) => {
  try {
    const { nombre, tipo, estado, limite_clases_dia, dueno_id } = req.body;

    if (!nombre || !tipo || !estado || !limite_clases_dia) {
      return res.status(400).json({ error: 'Faltan campos requeridos' });
    }

    if (!['escuela', 'privado'].includes(tipo)) {
      return res.status(400).json({ error: 'Tipo inválido' });
    }

    if (!['activo', 'descanso', 'lesionado'].includes(estado)) {
      return res.status(400).json({ error: 'Estado inválido' });
    }

    // Si es privado, debe tener dueño
    if (tipo === 'privado' && !dueno_id) {
      return res.status(400).json({ error: 'Los caballos privados deben tener un dueño asignado' });
    }

    // Si es escuela, no debe tener dueño
    const insertData = {
      nombre,
      tipo,
      estado,
      limite_clases_dia: parseInt(limite_clases_dia),
      activo: true,
    };

    if (tipo === 'privado' && dueno_id) {
      insertData.dueno_id = dueno_id;
    } else {
      insertData.dueno_id = null;
    }

    const { data, error } = await supabaseAdmin
      .from('caballos')
      .insert(insertData)
      .select(`
        *,
        dueno:dueno_id(id, nombre, apellido, email)
      `)
      .single();

    if (error) throw error;

    res.status(201).json(data);
  } catch (error) {
    console.error('Error al crear caballo:', error);
    res.status(500).json({ error: 'Error al crear caballo' });
  }
});

router.patch('/caballos/:id', requireRole('admin'), async (req, res) => {
  try {
    const { id } = req.params;
    const updates = req.body;

    // Validar tipo si se proporciona
    if (updates.tipo && !['escuela', 'privado'].includes(updates.tipo)) {
      return res.status(400).json({ error: 'Tipo inválido' });
    }

    // Validar estado si se proporciona
    if (updates.estado && !['activo', 'descanso', 'lesionado'].includes(updates.estado)) {
      return res.status(400).json({ error: 'Estado inválido' });
    }

    // Convertir limite_clases_dia a número si se proporciona
    if (updates.limite_clases_dia) {
      updates.limite_clases_dia = parseInt(updates.limite_clases_dia);
    }

    // Si cambia a privado, debe tener dueño
    if (updates.tipo === 'privado' && !updates.dueno_id) {
      // Obtener el caballo actual para verificar si ya tiene dueño
      const { data: caballoActual } = await supabaseAdmin
        .from('caballos')
        .select('dueno_id')
        .eq('id', id)
        .single();

      if (!caballoActual?.dueno_id) {
        return res.status(400).json({ error: 'Los caballos privados deben tener un dueño asignado' });
      }
    }

    // Si cambia a escuela, eliminar dueño
    if (updates.tipo === 'escuela') {
      updates.dueno_id = null;
    }

    const { data, error } = await supabaseAdmin
      .from('caballos')
      .update(updates)
      .eq('id', id)
      .select(`
        *,
        dueno:dueno_id(id, nombre, apellido, email)
      `)
      .single();

    if (error) throw error;

    res.json(data);
  } catch (error) {
    console.error('Error al actualizar caballo:', error);
    res.status(500).json({ error: 'Error al actualizar caballo' });
  }
});

router.delete('/caballos/:id', requireRole('admin'), async (req, res) => {
  try {
    const { id } = req.params;

    // Verificar si el caballo tiene clases programadas
    const { count } = await supabaseAdmin
      .from('clases')
      .select('*', { count: 'exact', head: true })
      .eq('caballo_id', id)
      .eq('estado', 'programada');

    if (count > 0) {
      return res.status(400).json({
        error: 'No se puede eliminar un caballo con clases programadas',
      });
    }

    const { error } = await supabaseAdmin.from('caballos').delete().eq('id', id);

    if (error) throw error;

    res.json({ mensaje: 'Caballo eliminado exitosamente' });
  } catch (error) {
    console.error('Error al eliminar caballo:', error);
    res.status(500).json({ error: 'Error al eliminar caballo' });
  }
});

// Cambiar estado de caballo (mantener compatibilidad)
router.patch('/caballos/:id/estado', requireRole('admin'), async (req, res) => {
  try {
    const { id } = req.params;
    const { estado } = req.body;

    if (!['activo', 'descanso', 'lesionado'].includes(estado)) {
      return res.status(400).json({ error: 'Estado inválido' });
    }

    const { data, error } = await supabaseAdmin
      .from('caballos')
      .update({ estado })
      .eq('id', id)
      .select()
      .single();

    if (error) throw error;

    res.json({ mensaje: 'Estado actualizado', caballo: data });
  } catch (error) {
    console.error('Error al cambiar estado:', error);
    res.status(500).json({ error: 'Error al cambiar estado' });
  }
});

// CRUD de planes (solo admin)
router.get('/planes', requireRole('admin'), async (req, res) => {
  try {
    const { data, error } = await supabaseAdmin
      .from('planes')
      .select('*')
      .order('tipo', { ascending: true })
      .order('precio', { ascending: true });

    if (error) throw error;

    res.json(data);
  } catch (error) {
    console.error('Error al obtener planes:', error);
    res.status(500).json({ error: 'Error al obtener planes' });
  }
});

router.post('/planes', requireRole('admin'), async (req, res) => {
  try {
    const { nombre, tipo, clases_mes, precio } = req.body;

    if (!nombre || !tipo || !clases_mes || !precio) {
      return res.status(400).json({ error: 'Faltan campos requeridos' });
    }

    const { data, error } = await supabaseAdmin
      .from('planes')
      .insert({ nombre, tipo, clases_mes, precio, activo: true })
      .select()
      .single();

    if (error) throw error;

    res.status(201).json(data);
  } catch (error) {
    console.error('Error al crear plan:', error);
    res.status(500).json({ error: 'Error al crear plan' });
  }
});

router.patch('/planes/:id', requireRole('admin'), async (req, res) => {
  try {
    const { id } = req.params;
    const updates = req.body;

    const { data, error } = await supabaseAdmin
      .from('planes')
      .update(updates)
      .eq('id', id)
      .select()
      .single();

    if (error) throw error;

    res.json(data);
  } catch (error) {
    console.error('Error al actualizar plan:', error);
    res.status(500).json({ error: 'Error al actualizar plan' });
  }
});

router.delete('/planes/:id', requireRole('admin'), async (req, res) => {
  try {
    const { id } = req.params;

    // Verificar si el plan tiene suscripciones activas
    const { count } = await supabaseAdmin
      .from('suscripciones')
      .select('*', { count: 'exact', head: true })
      .eq('plan_id', id)
      .eq('activa', true);

    if (count > 0) {
      return res.status(400).json({
        error: 'No se puede eliminar un plan con suscripciones activas',
      });
    }

    // Eliminar el plan
    const { error } = await supabaseAdmin
      .from('planes')
      .delete()
      .eq('id', id);

    if (error) throw error;

    res.json({ mensaje: 'Plan eliminado exitosamente' });
  } catch (error) {
    console.error('Error al eliminar plan:', error);
    res.status(500).json({ error: 'Error al eliminar plan' });
  }
});

// CRUD de Profesores (solo admin)
router.get('/profesores', requireRole('admin'), async (req, res) => {
  try {
    const { data, error } = await supabaseAdmin
      .from('profesores')
      .select(`
        *,
        users:user_id(id, nombre, apellido, email, telefono, activo)
      `)
      .order('created_at', { ascending: false });

    if (error) throw error;

    res.json(data || []);
  } catch (error) {
    console.error('Error al obtener profesores:', error);
    res.status(500).json({ error: 'Error al obtener profesores' });
  }
});

router.post('/profesores', requireRole('admin'), async (req, res) => {
  try {
    const { nombre, apellido, email, telefono, porcentaje_escuelita, porcentaje_pension } = req.body;

    if (!nombre || !apellido || !email) {
      return res.status(400).json({ error: 'Faltan campos requeridos' });
    }

    // Verificar si el email ya existe
    const { data: existingUser } = await supabaseAdmin
      .from('users')
      .select('id')
      .eq('email', email)
      .single();

    if (existingUser) {
      return res.status(400).json({ error: 'El email ya está registrado' });
    }

    // Contraseña por defecto
    const defaultPassword = '123456';
    const passwordHash = await bcrypt.hash(defaultPassword, 10);

    // Crear usuario en la tabla users
    const { data: user, error: userError } = await supabaseAdmin
      .from('users')
      .insert({
        email,
        password_hash: passwordHash,
        nombre,
        apellido,
        telefono: telefono || null,
        rol: 'profesor',
        activo: true,
      })
      .select()
      .single();

    if (userError) {
      throw userError;
    }

    // Crear registro en profesores
    const { data: profesor, error: profesorError } = await supabaseAdmin
      .from('profesores')
      .insert({
        user_id: user.id,
        activo: true,
        porcentaje_escuelita: porcentaje_escuelita || 0,
        porcentaje_pension: porcentaje_pension || 0,
      })
      .select()
      .single();

    if (profesorError) {
      // Si falla, eliminar el usuario
      await supabaseAdmin.from('users').delete().eq('id', user.id);
      throw profesorError;
    }

    // Crear horarios si se proporcionan
    const { horarios } = req.body;
    if (horarios && Array.isArray(horarios) && horarios.length > 0) {
      const horariosData = horarios.map((horario) => ({
        profesor_id: profesor.id,
        dia_semana: horario.dia_semana,
        hora_inicio: horario.hora_inicio,
        hora_fin: horario.hora_fin,
        activo: true,
      }));

      const { error: horariosError } = await supabaseAdmin
        .from('horarios_profesores')
        .insert(horariosData);

      if (horariosError) {
        console.error('Error al crear horarios:', horariosError);
        // No fallamos la creación del profesor si fallan los horarios
      }
    }

    res.status(201).json({
      mensaje: `Profesor creado exitosamente. Contraseña por defecto: ${defaultPassword}`,
      profesor: {
        ...profesor,
        users: user,
      },
      password: defaultPassword, // Incluimos la contraseña en la respuesta para mostrarla al admin
    });
  } catch (error) {
    console.error('Error al crear profesor:', error);
    res.status(500).json({ error: 'Error al crear profesor', details: error.message });
  }
});

router.patch('/profesores/:id', requireRole('admin'), async (req, res) => {
  try {
    const { id } = req.params;
    const { nombre, apellido, telefono, activo, horarios, porcentaje_escuelita, porcentaje_pension } = req.body;

    // Obtener el profesor para acceder al user_id
    const { data: profesor } = await supabaseAdmin
      .from('profesores')
      .select('user_id')
      .eq('id', id)
      .single();

    if (!profesor) {
      return res.status(404).json({ error: 'Profesor no encontrado' });
    }

    // Actualizar usuario
    const userUpdates = {};
    if (nombre !== undefined) userUpdates.nombre = nombre;
    if (apellido !== undefined) userUpdates.apellido = apellido;
    if (telefono !== undefined) userUpdates.telefono = telefono;
    if (activo !== undefined) userUpdates.activo = activo;

    if (Object.keys(userUpdates).length > 0) {
      const { error: userError } = await supabaseAdmin
        .from('users')
        .update(userUpdates)
        .eq('id', profesor.user_id);

      if (userError) throw userError;
    }

    // Actualizar profesor
    const profesorUpdates = {};
    if (activo !== undefined) profesorUpdates.activo = activo;
    if (porcentaje_escuelita !== undefined) profesorUpdates.porcentaje_escuelita = porcentaje_escuelita;
    if (porcentaje_pension !== undefined) profesorUpdates.porcentaje_pension = porcentaje_pension;

    if (Object.keys(profesorUpdates).length > 0) {
      const { error: profesorError } = await supabaseAdmin
        .from('profesores')
        .update(profesorUpdates)
        .eq('id', id);

      if (profesorError) throw profesorError;
    }

    // Actualizar horarios si se proporcionan
    if (horarios !== undefined && Array.isArray(horarios)) {
      // Desactivar horarios existentes
      await supabaseAdmin
        .from('horarios_profesores')
        .update({ activo: false })
        .eq('profesor_id', id);

      // Luego, para cada horario nuevo → intentar update o insert
  for (const horario of horarios) {
    const { data, error } = await supabaseAdmin
      .from('horarios_profesores')
      .upsert(
        {
          profesor_id: id,
          dia_semana: horario.dia_semana,
          hora_inicio: horario.hora_inicio,
          hora_fin: horario.hora_fin,
          activo: true,
        },
        {
          onConflict: 'profesor_id, dia_semana, hora_inicio, hora_fin',
          ignoreDuplicates: false, // queremos que actualice
        }
      );

    if (error) {
      console.error('Error en upsert de horario:', error);
    }
  }
      
    }

    // Obtener datos actualizados
    const { data: updatedProfesor, error: fetchError } = await supabaseAdmin
      .from('profesores')
      .select(`
        *,
        users:user_id(*)
      `)
      .eq('id', id)
      .single();

    if (fetchError) throw fetchError;

    res.json(updatedProfesor);
  } catch (error) {
    console.error('Error al actualizar profesor:', error);
    res.status(500).json({ error: 'Error al actualizar profesor' });
  }
});

// Asignar suscripción a un alumno (solo admin)
router.post('/alumnos/:id/suscripcion', requireRole('admin'), async (req, res) => {
  try {
    const { id } = req.params;
    const { plan_id, fecha_inicio, mes, año } = req.body;

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
    const { data: usuario } = await supabaseAdmin
      .from('users')
      .select('rol')
      .eq('id', id)
      .single();

    if (!usuario) {
      return res.status(404).json({ error: 'Usuario no encontrado' });
    }

    if (plan.tipo !== usuario.rol) {
      return res.status(400).json({
        error: `El plan seleccionado es para ${plan.tipo}, pero el usuario es ${usuario.rol}`,
      });
    }

    // Desactivar suscripciones anteriores
    await supabaseAdmin
      .from('suscripciones')
      .update({ activa: false })
      .eq('user_id', id)
      .eq('activa', true);

    // Calcular fecha_inicio: si viene mes/año, usar el primer día del mes; si viene fecha_inicio, usarla
    let inicio;
    if (mes && año) {
      inicio = new Date(año, mes - 1, 1);
    } else if (fecha_inicio) {
      inicio = new Date(fecha_inicio);
    } else {
      inicio = new Date();
    }

    // Para pensión completa y media pensión: fecha_fin es null (indeterminado)
    // Para escuelita: fecha_fin es el último día del mes seleccionado
    let fin = null;
    if (plan.tipo === 'escuelita') {
      const { obtenerUltimoDiaDelMes } = await import('../utils/fechas.js');
      fin = obtenerUltimoDiaDelMes(inicio);
    }
    // Para pension_completa y media_pension, fin queda como null

    // Crear nueva suscripción
    const suscripcionData = {
      user_id: id,
      plan_id: plan_id,
      fecha_inicio: inicio.toISOString().split('T')[0],
      clases_incluidas: plan.clases_mes,
      clases_usadas: 0,
      activa: true,
    };

    // Solo agregar fecha_fin si no es null (para escuelita)
    // Para pensiones, fecha_fin será null (indeterminado)
    if (fin) {
      suscripcionData.fecha_fin = fin.toISOString().split('T')[0];
    }
    // Si fin es null, no se agrega fecha_fin al objeto (será null en la BD si el schema lo permite)
    const { data: suscripcion, error } = await supabaseAdmin
      .from('suscripciones')
      .insert(suscripcionData)
      .select(`
        *,
        planes:plan_id(*)
      `)
      .single();

    if (error) throw error;

    res.status(201).json({
      mensaje: 'Suscripción asignada exitosamente',
      suscripcion,
    });
  } catch (error) {
    console.error('Error al asignar suscripción:', error);
    res.status(500).json({ error: 'Error al asignar suscripción' });
  }
});

// Obtener todas las suscripciones de un alumno (solo admin)
router.get('/alumnos/:id/suscripciones', requireRole('admin'), async (req, res) => {
  try {
    const { id } = req.params;

    const { data: suscripciones, error } = await supabaseAdmin
      .from('suscripciones')
      .select(`
        *,
        planes:plan_id(*)
      `)
      .eq('user_id', id)
      .order('fecha_inicio', { ascending: false });

    if (error) throw error;

    res.json(suscripciones || []);
  } catch (error) {
    console.error('Error al obtener suscripciones del alumno:', error);
    res.status(500).json({ error: 'Error al obtener suscripciones' });
  }
});

// Editar suscripción (solo admin)
router.patch('/suscripciones/:id', requireRole('admin'), async (req, res) => {
  try {
    const { id } = req.params;
    const { plan_id, mes, año, fecha_inicio, clases_incluidas, clases_usadas, activa } = req.body;

    const { data: suscripcionExistente, error: fetchError } = await supabaseAdmin
      .from('suscripciones')
      .select('*, planes:plan_id(id, tipo, clases_mes)')
      .eq('id', id)
      .single();

    if (fetchError || !suscripcionExistente) {
      return res.status(404).json({ error: 'Suscripción no encontrada' });
    }

    const updates = {};
    let planTipo = suscripcionExistente.planes?.tipo;

    if (plan_id !== undefined) {
      const { data: plan } = await supabaseAdmin.from('planes').select('*').eq('id', plan_id).single();
      if (!plan) return res.status(404).json({ error: 'Plan no encontrado' });
      updates.plan_id = plan_id;
      updates.clases_incluidas = plan.clases_mes;
      planTipo = plan.tipo;
    }

    if (mes !== undefined && año !== undefined) {
      const inicio = new Date(año, mes - 1, 1);
      updates.fecha_inicio = inicio.toISOString().split('T')[0];
      if (planTipo === 'escuelita') {
        const { obtenerUltimoDiaDelMes } = await import('../utils/fechas.js');
        const fin = obtenerUltimoDiaDelMes(inicio);
        updates.fecha_fin = fin.toISOString().split('T')[0];
      } else {
        updates.fecha_fin = null; // Pensiones: indeterminado
      }
    } else if (fecha_inicio) {
      updates.fecha_inicio = fecha_inicio;
    }

    if (clases_incluidas !== undefined) updates.clases_incluidas = clases_incluidas;
    if (clases_usadas !== undefined) updates.clases_usadas = clases_usadas;
    if (activa !== undefined) updates.activa = activa;

    const { data: suscripcion, error } = await supabaseAdmin
      .from('suscripciones')
      .update(updates)
      .eq('id', id)
      .select(`
        *,
        planes:plan_id(*)
      `)
      .single();

    if (error) throw error;

    res.json({ mensaje: 'Suscripción actualizada', suscripcion });
  } catch (error) {
    console.error('Error al editar suscripción:', error);
    res.status(500).json({ error: 'Error al editar suscripción' });
  }
});

// Eliminar suscripción (solo admin)
router.delete('/suscripciones/:id', requireRole('admin'), async (req, res) => {
  try {
    const { id } = req.params;

    const { error } = await supabaseAdmin
      .from('suscripciones')
      .delete()
      .eq('id', id);

    if (error) throw error;

    res.json({ mensaje: 'Suscripción eliminada correctamente' });
  } catch (error) {
    console.error('Error al eliminar suscripción:', error);
    res.status(500).json({ error: 'Error al eliminar suscripción' });
  }
});

// Obtener horarios de un profesor
router.get('/profesores/:id/horarios', requireRole('admin'), async (req, res) => {
  try {
    const { id } = req.params;
    const { data, error } = await supabaseAdmin
      .from('horarios_profesores')
      .select('*')
      .eq('profesor_id', id)
      .eq('activo', true)
      .order('dia_semana', { ascending: true })
      .order('hora_inicio', { ascending: true });

    if (error) throw error;

    res.json(data || []);
  } catch (error) {
    console.error('Error al obtener horarios del profesor:', error);
    res.status(500).json({ error: 'Error al obtener horarios del profesor' });
  }
});

// Crear/Actualizar horarios de un profesor
router.post('/profesores/:id/horarios', requireRole('admin'), async (req, res) => {
  try {
    const { id } = req.params;
    const { horarios } = req.body; // Array de horarios

    if (!horarios || !Array.isArray(horarios)) {
      return res.status(400).json({ error: 'Se requiere un array de horarios' });
    }

    // Validar que el profesor existe
    const { data: profesor } = await supabaseAdmin
      .from('profesores')
      .select('id')
      .eq('id', id)
      .single();

    if (!profesor) {
      return res.status(404).json({ error: 'Profesor no encontrado' });
    }

    // Desactivar horarios existentes
    await supabaseAdmin
      .from('horarios_profesores')
      .update({ activo: false })
      .eq('profesor_id', id);

    // Crear nuevos horarios
    const horariosData = horarios.map((horario) => ({
      profesor_id: id,
      dia_semana: horario.dia_semana,
      hora_inicio: horario.hora_inicio,
      hora_fin: horario.hora_fin,
      activo: true,
    }));

    const { data: nuevosHorarios, error: horariosError } = await supabaseAdmin
      .from('horarios_profesores')
      .insert(horariosData)
      .select();

    if (horariosError) throw horariosError;

    res.json({
      mensaje: 'Horarios actualizados exitosamente',
      horarios: nuevosHorarios,
    });
  } catch (error) {
    console.error('Error al actualizar horarios del profesor:', error);
    res.status(500).json({ error: 'Error al actualizar horarios del profesor' });
  }
});

router.delete('/profesores/:id', requireRole('admin'), async (req, res) => {
  try {
    const { id } = req.params;

    // Verificar si el profesor tiene clases programadas
    const { count } = await supabaseAdmin
      .from('clases')
      .select('*', { count: 'exact', head: true })
      .eq('profesor_id', id)
      .eq('estado', 'programada');

    if (count > 0) {
      return res.status(400).json({
        error: 'No se puede eliminar un profesor con clases programadas',
      });
    }

    // Obtener el user_id antes de eliminar
    const { data: profesor } = await supabaseAdmin
      .from('profesores')
      .select('user_id')
      .eq('id', id)
      .single();

    if (!profesor) {
      return res.status(404).json({ error: 'Profesor no encontrado' });
    }

    // Eliminar profesor
    const { error: profesorError } = await supabaseAdmin
      .from('profesores')
      .delete()
      .eq('id', id);

    if (profesorError) throw profesorError;

    // Eliminar usuario
    const { error: userError } = await supabaseAdmin
      .from('users')
      .delete()
      .eq('id', profesor.user_id);

    if (userError) throw userError;

    res.json({ mensaje: 'Profesor eliminado exitosamente' });
  } catch (error) {
    console.error('Error al eliminar profesor:', error);
    res.status(500).json({ error: 'Error al eliminar profesor' });
  }
});

export default router;
