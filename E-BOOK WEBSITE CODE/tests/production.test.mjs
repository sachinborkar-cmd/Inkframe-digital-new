import {test,expect} from 'vitest';
import {createRequire} from 'node:module';
import crypto from 'node:crypto';
const require=createRequire(import.meta.url);
test('production issues secure cookies only behind HTTPS and disables test payments',async()=>{
  Object.assign(process.env,{NODE_ENV:'production',SESSION_SECRET:crypto.randomBytes(32).toString('hex'),DB_HOST:'localhost',DB_PORT:'3306',DB_USER:'fixture',DB_PASSWORD:'fixture',DB_NAME:'fixture',SMTP_HOST:'localhost',SMTP_PORT:'587',SMTP_USER:'fixture',SMTP_PASSWORD:'fixture',APP_ORIGIN:'https://store.example.invalid',GOOGLE_CLIENT_ID:'123-fixture.apps.googleusercontent.com',TEST_PAYMENTS_ENABLED:'false'});
  const replace=(id,exports)=>{const key=require.resolve(id);require.cache[key]={id:key,filename:key,loaded:true,exports};};
  replace('../server/database',{query:async()=>[[]],execute:async()=>[[]],getConnection:async()=>({beginTransaction:async()=>{},execute:async()=>[[{hits:1}]],commit:async()=>{},release(){}})});
  replace('express-mysql-session',()=>require('express-session').MemoryStore);
  const {app}=require('../server/server');
  const server=await new Promise(resolve=>{const s=app.listen(0,'127.0.0.1',()=>resolve(s));});
  const origin='http://127.0.0.1:'+server.address().port;
  try{
    let r=await fetch(origin+'/api/auth/google-config',{headers:{'X-Forwarded-Proto':'https'}});
    expect(r.status).toBe(200);const cookie=r.headers.get('set-cookie');
    expect(cookie).toContain('Secure');expect(cookie).toContain('HttpOnly');expect(cookie).toContain('SameSite=Lax');
    expect(r.headers.get('strict-transport-security')).toBe('max-age=31536000');
    r=await fetch(origin+'/api/auth/google-config');expect(r.headers.get('set-cookie')).toBeNull();
    r=await fetch(origin+'/api/payments/config');expect(await r.json()).toEqual({live_enabled:false,test_enabled:false});
  }finally{await new Promise(resolve=>server.close(resolve));}
});
