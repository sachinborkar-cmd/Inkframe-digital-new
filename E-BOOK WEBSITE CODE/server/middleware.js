function requireAuth(request, response, next) {
  if (!request.session || !request.session.userId) {
    return response.status(401).json({ error: 'Authentication required.' });
  }
  next();
}

async function adminAccess(userId) {
    if (!userId) return {isOwner:false,isAdmin:false};
    const pool = require('./database');
    const [[user]] = await pool.execute('select email,is_verified from users where id=?', [userId]);
    const owner = String(process.env.ADMIN_EMAIL || '').trim().toLowerCase();
    const email = user && user.email.toLowerCase();
    const isOwner = Boolean(owner && email === owner && user.is_verified);
    let member = false;
    if (user && user.is_verified && !isOwner) {
      const [rows] = await pool.execute('select email from admin_members where email=?', [email]);
      member = rows.length > 0;
    }
    return {isOwner,isAdmin:isOwner||member};
}
async function requireAdmin(request, response, next) {
  if (!request.session || !request.session.userId) return response.status(401).json({ error: 'Authentication required.' });
  try {
    const access = await adminAccess(request.session.userId);
    request.isOwner = access.isOwner;
    if (!access.isAdmin) return response.status(403).json({ error: 'Administrator access required.' });
    response.setHeader('Cache-Control', 'no-store');
    next();
  } catch(error) { next(error); }
}

module.exports = { requireAuth, requireAdmin, adminAccess };
