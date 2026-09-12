import { test, expect } from 'vitest';
import { createRequire } from 'node:module';
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
const require=createRequire(import.meta.url);
const {SMTPServer}=require('smtp-server');
test('Nodemailer sends OTP and PDF mail through authenticated SMTP',async()=>{
  const messages=[];
  const smtp=new SMTPServer({secure:false,disabledCommands:['STARTTLS'],logger:false,
    onAuth(auth,session,callback){callback(null,{user:'fixture'});},
    onData(stream,session,callback){const chunks=[];stream.on('data',c=>chunks.push(c));stream.on('end',()=>{messages.push(Buffer.concat(chunks).toString());callback();});}
  });
  await new Promise(resolve=>smtp.listen(0,'127.0.0.1',resolve));
  const saved={};for(const key of ['SMTP_HOST','SMTP_PORT','SMTP_USER','SMTP_PASSWORD'])saved[key]=process.env[key];
  Object.assign(process.env,{SMTP_HOST:'127.0.0.1',SMTP_PORT:String(smtp.server.address().port),SMTP_USER:'fixture@example.invalid',SMTP_PASSWORD:crypto.randomUUID()});
  const dir=path.resolve('.tmp/hardening');await fs.mkdir(dir,{recursive:true});const pdf=path.join(dir,crypto.randomUUID()+'.pdf');await fs.writeFile(pdf,'%PDF-1.4\nFixture only\n%%EOF');
  try {
    delete require.cache[require.resolve('../server/email')];
    const mail=require('../server/email');
    await mail.verifyEmailTransport();
    await mail.sendOtpEmail('recipient@example.invalid','123456');
    await mail.sendBookEmail('recipient@example.invalid',1,100,pdf,'Fixture Book',true);
    expect(messages).toHaveLength(2);expect(messages[0]).toContain('verification code');
    expect(messages[0]).toContain('expires in 10 minutes');expect(messages[1]).toContain('application/pdf');
    expect(messages[1]).toContain('Fixture Book.pdf');expect(messages[1]).toContain('JVBERi0xLjQ');
  }finally{
    await fs.unlink(pdf);await new Promise(resolve=>smtp.close(resolve));
    for(const [key,value] of Object.entries(saved)){if(value===undefined)delete process.env[key];else process.env[key]=value;}
  }
});
