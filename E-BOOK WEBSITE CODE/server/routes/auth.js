const express = require('express');
const bcrypt = require('bcrypt');
const { OAuth2Client } = require('google-auth-library');
const pool = require('../database');
const { sendOtpEmail } = require('../email');
const { normalizeEmail, isValidEmail, createOtp, regenerateSession, destroySession } = require('../auth');

const router = express.Router();
const OTP_TTL_MINUTES = 10;
const OTP_COOLDOWN_SECONDS = 60;
const OTP_HOURLY_LIMIT = 5;
const MAX_VERIFY_ATTEMPTS = 5;
const googleClient = new OAuth2Client();
function googleClientId() {
  const value = String(process.env.GOOGLE_CLIENT_ID || '').trim();
  return /^[0-9]+-[a-z0-9]+\.apps\.googleusercontent\.com$/i.test(value) ? value : '';
}

router.post('/send-otp', async (request, response, next) => {
  const email = normalizeEmail(request.body.email);
  const fullName = String(request.body.full_name || '').trim();
  if (!isValidEmail(email)) return response.status(400).json({ error: 'Enter a valid email address.' });
  if (fullName.length < 2 || fullName.length > 120) return response.status(400).json({ error: 'Enter your full name.' });

  let connection;
  let otpId;
  try {
    connection = await pool.getConnection();
    await connection.beginTransaction();

    await connection.execute(
      'insert into users (email) values (?) on duplicate key update email = values(email)',
      [email]
    );
    const [users] = await connection.execute('select id from users where email = ? limit 1', [email]);
    const userId = users[0].id;

    const [recent] = await connection.execute(
      'select created_at from otp_codes where user_id = ? order by created_at desc limit 1',
      [userId]
    );
    if (recent.length && Date.now() - new Date(recent[0].created_at).getTime() < OTP_COOLDOWN_SECONDS * 1000) {
      await connection.rollback();
      return response.status(429).json({ error: 'Please wait 60 seconds before requesting another code.' });
    }

    const [hourly] = await connection.execute(
      'select count(*) as total from otp_codes where user_id = ? and created_at >= date_sub(now(), interval 1 hour)',
      [userId]
    );
    if (Number(hourly[0].total) >= OTP_HOURLY_LIMIT) {
      await connection.rollback();
      return response.status(429).json({ error: 'Too many codes requested. Please try again in one hour.' });
    }

    const otp = createOtp();
    const otpHash = await bcrypt.hash(otp, 10);
    await connection.execute('update otp_codes set consumed_at = now() where user_id = ? and consumed_at is null', [userId]);
    const [insert] = await connection.execute(
      'insert into otp_codes (user_id, otp_hash, expires_at) values (?, ?, date_add(now(), interval ? minute))',
      [userId, otpHash, OTP_TTL_MINUTES]
    );
    otpId = insert.insertId;
    await connection.commit();

    try {
      await sendOtpEmail(email, otp);
    } catch (emailError) {
      await pool.execute('delete from otp_codes where id = ?', [otpId]);
      console.error('OTP email delivery failed:', emailError.message);
      return response.status(502).json({ error: 'The verification email could not be sent. Please try again later.' });
    }

    request.session.pendingOtpEmail = email;
    request.session.pendingFullName = fullName;

    response.json({ ok: true, message: 'A verification code has been sent if the address can receive email.' });
  } catch (error) {
    if (connection) await connection.rollback().catch(() => {});
    next(error);
  } finally {
    if (connection) connection.release();
  }
});

router.post('/verify-otp', async (request, response, next) => {
  const email = normalizeEmail(request.body.email);
  const otp = String(request.body.otp || '').trim();
  if (!isValidEmail(email) || !/^\d{6}$/.test(otp)) {
    return response.status(400).json({ error: 'Enter a valid email and six-digit code.' });
  }
  if (!request.session || request.session.pendingOtpEmail !== email) {
    return response.status(400).json({ error: 'Request a new verification code for this email address.' });
  }

  try {
    const [rows] = await pool.execute(
      `select o.id, o.otp_hash, o.expires_at, o.attempts, u.id as user_id
       from otp_codes o join users u on u.id = o.user_id
       where u.email = ? and o.consumed_at is null
       order by o.created_at desc limit 1`,
      [email]
    );
    if (!rows.length) return response.status(400).json({ error: 'The verification code is invalid or already used.' });

    const record = rows[0];
    if (record.attempts >= MAX_VERIFY_ATTEMPTS) {
      return response.status(429).json({ error: 'Too many incorrect attempts. Request a new code.' });
    }
    if (new Date(record.expires_at).getTime() <= Date.now()) {
      await pool.execute('update otp_codes set consumed_at = now() where id = ?', [record.id]);
      return response.status(400).json({ error: 'This code has expired. Request a new one.' });
    }

    const matches = await bcrypt.compare(otp, record.otp_hash);
    if (!matches) {
      await pool.execute('update otp_codes set attempts = attempts + 1 where id = ?', [record.id]);
      return response.status(400).json({ error: 'The verification code is incorrect.' });
    }

    const pendingFullName = String(request.session.pendingFullName || '').trim();
    const connection = await pool.getConnection();
    try {
      await connection.beginTransaction();
      const [consumed] = await connection.execute('update otp_codes set consumed_at = now() where id = ? and consumed_at is null and expires_at > now() and attempts < ?', [record.id, MAX_VERIFY_ATTEMPTS]);
      if (!consumed.affectedRows) {
        await connection.rollback();
        return response.status(400).json({error:'This verification code has expired or was already used. Request a new code.'});
      }
      await connection.execute('update users set is_verified = true where id = ?', [record.user_id]);
      if (pendingFullName) {
        await connection.execute(
          `insert into profiles (user_id, full_name, mobile) values (?, ?, '')
           on duplicate key update user_id = values(user_id)`,
          [record.user_id, pendingFullName]
        );
      }
      await connection.commit();
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }

    await regenerateSession(request);
    request.session.userId = record.user_id;
    request.session.email = email;
    request.session.isAdmin = email === String(process.env.ADMIN_EMAIL || '').trim().toLowerCase();
    response.json({ ok: true, redirect: '/library/' });
  } catch (error) {
    next(error);
  }
});

router.get('/google-config', (request, response) => {
  const clientId = googleClientId();
  response.setHeader('Cache-Control', 'no-store');
  if (clientId && !request.session.googleNonce) request.session.googleNonce = require('node:crypto').randomBytes(32).toString('hex');
  response.json({ enabled: Boolean(clientId), clientId: clientId || null, nonce: clientId ? request.session.googleNonce : null });
});

router.post('/google', async (request, response, next) => {
  const clientId = googleClientId();
  if (!clientId) return response.status(503).json({ error: 'Google sign-in is not configured.' });
  const credential = String(request.body.credential || '');
  if (!credential) return response.status(400).json({ error: 'Google credential is required.' });
  try {
    let ticket;
    try {
      ticket = await googleClient.verifyIdToken({ idToken: credential, audience: clientId });
    } catch (error) {
      return response.status(401).json({ error: 'Google sign-in could not be verified. Please try again.' });
    }
    const payload = ticket.getPayload();
    if (!request.session.googleNonce || !payload || payload.nonce !== request.session.googleNonce) return response.status(401).json({ error: 'Reload the sign-in page and try Google sign-in again.' });
    const email = normalizeEmail(payload && payload.email);
    const fullName = String(payload && payload.name || email.split('@')[0]).trim().slice(0, 120);
    if (!payload || !payload.email_verified || !isValidEmail(email)) return response.status(401).json({ error: 'Google did not provide a verified email address.' });
    const connection = await pool.getConnection();
    let userId;
    try {
      await connection.beginTransaction();
      await connection.execute('insert into users (email, is_verified) values (?, true) on duplicate key update is_verified = true', [email]);
      const [users] = await connection.execute('select id from users where email = ? limit 1', [email]);
      userId = users[0].id;
      await connection.execute(`insert into profiles (user_id, full_name, mobile) values (?, ?, '') on duplicate key update user_id = values(user_id)`, [userId, fullName]);
      await connection.commit();
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
    await regenerateSession(request);
    request.session.userId = userId;
    request.session.email = email;
    request.session.isAdmin = email === String(process.env.ADMIN_EMAIL || '').trim().toLowerCase();
    response.json({ ok: true, redirect: '/library/' });
  } catch (error) {
    if (/token|audience|recipient/i.test(error.message)) return response.status(401).json({ error: 'Google sign-in could not be verified. Please try again.' });
    next(error);
  }
});

router.get('/session', async (request, response, next) => {
  response.setHeader('Cache-Control', 'no-store');
  try {
    const access = await require('../middleware').adminAccess(request.session && request.session.userId);
    response.json({ authenticated: Boolean(request.session && request.session.userId), isAdmin:access.isAdmin, email: request.session && request.session.email || null });
  } catch(error) { next(error); }
});

router.post('/logout', async (request, response, next) => {
  try {
    await destroySession(request);
    response.clearCookie('inkframe.sid');
    response.json({ ok: true });
  } catch (error) {
    next(error);
  }
});

module.exports = router;
