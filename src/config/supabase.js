import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

dotenv.config();

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_KEY;
const supabaseAnonKey = process.env.SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseServiceKey || !supabaseAnonKey) {
  throw new Error('Missing Supabase environment variables');
}

// Cliente con permisos de servicio (para operaciones admin)
export const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);

// Cliente con permisos anónimos (para operaciones del usuario)
export const supabaseClient = createClient(supabaseUrl, supabaseAnonKey);

export default supabaseAdmin;
