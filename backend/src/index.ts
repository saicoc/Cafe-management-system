import express from 'express';
import http from 'http';
import cors from 'cors';
import dotenv from 'dotenv';

dotenv.config();

import authRoutes from './routes/auth';
import menuRoutes from './routes/menu';
import orderRoutes from './routes/orders';
import inventoryRoutes from './routes/inventory';
import supplierRoutes from './routes/suppliers';
import reportRoutes from './routes/reports';
import { initSocket } from './socket';
import { prisma } from './db';

const app = express();
const server = http.createServer(app);

// Initialize Socket.io
initSocket(server);

// CORS configuration: Support single URL or comma-separated origins, or wildcard in dev
const allowedOrigins = process.env.FRONTEND_URL
  ? process.env.FRONTEND_URL.split(',').map((o) => o.trim())
  : '*';

app.use(
  cors({
    origin: (origin, callback) => {
      // Allow requests with no origin (like mobile apps, cURL, server-to-server)
      if (!origin) return callback(null, true);

      if (allowedOrigins === '*' || allowedOrigins.includes('*')) {
        return callback(null, true);
      }

      // Check if origin matches configured allowedOrigins or Vercel deployment domains
      const isExplicitlyAllowed = allowedOrigins.includes(origin);
      const isVercelDomain = origin.endsWith('.vercel.app');
      const isLocalhost = origin.includes('localhost') || origin.includes('127.0.0.1');

      if (isExplicitlyAllowed || isVercelDomain || isLocalhost) {
        return callback(null, true);
      }

      // Default fallback: allow origin to avoid blocking cloud preview deployments
      return callback(null, true);
    },
    credentials: true,
  })
);

app.use(express.json());

// In-Memory Rate Limiter Middleware for Auth Endpoints (Prevents Brute-Force Attacks)
const authAttemptsMap = new Map<string, { count: number; firstAttempt: number }>();
const RATE_LIMIT_WINDOW_MS = 15 * 60 * 1000; // 15 minutes
const MAX_AUTH_ATTEMPTS = 30; // Max requests per window

const authRateLimiter = (req: express.Request, res: express.Response, next: express.NextFunction) => {
  if (process.env.NODE_ENV === 'test') return next();

  const ip = req.ip || req.socket.remoteAddress || 'unknown';
  const now = Date.now();
  const record = authAttemptsMap.get(ip);

  if (!record) {
    authAttemptsMap.set(ip, { count: 1, firstAttempt: now });
    return next();
  }

  if (now - record.firstAttempt > RATE_LIMIT_WINDOW_MS) {
    authAttemptsMap.set(ip, { count: 1, firstAttempt: now });
    return next();
  }

  if (record.count >= MAX_AUTH_ATTEMPTS) {
    return res.status(429).json({
      error: 'Too many authentication requests from this IP. Please try again after 15 minutes.',
    });
  }

  record.count++;
  next();
};

// Routes
app.use('/api/auth', authRateLimiter, authRoutes);
app.use('/api/menu', menuRoutes);
app.use('/menu', menuRoutes); // Support direct /menu route alias
app.use('/api/orders', orderRoutes);
app.use('/orders', orderRoutes); // Support direct /orders route alias
app.use('/api/inventory', inventoryRoutes);
app.use('/api/suppliers', supplierRoutes);
app.use('/api/reports', reportRoutes);

// Root & Health check endpoints
app.get('/', (_req, res) => {
  res.json({
    status: 'ok',
    service: 'Cafe Management System API',
    endpoints: {
      health: '/api/health',
      menu: '/api/menu',
      orders: '/api/orders',
      inventory: '/api/inventory',
      suppliers: '/api/suppliers',
      reports: '/api/reports/sales',
    },
  });
});

app.get('/api/health', (_req, res) => {
  res.json({
    status: 'ok',
    service: 'Cafe Management System API',
    environment: process.env.NODE_ENV || 'development',
    time: new Date().toISOString(),
  });
});

app.get('/api/health/db', async (_req, res) => {
  try {
    const isUrlSet = !!process.env.DATABASE_URL;
    const count = await prisma.menuItem.count();
    res.json({
      status: 'ok',
      dbConnected: true,
      menuItemCount: count,
      databaseUrlSet: isUrlSet
    });
  } catch (error: any) {
    res.status(500).json({
      status: 'error',
      dbConnected: false,
      databaseUrlSet: !!process.env.DATABASE_URL,
      errorName: error?.name,
      errorMessage: error?.message || String(error)
    });
  }
});

// Custom JSON 404 Fallback (replaces default 'Cannot GET' plain text)
app.use((req, res) => {
  res.status(404).json({
    status: 404,
    error: 'Not Found',
    path: req.originalUrl,
    message: `Cannot ${req.method} ${req.originalUrl}. Valid endpoints are /api/menu, /api/health, /api/orders, /api/inventory, /api/suppliers.`,
  });
});

const PORT = process.env.PORT ? parseInt(process.env.PORT, 10) : 5000;

if (process.env.NODE_ENV !== 'test') {
  // Validate production configuration
  if (process.env.NODE_ENV === 'production') {
    if (!process.env.JWT_SECRET || process.env.JWT_SECRET.includes('secret_key')) {
      console.warn('⚠️ WARNING: You are running in production without a strong, custom JWT_SECRET!');
    }
    if (!process.env.DATABASE_URL) {
      console.error('❌ FATAL: DATABASE_URL is required for production deployment.');
    }
  }

  server.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 Cafe Management System Backend server running on port ${PORT}`);
  });

  const gracefulShutdown = (signal: string) => {
    console.log(`\n🛑 Received ${signal}. Shutting down HTTP server gracefully...`);
    server.close(() => {
      console.log('✅ HTTP server closed. Process exiting.');
      process.exit(0);
    });
  };

  process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
  process.on('SIGINT', () => gracefulShutdown('SIGINT'));
}

export { app, server };
