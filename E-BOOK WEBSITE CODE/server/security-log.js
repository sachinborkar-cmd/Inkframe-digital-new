// Only fixed event names, route templates, status and the verified actor ID.
// Never serialize request bodies, URLs, query strings, headers or error objects.
// Use the process-wide console so operational tooling and tests can observe
// the same structured events.  The event payload below deliberately excludes
// request input, headers and error objects.
const logger = global.console;
let testSink = null;
function securityLog(req, res, next) {
  res.once('finish', () => {
    const base = /^\/(?:api\/(?:auth|library|admin|profile|store|test-checkout)|admin)(?=\/|\?|$)/.exec(req.originalUrl || '')?.[0] || '';
    const route = typeof req.route?.path === 'string' ? req.route.path : base;
    if (!base) return;
    let event;
    if (base.startsWith('/api/auth') && res.statusCode >= 400) event = 'authentication_failed';
    else if (base.startsWith('/api/library') && res.statusCode >= 400) event = 'library_access_denied';
    else if ([401,403].includes(res.statusCode)) event = 'permission_denied';
    else if (base.startsWith('/api/admin') && !['GET','HEAD','OPTIONS'].includes(req.method)) event = 'admin_action';
    if (event) {
      const entry = {time:new Date().toISOString(),event,method:req.method,
        route, status:res.statusCode, actor:Number.isSafeInteger(req.user?.id)?req.user.id:null};
      // A test-only sink permits assertions without intercepting production
      // logging. It never reads or emits untrusted request data.
      if (process.env.NODE_ENV === 'test' && typeof testSink === 'function') testSink(entry);
      else logger.info(JSON.stringify(entry));
    }
  });
  next();
}
function setTestSink(sink) { testSink = sink; }
module.exports = { securityLog, setTestSink };
