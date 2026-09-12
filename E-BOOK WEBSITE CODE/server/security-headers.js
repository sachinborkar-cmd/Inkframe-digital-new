const { createHash } = require('node:crypto');

// The only inline script in the exported pages updates the footer year.
const footerHash = createHash('sha256').update("document.getElementById('yr').textContent=new Date().getFullYear()").digest('base64');
const csp = [
  "default-src 'self'",
  `script-src 'self' 'sha256-${footerHash}' https://accounts.google.com/gsi/client`,
  "script-src-attr 'none'",
  // Existing exported pages, Tailwind and admin charts use inline styles.
  "style-src 'self' 'unsafe-inline' https://accounts.google.com/gsi/style",
  "font-src 'self'",
  "img-src 'self' data: blob:",
  "connect-src 'self' https://accounts.google.com/gsi/",
  "frame-src 'self' https://accounts.google.com/gsi/",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'self'"
].join('; ');

function securityHeaders(request, response, next) {
  response.setHeader('X-Content-Type-Options', 'nosniff');
  response.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  response.setHeader('X-Frame-Options', 'SAMEORIGIN');
  response.setHeader('Content-Security-Policy', csp);
  response.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  if (process.env.NODE_ENV === 'production') {
    response.setHeader('Strict-Transport-Security', 'max-age=31536000');
  }
  next();
}
module.exports = { securityHeaders, csp };
