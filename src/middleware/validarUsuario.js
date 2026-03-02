import { supabaseAdmin } from '../config/supabase.js';

/**
 * Middleware para validar que usuarios de pensión/media pensión tengan caballo y suscripción
 */
export const validarUsuarioCompleto = async (req, res, next) => {
  try {
    // Solo aplica a usuarios de pensión completa y media pensión
    if (!['pension_completa', 'media_pension'].includes(req.user.rol)) {
      return next();
    }

    // Verificar si tiene caballo asignado
    const { data: caballo, error } = await supabaseAdmin
      .from('caballos')
      .select('id')
      .or(`dueno_id.eq.${req.user.id},dueno_id2.eq.${req.user.id}`)
      .eq('activo', true)
      .single();

    // Verificar si tiene suscripción activa
    const { data: suscripcion } = await supabaseAdmin
      .from('suscripciones')
      .select('id')
      .eq('user_id', req.user.id)
      .eq('activa', true)
      .single();

    if (!caballo || !suscripcion) {
      console.log("holaaa")
      console.log({caballo, suscripcion})
      return res.status(403).json({
        error: 'PENDIENTE_APROBACION',
        mensaje: 'Tu cuenta está pendiente de aprobación. El administrador debe asignarte un caballo y una suscripción para poder usar la aplicación.',
        tiene_caballo: !!caballo,
        tiene_suscripcion: !!suscripcion,
      });
    }

    // Agregar información del caballo al request
    req.caballoAsignado = caballo;
    next();
  } catch (error) {
    console.error('Error al validar usuario:', error);
    next();
  }
};
