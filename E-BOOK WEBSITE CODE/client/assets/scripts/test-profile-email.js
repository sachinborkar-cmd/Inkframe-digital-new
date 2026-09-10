require('dotenv').config({quiet:true});
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const express = require('express');
const session = require('express-session');
const pool = require('../../../server/database');
const mail = new Map();
require('../../../server/email').sendOtpEmail = async (email, otp, purpose) => { mail.set(email, {otp, purpose}); };
const app = express();
app.use(express.json());
app.use(session({secret:crypto.randomBytes(32).toString('hex'),resave:false,saveUninitialized:false}));
app.use('/auth', require('../../../server/routes/auth'));
app.use('/profile', require('../../../server/routes/profile'));
let server, userId;
const email = 'profile-' + crypto.randomUUID() + '@example.invalid';
const replacement = 'new-' + email;
(async () => {
  try {
    await require('../../../server/schema').ensureSchema();
    server = await new Promise(resolve => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
    const origin = 'http://127.0.0.1:' + server.address().port;
    function client() {
      let cookie = '';
      return async (path, body) => {
        const r = await fetch(origin + path, {method:body?'POST':'GET',headers:{'Content-Type':'application/json',cookie},body:body?JSON.stringify(body):undefined});
        if (r.headers.get('set-cookie')) cookie = r.headers.get('set-cookie').split(';')[0];
        return {status:r.status,body:await r.json()};
      };
    }
    const account = client(), guest = client();
    assert.equal((await guest('/profile/email/send-otp', {email:replacement})).status, 401);
    assert.equal((await account('/auth/send-otp', {email,full_name:'Email Test'})).status, 200);
    const [[user]] = await pool.execute('select id from users where email=?', [email]); userId = user.id;
    assert.equal((await account('/auth/verify-otp', {email,otp:mail.get(email).otp})).status, 200);
    assert.equal((await account('/profile/email/send-otp', {email})).status, 400);
    assert.equal((await account('/profile/email/send-otp', {email:replacement})).status, 200);
    assert.equal(mail.get(replacement).purpose, 'EMAIL_CHANGE');
    assert.equal((await account('/profile')).body.profile.email, email);
    assert.equal((await account('/profile/email/send-otp', {email:replacement})).status, 429);
    const otp = mail.get(replacement).otp;
    const wrong = otp === '000000' ? '111111' : '000000';
    assert.equal((await account('/profile/email/verify-otp', {email:replacement,otp:wrong})).status, 400);
    await pool.execute('update email_change_codes set expires_at=date_sub(now(),interval 1 minute) where user_id=?', [userId]);
    assert.equal((await account('/profile/email/verify-otp', {email:replacement,otp})).status, 400);
    await pool.execute('update email_change_codes set expires_at=date_add(now(),interval 10 minute),attempts=5 where user_id=?', [userId]);
    assert.equal((await account('/profile/email/verify-otp', {email:replacement,otp})).status, 400);
    await pool.execute('update email_change_codes set attempts=0 where user_id=?', [userId]);
    assert.equal((await account('/profile/email/verify-otp', {email:replacement,otp})).status, 200);
    assert.equal((await account('/profile')).body.profile.email, replacement);
    assert.equal((await account('/profile/email/verify-otp', {email:replacement,otp})).status, 400);
    const [[saved]] = await pool.execute('select id from users where email=?', [replacement]);
    assert.equal(saved.id, userId);
    console.log('Profile email tests passed: authentication, cooldown, invalid/expired/exhausted OTPs, verification, replay, account preservation.');
  } finally {
    if (userId) await pool.execute('delete from users where id=?', [userId]);
    if (server) await new Promise(resolve => server.close(resolve));
    await pool.end();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
