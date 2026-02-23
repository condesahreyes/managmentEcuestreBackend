import { supabaseAdmin } from '../config/supabase.js';

/**
 * Verifica si un bucket existe y lo crea si no existe
 */
export async function asegurarBucketExiste(nombreBucket) {
  try {
    // Intentar listar buckets para verificar si existe
    const { data: buckets, error: listError } = await supabaseAdmin.storage.listBuckets();
    
    if (listError) {
      console.error('Error al listar buckets:', listError);
      throw listError;
    }

    const bucketExiste = buckets?.some(b => b.name === nombreBucket);

    if (!bucketExiste) {
      console.log(`Bucket "${nombreBucket}" no existe. Creándolo...`);
      
      // Crear el bucket
      const { data, error: createError } = await supabaseAdmin.storage.createBucket(nombreBucket, {
        public: false, // Privado por defecto
        fileSizeLimit: 10485760, // 10MB
        allowedMimeTypes: ['image/jpeg', 'image/jpg', 'image/png', 'image/webp', 'application/pdf'],
      });

      if (createError) {
        console.error(`Error al crear bucket "${nombreBucket}":`, createError);
        throw createError;
      }

      console.log(`Bucket "${nombreBucket}" creado exitosamente`);
      return { creado: true, bucket: data };
    }

    return { creado: false, bucket: buckets.find(b => b.name === nombreBucket) };
  } catch (error) {
    console.error(`Error al asegurar bucket "${nombreBucket}":`, error);
    throw error;
  }
}

/**
 * Obtiene la URL firmada de un archivo en un bucket privado
 * @param {string} bucket - Nombre del bucket
 * @param {string} filePath - Ruta del archivo (puede incluir o no el nombre del bucket)
 */
export async function obtenerUrlPublica(bucket, filePath) {
  try {
    // Si el filePath incluye el nombre del bucket al inicio, removerlo
    // createSignedUrl espera solo el path relativo dentro del bucket
    let pathRelativo = filePath;
    if (filePath.startsWith(`${bucket}/`)) {
      pathRelativo = filePath.substring(bucket.length + 1);
    }

    const { data, error } = await supabaseAdmin.storage
      .from(bucket)
      .createSignedUrl(pathRelativo, 3600); // URL válida por 1 hora (3600 segundos)

    if (error) {
      console.error('Error al crear URL firmada:', error);
      throw error;
    }

    return data?.signedUrl || null;
  } catch (error) {
    console.error('Error al obtener URL firmada:', error);
    return null;
  }
}
