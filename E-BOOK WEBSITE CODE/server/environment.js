function validateEnvironment(env = process.env) {
  if (!env.SESSION_SECRET || env.SESSION_SECRET.length < 32) {
    throw new Error('SESSION_SECRET must be set to a random value of at least 32 characters.');
  }
  if (env.PORT !== undefined && env.PORT !== '') {
    if (!/^\d+$/.test(env.PORT) || Number(env.PORT) < 1 || Number(env.PORT) > 65535) {
      throw new Error('Invalid PORT environment variable.');
    }
  }
  if (env.NODE_ENV !== 'production') return;

  // Required core database and origin variables
  for (const name of ['DB_HOST', 'DB_PORT', 'DB_USER', 'DB_PASSWORD', 'DB_NAME', 'APP_ORIGIN', 'GOOGLE_CLIENT_ID']) {
    if (!env[name] || !String(env[name]).trim()) {
      throw new Error(`Missing required production environment variable: ${name}`);
    }
  }

  if (!/^\d+$/.test(env.DB_PORT) || Number(env.DB_PORT) < 1 || Number(env.DB_PORT) > 65535) {
    throw new Error('Invalid production environment variable: DB_PORT');
  }

  let origin;
  try { origin = new URL(env.APP_ORIGIN); } catch {
    throw new Error('APP_ORIGIN must be an HTTPS origin in production.');
  }
  if (origin.protocol !== 'https:' || origin.origin !== env.APP_ORIGIN) {
    throw new Error('APP_ORIGIN must be an HTTPS origin without a path in production.');
  }

  if (!/^[0-9]+-[a-z0-9_.-]+\.apps\.googleusercontent\.com$/i.test(env.GOOGLE_CLIENT_ID)) {
    throw new Error('GOOGLE_CLIENT_ID must be configured for production.');
  }

  if (env.TEST_PAYMENTS_ENABLED === 'true') {
    throw new Error('TEST_PAYMENTS_ENABLED must be false in production.');
  }

  // Email service validation: either Resend API key or full SMTP credentials
  const hasResend = Boolean(env.RESEND_API_KEY && String(env.RESEND_API_KEY).trim());
  const hasSmtp = Boolean(env.SMTP_HOST && env.SMTP_USER && env.SMTP_PASSWORD);

  if (hasResend) {
    if (String(env.RESEND_API_KEY).trim().length < 8) {
      throw new Error('Invalid production environment variable: RESEND_API_KEY must be a valid API key.');
    }
  } else if (hasSmtp) {
    for (const name of ['SMTP_HOST', 'SMTP_PORT', 'SMTP_USER', 'SMTP_PASSWORD']) {
      if (!env[name] || !String(env[name]).trim()) {
        throw new Error(`Missing required production environment variable: ${name}`);
      }
    }
    if (!/^\d+$/.test(env.SMTP_PORT) || Number(env.SMTP_PORT) < 1 || Number(env.SMTP_PORT) > 65535) {
      throw new Error('Invalid production environment variable: SMTP_PORT');
    }
  } else {
    throw new Error('Missing required email configuration: provide RESEND_API_KEY or complete SMTP credentials (SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASSWORD).');
  }

  // Razorpay validation (when configured for live payments)
  const hasRazorpayKey = Boolean(env.RAZORPAY_KEY_ID && String(env.RAZORPAY_KEY_ID).trim());
  const hasRazorpaySecret = Boolean(env.RAZORPAY_KEY_SECRET && String(env.RAZORPAY_KEY_SECRET).trim());
  if (hasRazorpayKey || hasRazorpaySecret) {
    if (!hasRazorpayKey || !hasRazorpaySecret) {
      throw new Error('Both RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET are required when Razorpay is enabled.');
    }
    if (!/^rzp_(live|test)_[a-zA-Z0-9]+$/.test(String(env.RAZORPAY_KEY_ID).trim())) {
      throw new Error('Invalid production environment variable: RAZORPAY_KEY_ID format is invalid.');
    }
    if (String(env.RAZORPAY_KEY_SECRET).trim().length < 8) {
      throw new Error('Invalid production environment variable: RAZORPAY_KEY_SECRET is too short.');
    }
  }

  // AWS S3 validation (when configured for private eBook storage)
  const s3Vars = ['AWS_ACCESS_KEY_ID', 'AWS_SECRET_ACCESS_KEY', 'AWS_REGION', 'AWS_S3_BUCKET'];
  const configuredS3 = s3Vars.filter(name => env[name] && String(env[name]).trim());
  if (configuredS3.length > 0 && configuredS3.length < s3Vars.length) {
    const missing = s3Vars.filter(name => !env[name] || !String(env[name]).trim());
    throw new Error(`Incomplete AWS S3 configuration. Missing variables: ${missing.join(', ')}`);
  }
}

module.exports = { validateEnvironment };
