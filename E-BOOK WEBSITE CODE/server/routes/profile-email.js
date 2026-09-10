const express = require('express');
const bcrypt = require('bcrypt');
const crypto = require('node:crypto');
const pool = require('../database');
const emailService = require('../email');
const { normalizeEmail, isValidEmail, createOtp, regenerateSession } = require('../auth');
const { take, limit } = require('../rate-limit');
const router = express.Router();

router.post('/email/send-otp', limit('email-change-send', 30, 3600), async (req, res, next) => {
  const email = normalizeEmail(req.body.email);
  if (!isValidEmail(email) || email === req.user.email) return res.status(400).json({ error: 'Enter a new, valid email address.' });
  try {
    const [[existing]] = await pool.execute('select id from users where email=?', [email]);
    if (existing) return res.status(409).json({ error: 'This email is already linked to an account.' });
    if (!await take('email-change-cooldown:' + req.user.id, 1, 60) || !await take('email-change-hour:' + req.user.id, 5, 3600)) {
      return res.status(429).json({ error: 'Please wait 60 seconds before resending. You can request up to five codes per hour.' });
    }
    const otp = createOtp(), token = crypto.randomBytes(32).toString('hex');
    const hash = await bcrypt.hash(otp, 12);
    await pool.execute(`insert into email_change_codes(user_id,email,token,otp_hash,expires_at) values (?,?,?,?,date_add(now(),interval 10 minute))
      on duplicate key update email=values(email),token=values(token),otp_hash=values(otp_hash),attempts=0,expires_at=values(expires_at),consumed_at=null`, [req.user.id, email, token, hash]);
    try { await emailService.sendOtpEmail(email, otp, 'EMAIL_CHANGE'); }
    catch (_) {
      await pool.execute('update email_change_codes set consumed_at=now() where user_id=? and token=?', [req.user.id, token]);
      return res.status(502).json({ error: 'The verification email could not be sent. Please try again later.' });
    }
    req.session.emailChangeToken = token;
    res.json({ ok: true, message: 'Code sent to ' + email + '. It expires in 10 minutes.' });
  } catch (error) { next(error); }
});

router.post('/email/verify-otp', limit('email-change-verify', 50), async (req, res, next) => {
  const email = normalizeEmail(req.body.email), otp = String(req.body.otp || '').trim();
  const invalid = () => res.status(400).json({ error: 'The code is incorrect, expired or already used. You have up to five attempts before requesting a new code.' });
  if (!isValidEmail(email) || !/^\d{6}$/.test(otp) || !req.session.emailChangeToken) return invalid();
  let c, version;
  try {
    c = await pool.getConnection();
    await c.beginTransaction();
    const [[user]] = await c.execute('select id,session_version,is_active from users where id=? for update', [req.user.id]);
    if (!user || !user.is_active || user.session_version !== req.user.session_version) { await c.rollback(); return res.status(401).json({ error: 'Please sign in again.' }); }
    const [[record]] = await c.execute('select otp_hash from email_change_codes where user_id=? and email=? and token=? and consumed_at is null and expires_at>now() and attempts<5 for update', [user.id, email, req.session.emailChangeToken]);
    if (!record) { await c.rollback(); return invalid(); }
    await c.execute('update email_change_codes set attempts=attempts+1 where user_id=?', [user.id]);
    if (!await bcrypt.compare(otp, record.otp_hash)) { await c.commit(); return invalid(); }
    await c.execute('update users set email=?,is_verified=1,session_version=session_version+1 where id=?', [email, user.id]);
    await c.execute('update email_change_codes set consumed_at=now() where user_id=?', [user.id]);
    await c.execute('update otp_codes set consumed_at=now() where user_id=? and consumed_at is null', [user.id]);
    await c.execute('update password_reset_grants set consumed_at=now() where user_id=? and consumed_at is null', [user.id]);
    version = user.session_version + 1;
    await c.commit();
    await regenerateSession(req);
    req.session.userId = user.id;
    req.session.email = email;
    req.session.sessionVersion = version;
    res.json({ ok: true, email, message: 'Your email has been verified and updated.' });
  } catch (error) {
    if (c) await c.rollback().catch(() => {});
    if (error.code === 'ER_DUP_ENTRY') return res.status(409).json({ error: 'This email is already linked to an account. Choose another email.' });
    next(error);
  } finally { if (c) c.release(); }
});

module.exports = router;
