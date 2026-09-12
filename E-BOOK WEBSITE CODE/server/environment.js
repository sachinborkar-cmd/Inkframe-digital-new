function validateEnvironment(env = process.env) {
  if (!env.SESSION_SECRET || env.SESSION_SECRET.length < 32) {
    throw new Error('SESSION_SECRET must be set to a random value of at least 32 characters.');
  }
  if (env.NODE_ENV !== 'production') return;
  for (const name of ['DB_HOST', 'DB_PORT', 'DB_USER', 'DB_PASSWORD', 'DB_NAME',
    'SMTP_HOST', 'SMTP_PORT', 'SMTP_USER', 'SMTP_PASSWORD', 'APP_ORIGIN', 'GOOGLE_CLIENT_ID']) {
    if (!env[name] || !env[name].trim()) throw new Error(`Missing required production environment variable: ${name}`);
  }
  for (const name of ['DB_PORT', 'SMTP_PORT']) {
    if (!/^\d+$/.test(env[name]) || Number(env[name]) < 1 || Number(env[name]) > 65535) {
      throw new Error(`Invalid production environment variable: ${name}`);
    }
  }
  let origin;
  try { origin = new URL(env.APP_ORIGIN); } catch { throw new Error('APP_ORIGIN must be an HTTPS origin in production.'); }
  if (origin.protocol !== 'https:' || origin.origin !== env.APP_ORIGIN) {
    throw new Error('APP_ORIGIN must be an HTTPS origin without a path in production.');
  }
  if (!/^[0-9]+-[a-z0-9]+\.apps\.googleusercontent\.com$/i.test(env.GOOGLE_CLIENT_ID)) {
    throw new Error('GOOGLE_CLIENT_ID must be configured for production.');
  }
  if (env.TEST_PAYMENTS_ENABLED === 'true') throw new Error('TEST_PAYMENTS_ENABLED must be false in production.');
}
module.exports = { validateEnvironment };
