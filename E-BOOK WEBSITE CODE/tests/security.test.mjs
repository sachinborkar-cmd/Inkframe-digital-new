import { beforeAll, afterAll, beforeEach, test, expect, vi } from 'vitest';
import { createRequire } from 'node:module';
import crypto from 'node:crypto';
import {EventEmitter} from 'node:events';
const require=createRequire(import.meta.url);
const session=require('express-session');
const secret=crypto.randomBytes(32).toString('hex');
process.env.SESSION_SECRET=secret;
process.env.NODE_ENV='test';
process.env.APP_ORIGIN='http://localhost:8026';
let actor, otpRecord, orderRows=[], rateHits=1;
const execute=vi.fn(async(sql,params)=>{
  if(sql.includes('from users where id=?'))return [[actor].filter(Boolean)];
  if(sql.includes('select id,session_version,is_active from users where email'))return [[actor].filter(Boolean)];
  if(sql.includes('from otp_codes o'))return [[otpRecord].filter(Boolean)];
  if(sql.includes('from orders o'))return [orderRows];
  if(sql.includes('select hits'))return [[{hits:rateHits}]];
  if(sql.startsWith('update otp_codes set attempts'))return [{affectedRows:1}];
  return [[]];
});
const connection={execute,query:execute,beginTransaction:vi.fn(),commit:vi.fn(),rollback:vi.fn(),release:vi.fn()};
const pool={execute,query:execute,getConnection:async()=>connection};
function replace(id,exports){const key=require.resolve(id);require.cache[key]={id:key,filename:key,loaded:true,exports};}
replace('../server/database',pool);
replace('express-mysql-session',()=>session.MemoryStore);
replace('../server/email',{sendOtpEmail:vi.fn(),sendBookEmail:vi.fn(),sendAdminInvite:vi.fn()});
const {app,sessionStore}=require('../server/server');
const {securityLog,setTestSink}=require('../server/security-log');
const {paidFile}=require('../server/book-files');
const {validateEnvironment}=require('../server/environment');
let server,origin,cookie;
beforeAll(async()=>{server=await new Promise(resolve=>{const s=app.listen(0,'127.0.0.1',()=>resolve(s));});origin='http://127.0.0.1:'+server.address().port;});
afterAll(async()=>{await new Promise(resolve=>server.close(resolve));});
beforeEach(async()=>{
  vi.clearAllMocks();process.env.NODE_ENV='test';process.env.TEST_PAYMENTS_ENABLED='true';rateHits=1;orderRows=[];otpRecord=null;
  actor={id:41,email:'fixture@example.invalid',is_verified:1,is_active:1,role:'CUSTOMER',session_version:2};
  const sid=crypto.randomUUID();
  await new Promise((resolve,reject)=>sessionStore.set(sid,{cookie:{maxAge:60000},userId:41,sessionVersion:2,
    role:'ADMIN',isAdmin:true,pendingOtpEmail:actor.email,pendingFullName:'Fixture Reader'},e=>e?reject(e):resolve()));
  cookie='inkframe.sid='+encodeURIComponent('s:'+require('cookie-signature').sign(sid,secret));
});
async function request(path,{body,method=body?'POST':'GET',authenticated=true,headers={}}={}){
  return fetch(origin+path,{method,headers:{...(authenticated?{cookie}:{}),'Content-Type':'application/json',...headers},body:body===undefined?undefined:JSON.stringify(body),redirect:'manual'});
}
test('invalid password login has a generic response',async()=>{
  const r=await request('/api/auth/login',{body:{email:actor.email,password:'incorrect'}});
  expect(r.status).toBe(401);expect(await r.json()).toEqual({error:'Email or password is incorrect.'});
});
test('Google login verifies audience and nonce before regenerating a session',async()=>{
  const previous=process.env.GOOGLE_CLIENT_ID;process.env.GOOGLE_CLIENT_ID='123-fixture.apps.googleusercontent.com';
  const verify=vi.spyOn(require('google-auth-library').OAuth2Client.prototype,'verifyIdToken');
  try{
    const config=await (await request('/api/auth/google-config')).json();
    verify.mockResolvedValue({getPayload:()=>({nonce:'wrong',email:actor.email,email_verified:true})});
    expect((await request('/api/auth/google',{body:{credential:'fixture-credential'}})).status).toBe(401);
    verify.mockResolvedValue({getPayload:()=>({nonce:config.nonce,email:actor.email,email_verified:true,name:'Fixture Reader'})});
    const r=await request('/api/auth/google',{body:{credential:'fixture-credential'}});
    expect(r.status).toBe(200);expect(r.headers.get('set-cookie')).toBeTruthy();
    expect(verify).toHaveBeenCalledWith({idToken:'fixture-credential',audience:process.env.GOOGLE_CLIENT_ID});
  }finally{verify.mockRestore();if(previous===undefined)delete process.env.GOOGLE_CLIENT_ID;else process.env.GOOGLE_CLIENT_ID=previous;}
});
test('security logs record denials without submitted secrets or raw query data',async()=>{
  const entries=[];setTestSink(entry=>entries.push(entry));
  try{
    const req={originalUrl:'/api/admin/products?token=private-input',method:'POST',user:{id:41}};
    const res=new EventEmitter();res.statusCode=403;
    securityLog(req,res,()=>{});res.emit('finish');
    expect(entries.some(e=>e.event==='permission_denied'&&e.status===403)).toBe(true);
    expect(JSON.stringify(entries)).not.toContain('private-input');
  }finally{setTestSink(null);}
});
test('expired sign-in OTP is consumed and rejected',async()=>{
  otpRecord={id:5,user_id:41,expires_at:new Date(Date.now()-1000),attempts:0};
  const r=await request('/api/auth/verify-otp',{body:{email:actor.email,otp:'123456'}});
  expect(r.status).toBe(400);expect((await r.json()).error).toMatch(/expired/);
  expect(execute.mock.calls.some(([sql,values])=>sql.includes('consumed_at = now()')&&values[0]===5)).toBe(true);
});
test('five failed OTP attempts prevent further verification',async()=>{
  otpRecord={id:5,expires_at:new Date(Date.now()+60000),attempts:5};
  expect((await request('/api/auth/verify-otp',{body:{email:actor.email,otp:'123456'}})).status).toBe(429);
});
test('OTP verification requires the requesting session',async()=>{
  expect((await request('/api/auth/verify-otp',{authenticated:false,body:{email:actor.email,otp:'123456'}})).status).toBe(400);
});
test('OTP route has its own IP limit below the blanket auth limit',async()=>{
  rateHits=51;
  expect((await request('/api/auth/verify-otp',{body:{email:actor.email,otp:'123456'}})).status).toBe(429);
  expect(execute.mock.calls.filter(([sql])=>sql.includes('select hits')).length).toBe(2);
});
test('revoked and inactive sessions are rejected from database state',async()=>{
  actor.session_version=3;expect((await request('/api/profile')).status).toBe(401);
  actor.session_version=2;actor.is_active=0;expect((await request('/api/profile')).status).toBe(401);
});
test('session and body role spoofing cannot grant admin privileges',async()=>{
  expect((await request('/api/admin/products')).status).toBe(403);
  expect((await request('/api/admin/products',{body:{role:'ADMIN',is_owner:true}})).status).toBe(403);
});
test.each(['/api/library','/api/library/test-book/download','/api/admin/products','/api/profile'])('guest denied: %s',async path=>{
  expect((await request(path,{authenticated:false})).status).toBe(401);
});
test('unpaid and another customer purchases cannot be downloaded',async()=>{
  const r=await request('/api/library/test-book/download?user_id=99');expect(r.status).toBe(403);
  const [sql,values]=execute.mock.calls.find(([sql])=>sql.includes('select o.id,e.pdf_path'));
  expect(sql).toContain('o.user_id=?');expect(sql).toContain(".status='paid'");
  expect(sql).toContain('verified_at is not null');expect(values).toEqual([41,'test-book']);
});
test('library and receipt queries always bind the session owner',async()=>{
  expect((await request('/api/library?user_id=99')).status).toBe(200);
  expect((await request('/api/test-checkout/99?user_id=99')).status).toBe(404);
  for(const [sql,values] of execute.mock.calls.filter(([sql])=>sql.includes('from orders o'))) {
    expect(sql).toMatch(/o.user_id\s*=\s*\?/);expect(values).toContain(41);
  }
});
test('download rate limit returns retry guidance',async()=>{
  rateHits=61;const r=await request('/api/library/test-book/download');expect(r.status).toBe(429);expect(r.headers.get('retry-after')).toBe('900');
});
test.each(['..%2Fsecret',"a%27%20OR%201%3D1--",'x'.repeat(161)])('malformed slug rejected before purchase SQL: %s',async slug=>{
  expect((await request('/api/library/'+slug+'/download')).status).toBe(400);
  expect(execute.mock.calls.some(([sql])=>sql.includes('from orders o'))).toBe(false);
});
test.each(['1abc','0','-1','1%20OR%201=1','9007199254740992'])('malformed order ID rejected: %s',async id=>{
  expect((await request('/api/test-checkout/'+id)).status).toBe(400);
});
test('SQL-looking profile data is passed as a bound value',async()=>{
  const name="Robert'); DROP TABLE users;--";
  expect((await request('/api/profile',{body:{full_name:name,mobile:'',user_id:99}})).status).toBe(200);
  const [sql,values]=execute.mock.calls.find(([sql])=>sql.includes('insert into profiles'));
  expect(sql).not.toContain(name);expect(values).toEqual([41,name,'']);
});
test('oversized and malformed JSON produce safe client errors',async()=>{
  expect((await request('/api/auth/login',{body:{password:'x'.repeat(21000)}})).status).toBe(413);
  const r=await fetch(origin+'/api/auth/login',{method:'POST',headers:{'Content-Type':'application/json'},body:'{'});
  expect(r.status).toBe(400);expect(await r.json()).toEqual({error:'Malformed request.'});
});
test('invalid cart slugs and long coupons rejected',async()=>{
  expect((await request('/api/store/cart',{method:'PUT',body:{slugs:["x' OR 1=1"]}})).status).toBe(400);
  expect((await request('/api/store/coupon',{body:{code:'x'.repeat(41),slugs:['test-book']}})).status).toBe(400);
});
test.each(['/server/private/ebooks/fitness-for-busy-professionals.pdf','/.env','/backup-before-restructure/.env'])('private workspace path not served: %s',async path=>{
  expect((await request(path,{authenticated:false})).status).toBe(404);
});
test('private file allowlist remains strict',()=>{
  for(const path of ['../.env','server/private/ebooks/../../.env','server/private/ebooks/x.pdf/../x','server/private/ebooks/x.PDF'])expect(()=>paidFile(path)).toThrow();
  expect(paidFile('server/private/ebooks/test-book.pdf')).toMatch(/test-book\.pdf$/);
});
test('database error details never reach API clients',async()=>{
  execute.mockRejectedValueOnce(new Error('private database error detail'));
  const r=await request('/api/profile');expect(r.status).toBe(500);expect(await r.text()).not.toContain('private database');
});
test('CSP and permissions apply, HSTS is production only',async()=>{
  let r=await request('/');expect(r.headers.get('content-security-policy')).toContain("script-src-attr 'none'");
  expect(r.headers.get('permissions-policy')).toBe('camera=(), microphone=(), geolocation=()');expect(r.headers.get('strict-transport-security')).toBeNull();
  process.env.NODE_ENV='production';r=await request('/');expect(r.headers.get('strict-transport-security')).toBe('max-age=31536000');
});
test('original cross-origin write protection remains active',async()=>{
  expect((await request('/api/auth/login',{body:{},headers:{Origin:'https://attacker.invalid'}})).status).toBe(403);
  expect((await request('/api/auth/login',{body:{},headers:{'Sec-Fetch-Site':'cross-site'}})).status).toBe(403);
});
test('production disables test checkout and excludes test orders from download query',async()=>{
  process.env.NODE_ENV='production';process.env.TEST_PAYMENTS_ENABLED='true';
  expect((await request('/api/test-checkout',{body:{}})).status).toBe(403);
  expect((await request('/api/library/test-book/download')).status).toBe(403);
  const [sql]=execute.mock.calls.find(([sql])=>sql.includes('select o.id,e.pdf_path'));
  expect(sql).toContain("payment_method<>'test'");expect(sql).not.toContain("or o.payment_method='test'");
});
test('production environment rejects missing settings and unsafe deployment values',()=>{
  const env={NODE_ENV:'production',SESSION_SECRET:secret,DB_HOST:'localhost',DB_PORT:'3306',DB_USER:'fixture',DB_PASSWORD:'fixture',DB_NAME:'fixture',SMTP_HOST:'localhost',SMTP_PORT:'587',SMTP_USER:'fixture',SMTP_PASSWORD:'fixture',APP_ORIGIN:'https://store.example.invalid',GOOGLE_CLIENT_ID:'123-fixture.apps.googleusercontent.com',TEST_PAYMENTS_ENABLED:'false'};
  expect(()=>validateEnvironment(env)).not.toThrow();
  for(const key of ['DB_HOST','DB_PORT','DB_USER','DB_PASSWORD','DB_NAME','SMTP_HOST','SMTP_PORT','SMTP_USER','SMTP_PASSWORD','APP_ORIGIN','GOOGLE_CLIENT_ID'])expect(()=>validateEnvironment({...env,[key]:''})).toThrow();
  expect(()=>validateEnvironment({...env,TEST_PAYMENTS_ENABLED:'true'})).toThrow();
  expect(()=>validateEnvironment({...env,APP_ORIGIN:'http://store.example.invalid'})).toThrow();
  expect(()=>validateEnvironment({...env,DB_PORT:'invalid'})).toThrow();
});
