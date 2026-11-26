const fs = require('fs');
const path = require('path');
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const mongoose = require('mongoose');
const config = require('./config');
const { errorHandler } = require('./middleware');
const { MATERIALS } = require('./lib/catalog');
const { CITIES } = require('./lib/geo');

function createApp() {
  const app = express();
  app.disable('x-powered-by');
  // Render and Vercel sit behind one proxy: needed for correct client IPs in rate limiting
  if (process.env.NODE_ENV === 'production' || process.env.VERCEL) app.set('trust proxy', 1);
  app.use(helmet({
    crossOriginResourcePolicy: { policy: 'cross-origin' },
    contentSecurityPolicy: {
      directives: {
        // photo previews use blob: URLs; uploaded photos may come from Cloudinary
        'img-src': ["'self'", 'data:', 'blob:', 'https://res.cloudinary.com'],
      },
    },
  }));
  app.use(cors({ origin: config.corsOrigin }));
  app.use(express.json({ limit: '200kb' }));
  if (process.env.NODE_ENV !== 'test') app.use(morgan('dev'));

  app.use('/uploads', express.static(config.uploadDir, { maxAge: '7d', fallthrough: false }));

  app.get('/api/health', (_req, res) => res.json({
    status: 'ok', db: mongoose.connection.readyState === 1 ? 'connected' : 'disconnected',
  }));
  app.get('/api/meta', (_req, res) => res.json({
    materials: Object.fromEntries(Object.entries(MATERIALS).map(([k, v]) => [k, { label: v.label, co2PerKg: v.co2PerKg, pricePerKg: v.pricePerKg, scrapPerKg: v.scrapPerKg }])),
    cities: Object.keys(CITIES),
    roles: ['Company', 'Buyer', 'Recycler'],
  }));

  app.use('/api/images', require('./routes/images'));
  app.use('/api/auth', require('./routes/auth'));
  app.use('/api/materials', require('./routes/materials'));
  app.use('/api/ai', require('./routes/ai'));
  app.use('/api/listings', require('./routes/listings'));
  app.use('/api/requests', require('./routes/requests'));
  app.use('/api/analytics', require('./routes/analytics'));
  app.use('/api/admin', require('./routes/admin'));
  app.use('/api/wanted', require('./routes/wanted'));
  app.use('/api/notifications', require('./routes/notifications'));
  app.use('/api/disputes', require('./routes/disputes'));

  app.use('/api', (_req, res) => res.status(404).json({ error: 'Not found' }));

  // Production: serve the built website from the same server (one URL, no CORS).
  const site = process.env.FRONTEND_DIST || path.join(__dirname, '..', '..', 'frontend', 'dist');
  if (fs.existsSync(path.join(site, 'index.html'))) {
    app.use(express.static(site, { index: false, maxAge: '1h' }));
    app.get(/^\/(?!api\/|uploads\/).*/, (_req, res) => res.sendFile(path.join(site, 'index.html')));
  }
  app.use(errorHandler);
  return app;
}

module.exports = { createApp };
