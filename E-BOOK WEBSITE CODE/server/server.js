require('dotenv').config();

const path = require('node:path');
const express = require('express');
const cors = require('cors');
const session = require('express-session');
const MySQLStore = require('express-mysql-session')(session);
const pool = require('./database');
const authRoutes = require('./routes/auth');
const profileRoutes = require('./routes/profile');
const libraryRoutes = require('./routes/library');
const storeRoutes = require('./routes/store');
const adminRoutes = require('./routes/admin');
const { ensureSchema } = require('./schema');

if (!process.env.SESSION_SECRET || process.env.SESSION_SECRET.length < 32) {
  throw new Error('SESSION_SECRET must be set to a random value of at least 32 characters.');
}

const app = express();
const root = path.resolve(__dirname, '..');
const port = Number(process.env.PORT) || 8000;
const production = process.env.NODE_ENV === 'production';

if (production) app.set('trust proxy', 1);
app.disable('x-powered-by');
app.use((request, response, next) => {
  response.setHeader('X-Content-Type-Options', 'nosniff');
  response.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  response.setHeader('X-Frame-Options', 'SAMEORIGIN');
  next();
});
app.use(cors({ origin: process.env.APP_ORIGIN || `http://localhost:${port}`, credentials: true }));
app.use(express.json({ limit: '20kb' }));
app.use(express.urlencoded({ extended: false, limit: '20kb' }));
app.use((request, response, next) => {
  if (!['GET', 'HEAD', 'OPTIONS'].includes(request.method)) {
    const origin = request.get('Origin');
    if (request.get('Sec-Fetch-Site') === 'cross-site' || (origin && origin !== new URL(process.env.APP_ORIGIN || `http://localhost:${port}`).origin)) {
      return response.status(403).json({error:'Request origin is not allowed.'});
    }
  }
  next();
});

const sessionStore = new MySQLStore({
  createDatabaseTable: true,
  schema: { tableName: 'sessions' }
}, pool);

app.use(session({
  name: 'inkframe.sid',
  secret: process.env.SESSION_SECRET,
  store: sessionStore,
  resave: false,
  saveUninitialized: false,
  rolling: true,
  cookie: {
    httpOnly: true,
    secure: production,
    sameSite: 'lax',
    maxAge: 1000 * 60 * 60 * 24 * 7
  }
}));

app.use('/api/auth', authRoutes);
app.use('/api/profile', profileRoutes);
app.use('/api/library', libraryRoutes);
app.use('/api/store', storeRoutes);
app.use('/api/test-checkout', require('./routes/test-checkout'));
app.use('/api/admin', adminRoutes);

app.get(['/library', '/library/'], (request, response) => {
  if (!request.session.userId) return response.redirect('/signin/?next=/library/');
  response.sendFile(path.join(root, 'library', 'index.html'));
});

app.get(['/cart', '/cart/'], (request, response) => {
  if (!request.session.userId) return response.redirect('/signin/?next=/cart/');
  response.sendFile(path.join(root, 'cart', 'index.html'));
});

app.use('/admin', (request, response) => {
  if (!request.session.userId) return response.redirect('/signin/?next=/admin/');
  require('./middleware').requireAdmin(request, response, error => {
    if (error) return response.status(500).send('Unable to check administrator access.');
    response.sendFile(path.join(root, 'admin', 'index.html'));
  });
});

// Serve only explicit public directories; never expose the workspace root.
for (const directory of ['css','js','fonts','images','assets','about','cart','categories','checkout','confirm-signup','contact','ebooks','library','privacy','product','signin','terms','thank-you']) {
  app.use('/'+directory, express.static(path.join(root,directory), {extensions:['html'],index:'index.html',dotfiles:'deny'}));
}
app.get(['/', '/index.html'], (request,response) => response.sendFile(path.join(root,'index.html')));

app.use('/api', (request, response) => response.status(404).json({ error: 'API endpoint not found.' }));
app.use((error, request, response, next) => {
  console.error(error);
  if (response.headersSent) return next(error);
  if (error.type === 'entity.too.large') return response.status(413).json({error:'This upload or request is too large.'});
  response.status(500).json({ error: 'An unexpected server error occurred.' });
});

ensureSchema().then(() => {
  const server = app.listen(port);
  server.once('listening', () => console.log(`Inkframe Press is running at http://localhost:${port}`));
  server.once('error', error => {
    console.error(error.code === 'EADDRINUSE' ? `Port ${port} is already in use. Stop the existing project server before starting this one.` : error);
    process.exit(1);
  });
}).catch((error) => {
  console.error('Database initialization failed:', error);
  process.exit(1);
});
