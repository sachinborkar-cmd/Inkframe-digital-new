const express = require('express');
const pool = require('../database');
const { requireAuth } = require('../middleware');

const router = express.Router();
router.use(requireAuth);
router.use((request, response, next) => { response.setHeader('Cache-Control', 'no-store'); next(); });

router.get('/', async (request, response, next) => {
  try {
    const [rows] = await pool.execute(
      `select u.email, p.full_name, p.mobile, p.updated_at
       from users u left join profiles p on p.user_id = u.id where u.id = ? limit 1`,
      [request.session.userId]
    );
    if (!rows.length) return response.status(404).json({ error: 'Account not found.' });
    response.json({ profile: rows[0] });
  } catch (error) {
    next(error);
  }
});

async function saveProfile(request, response, next) {
  const fullName = String(request.body.full_name || '').trim();
  const mobile = String(request.body.mobile || '').trim();
  if (fullName.length < 2 || fullName.length > 120) {
    return response.status(400).json({ error: 'Full name must contain 2 to 120 characters.' });
  }
  if (mobile && !/^[0-9+() -]{7,24}$/.test(mobile)) {
    return response.status(400).json({ error: 'Enter a valid mobile number or leave it blank.' });
  }
  try {
    await pool.execute(
      `insert into profiles (user_id, full_name, mobile) values (?, ?, ?)
       on duplicate key update full_name = values(full_name), mobile = values(mobile), updated_at = now()`,
      [request.session.userId, fullName, mobile]
    );
    response.json({ ok: true, profile: { full_name: fullName, mobile, email: request.session.email } });
  } catch (error) {
    next(error);
  }
}

router.post('/', saveProfile);
router.put('/', saveProfile);

module.exports = router;
