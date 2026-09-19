require('dotenv').config({quiet:true});
require('./environment').validateEnvironment();

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
const root = path.resolve(__dirname, '..', 'client');
const port = Number(process.env.PORT) || 8000;
const production = process.env.NODE_ENV === 'production';

if (production) app.set('trust proxy', 1);
app.disable('x-powered-by');
app.use(require('./security-headers').securityHeaders);
app.use(require('./security-log').securityLog);
app.use(cors({ origin: process.env.APP_ORIGIN || `http://localhost:${port}`, credentials: true }));
app.use('/api/admin/products', express.json({ limit: '128kb' }));
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
app.use('/api/admin/analytics', require('./routes/analytics'));
app.get('/api/payments/config',(req,res)=>res.json({live_enabled:false,test_enabled:require('./purchase-access').testEnabled()}));

app.get(['/library', '/library/'], (request, response) => {
  if (!request.session.userId) return response.redirect('/signin/?next=/library/');
    response.sendFile(path.join(root, 'library', 'index.html'));
});

app.get(['/cart', '/cart/'], (request, response) => {
  if (!request.session.userId) return response.redirect('/signin/?next=/cart/');
  response.sendFile(path.join(root, 'pages', 'cart', 'index.html'));
});

app.use('/admin', (request, response) => {
  if (!request.session.userId) return response.redirect('/signin/?next=/admin/');
  require('./middleware').requireAdmin(request, response, error => {
    if (error) return response.status(500).send('Unable to check administrator access.');
    response.sendFile(path.join(root, 'pages', 'admin', 'index.html'));
  });
});

// Serve only explicit public directories; never expose the workspace root.
for (const directory of ['css','js','fonts','images','uploads']) {
  if(directory==='uploads')app.use('/assets/uploads',async(request,response,next)=>{
    try{
      let pathname;try{pathname=decodeURIComponent(request.path);}catch{return response.status(400).json({error:'Invalid sample URL.'});}
      if(!pathname.toLowerCase().endsWith('.pdf'))return next();
      const sample='/assets/uploads/'+path.basename(pathname);
      const [[book]]=await pool.execute("select id from ebooks where sample_path=? and status='published' limit 1",[sample]);
      if(!book||!await require('./sample-files').safeSample(sample))return response.status(404).json({error:'Sample not available.'});
      next();
    }catch(error){next(error);}
  });
  const files = express.static(path.join(root, 'assets', directory), {dotfiles:'deny'});
  app.use('/assets/'+directory, files);
  // Preserve older URLs used by saved book records and existing links.
  if (directory !== 'uploads') app.use('/'+directory, files);
}
for (const directory of ['about','cart','categories','checkout','confirm-signup','contact','forgot-password','privacy','product','signin','terms','thank-you']) {
  app.use('/'+directory, express.static(path.join(root,'pages',directory), {extensions:['html'],index:'index.html',dotfiles:'deny'}));
}
app.get(['/ebooks/fitness-for-busy-professionals','/ebooks/fitness-for-busy-professionals/','/ebooks/fitness-for-busy-professionals/index.html'], (request,response) => response.redirect('/product/?slug=fitness-for-busy-professionals'));
for (const directory of ['ebooks','library']) {
  app.use('/'+directory, express.static(path.join(root,directory), {extensions:['html'],index:'index.html',dotfiles:'deny'}));
}
app.get(['/', '/index.html'], (request,response) => response.sendFile(path.join(root,'index.html')));

app.use('/api', (request, response) => response.status(404).json({ error: 'API endpoint not found.' }));
app.use((error, request, response, next) => {
  console.error('Request failed:', error.code || error.type || 'internal_error');
  if (response.headersSent) return next(error);
  if (error.type === 'entity.too.large') return response.status(413).json({error:'This upload or request is too large.'});
  if (error.type === 'entity.parse.failed' || error instanceof URIError) return response.status(400).json({error:'Malformed request.'});
  response.status(500).json({ error: 'An unexpected server error occurred.' });
});

if (require.main === module) ensureSchema().then(() => {
  const server = app.listen(port);
  server.once('listening', () => {
    console.log(`Inkframe Press is running at http://localhost:${port}`);
    const stopDeliveryRetries = require('./book-delivery').startDeliveryRetries();
    server.once('close', stopDeliveryRetries);
  });
  server.once('error', error => {
    console.error(error.code === 'EADDRINUSE' ? `Port ${port} is already in use. Stop the existing project server before starting this one.` : 'Server startup failed.');
    process.exit(1);
  });
}).catch((error) => {
  console.error('Database initialization failed:', error);
  process.exit(1);
});

module.exports = { app, sessionStore };
