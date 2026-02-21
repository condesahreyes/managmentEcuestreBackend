import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import authRoutes from './routes/auth.js';
import clasesRoutes from './routes/clases.js';
import caballosRoutes from './routes/caballos.js';
import profesoresRoutes from './routes/profesores.js';
import planesRoutes from './routes/planes.js';
import suscripcionesRoutes from './routes/suscripciones.js';
import horariosFijosRoutes from './routes/horarios-fijos.js';
import adminRoutes from './routes/admin.js';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3001;

// Middleware
app.use(cors({
  origin: [
    process.env.FRONTEND_USER_URL || 'http://localhost:3000',
    process.env.FRONTEND_ADMIN_URL || 'http://localhost:3002'
  ],
  credentials: true
}));
app.use(express.json());

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Routes
app.use('/api/auth', authRoutes);
app.use('/api/clases', clasesRoutes);
app.use('/api/caballos', caballosRoutes);
app.use('/api/profesores', profesoresRoutes);
app.use('/api/planes', planesRoutes);
app.use('/api/suscripciones', suscripcionesRoutes);
app.use('/api/horarios-fijos', horariosFijosRoutes);
app.use('/api/admin', adminRoutes);

// Error handler
app.use((err, req, res, next) => {
  console.error('Error:', err);
  res.status(500).json({ error: 'Error interno del servidor' });
});

app.listen(PORT, () => {
  console.log(`🚀 Servidor corriendo en http://localhost:${PORT}`);
});
