const express=require('express');
const bcrypt=require('bcrypt');
const crypto=require('node:crypto');
const pool=require('../database');
const emailService=require('../email');
const {normalizeEmail,isValidEmail,createOtp,regenerateSession,destroySession}=require('../auth');
const {take,limit}=require('../rate-limit');
const router=express.Router();
const wrap=fn=>async(req,res,next)=>{try{await fn(req,res);}catch(e){next(e);}};
const digest=value=>crypto.createHash('sha256').update(value).digest('hex');
const dummy=bcrypt.hash(crypto.randomBytes(32).toString('hex'),12);
const generic={ok:true,message:'If this account is eligible, a reset code will be sent. Please wait 60 seconds before resending.'};
router.use((req,res,next)=>{res.setHeader('Cache-Control','no-store');next();});
router.post('/login',limit('password-login',50),wrap(async(req,res)=>{
  const email=normalizeEmail(req.body.email),password=req.body.password;
  if(!isValidEmail(email)||typeof password!=='string'||Buffer.byteLength(password)>72)return res.status(401).json({error:'Email or password is incorrect.'});
  if(!await take('login-email:'+email,10,900))return res.status(429).json({error:'Too many attempts. Please try again later.'});
  const [[user]]=await pool.execute('select id,email,password_hash,is_verified,is_active,session_version from users where email=?',[email]);
  const matches=await bcrypt.compare(password,user?.password_hash||await dummy);
  if(!matches||!user?.password_hash||!user.is_verified||!user.is_active)return res.status(401).json({error:'Email or password is incorrect.'});
  await regenerateSession(req);req.session.userId=user.id;req.session.email=user.email;req.session.sessionVersion=user.session_version;
  res.json({ok:true,redirect:'/library/'});
}));
router.post('/forgot-password',limit('password-reset-send',30,3600),wrap(async(req,res)=>{
  const email=normalizeEmail(req.body.email);
  if(!isValidEmail(email))return res.status(400).json({error:'Enter a valid email address.'});
  const cooldown=await take('reset-cooldown:'+email,1,60),hourly=await take('reset-hour:'+email,5,3600);
  if(!cooldown||!hourly)return res.json(generic);
  const otp=createOtp(),hash=await bcrypt.hash(otp,12),c=await pool.getConnection();let otpId;
  try{
    await c.beginTransaction();
    const [[user]]=await c.execute('select id from users where email=? and is_verified=1 and is_active=1 for update',[email]);
    if(user){
      await c.execute("update otp_codes set consumed_at=now() where user_id=? and purpose='PASSWORD_RESET' and consumed_at is null",[user.id]);
      const [r]=await c.execute("insert into otp_codes(user_id,otp_hash,purpose,expires_at) values (?,?,'PASSWORD_RESET',date_add(now(),interval 10 minute))",[user.id,hash]);otpId=r.insertId;
    }
    await c.commit();
  }catch(e){await c.rollback();throw e;}finally{c.release();}
  res.json(generic);
  // SMTP runs after the generic response, so response timing does not reveal account existence.
  if(otpId)emailService.sendOtpEmail(email,otp,'PASSWORD_RESET').catch(async()=>{
    console.error('Password reset email delivery failed.');
    await pool.execute('update otp_codes set consumed_at=now() where id=?',[otpId]).catch(()=>{});
  });
}));
router.post('/verify-reset-otp',limit('password-reset-verify',50),wrap(async(req,res)=>{
  const email=normalizeEmail(req.body.email),otp=String(req.body.otp||'');
  const invalid=()=>res.status(400).json({error:'The code is invalid, expired or already used. Request a new code.'});
  if(!isValidEmail(email)||!/^\d{6}$/.test(otp))return invalid();
  if(!await take('reset-verify:'+email,15,900))return res.status(429).json({error:'Too many attempts. Please try again later.'});
  const c=await pool.getConnection();let token;
  try{
    await c.beginTransaction();
    const [[u]]=await c.execute('select id from users where email=? and is_active=1 and is_verified=1 for update',[email]);
    const [rows]=u?await c.execute("select id,otp_hash from otp_codes where user_id=? and purpose='PASSWORD_RESET' and consumed_at is null and expires_at>now() and attempts<5 order by id desc limit 1 for update",[u.id]):[[]];
    const record=rows[0];
    if(!record){await c.rollback();await bcrypt.compare(otp,await dummy);return invalid();}
    await c.execute('update otp_codes set attempts=attempts+1 where id=?',[record.id]);
    if(!await bcrypt.compare(otp,record.otp_hash)){await c.commit();return invalid();}
    await c.execute('update otp_codes set consumed_at=now() where id=?',[record.id]);
    await c.execute('update password_reset_grants set consumed_at=now() where user_id=? and consumed_at is null',[u.id]);
    token=crypto.randomBytes(32).toString('hex');
    await c.execute('insert into password_reset_grants(token_hash,user_id,expires_at) values (?,?,date_add(now(),interval 10 minute))',[digest(token),u.id]);
    await c.commit();
  }catch(e){await c.rollback();throw e;}finally{c.release();}
  await regenerateSession(req);req.session.passwordResetToken=token;
  res.json({ok:true,message:'Code verified. Choose your new password.'});
}));
router.post('/reset-password',limit('password-reset-finish',30),wrap(async(req,res)=>{
  const password=req.body.password,token=req.session.passwordResetToken;
  if(typeof password!=='string'||password.length<12||Buffer.byteLength(password)>72)return res.status(400).json({error:'Use at least 12 characters and no more than 72 UTF-8 bytes.'});
  if(!token)return res.status(400).json({error:'Verify a new reset code first.'});
  const hash=await bcrypt.hash(password,12),c=await pool.getConnection();
  try{
    await c.beginTransaction();
    const [[grant]]=await c.execute('select user_id from password_reset_grants where token_hash=?',[digest(token)]);
    if(!grant){await c.rollback();return res.status(400).json({error:'Verify a new reset code first.'});}
    const [[u]]=await c.execute('select id from users where id=? and is_active=1 for update',[grant.user_id]);
    const [claim]=await c.execute('update password_reset_grants set consumed_at=now() where token_hash=? and consumed_at is null and expires_at>now()',[digest(token)]);
    if(!u||!claim.affectedRows){await c.rollback();return res.status(400).json({error:'Your reset has expired or was already used. Request a new code.'});}
    await c.execute('update users set password_hash=?,session_version=session_version+1 where id=?',[hash,u.id]);
    await c.execute('update otp_codes set consumed_at=now() where user_id=? and consumed_at is null',[u.id]);
    await c.execute('update password_reset_grants set consumed_at=now() where user_id=? and consumed_at is null',[u.id]);
    await c.commit();
  }catch(e){await c.rollback();throw e;}finally{c.release();}
  await destroySession(req);res.clearCookie('inkframe.sid');res.json({ok:true,redirect:'/signin/?password=reset'});
}));
module.exports=router;
