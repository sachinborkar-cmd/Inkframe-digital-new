// Real Express/MySQL and browser flows; outgoing email is captured in memory.
process.env.PORT='8028';process.env.APP_ORIGIN='http://127.0.0.1:8028';process.env.NODE_ENV='test';process.env.TEST_PAYMENTS_ENABLED='true';
require('dotenv').config({quiet:true});
const {chromium}=require('@playwright/test');
const assert=require('node:assert/strict'),crypto=require('node:crypto'),fs=require('node:fs/promises');
const pool=require('../server/database');
let otp,deliveries=0;
const email='browser-'+crypto.randomUUID()+'@example.invalid',slug='browser-'+crypto.randomUUID();
require('../server/email').sendOtpEmail=async(to,code)=>{assert.equal(to,email);otp=code;};
require('../server/email').sendBookEmail=async(to)=>{assert.equal(to,email);deliveries++;};
const {app,sessionStore}=require('../server/server');
let server,browser,userId,bookId;
(async()=>{try{
  await require('../server/schema').ensureSchema();await sessionStore.onReady();
  const [[book]]=await pool.query('select pdf_path from ebooks where pdf_path is not null limit 1');
  assert.ok(book,'A fixture source PDF must exist');
  const [insert]=await pool.execute("insert into ebooks(slug,title,author,price_paise,pdf_path,status) values (?,?,'Fixture',100,?,'published')",[slug,'Security Browser Fixture',book.pdf_path]);bookId=insert.insertId;
  server=await new Promise(resolve=>{const s=app.listen(8028,'127.0.0.1',()=>resolve(s));});
  browser=await chromium.launch({channel:'chrome',headless:true});
  const context=await browser.newContext({acceptDownloads:true});
  await context.addInitScript(()=>{window.cspViolations=[];document.addEventListener('securitypolicyviolation',e=>window.cspViolations.push({directive:e.effectiveDirective,blocked:e.blockedURI}));});
  const page=await context.newPage();const exceptions=[],violations=[],networkFailures=[];
  page.on('pageerror',e=>exceptions.push(e.message));
  page.on('requestfailed',r=>networkFailures.push({url:new URL(r.url()).origin,reason:r.failure()?.errorText}));
  async function visit(path){const r=await page.goto(process.env.APP_ORIGIN+path,{waitUntil:'domcontentloaded'});assert.equal(r.status(),200,path);await page.waitForTimeout(400);violations.push(...await page.evaluate(()=>window.cspViolations));}
  await visit('/signin/');
  await page.locator('#customer-name').fill('Browser Fixture');await page.locator('#customer-email').fill(email);
  await page.locator('#customer-signin-form button[type=submit]').click();await page.locator('#customer-otp').waitFor({state:'visible'});
  assert.ok(otp);await page.locator('#customer-otp').fill(otp);
  await Promise.all([page.waitForURL('**/library/'),page.locator('#customer-otp-form button[type=submit]').click()]);
  const [[user]]=await pool.execute('select id from users where email=?',[email]);userId=user.id;
  console.log('PASS: browser OTP sign-in with captured email and MySQL session.');
  const pages=(await fs.readdir('client/pages',{withFileTypes:true})).filter(x=>x.isDirectory()).map(x=>'/'+x.name+'/');
  await pool.execute("update users set role='ADMIN' where id=?",[userId]);
  for(const route of ['/', '/ebooks/', '/library/', ...pages]){
    await visit(route==='/product/'?route+'?slug='+slug:route);
    // Tailwind must have produced a stylesheet, rather than failing silently.
    if(await page.locator('script[src*="tailwind-browser"]').count()) {
      assert.ok(await page.evaluate(()=>Array.from(document.querySelectorAll('style')).some(s=>s.textContent.includes('tailwindcss'))),'Tailwind did not compile on '+route);
    }
  }
  console.log('PASS: every client/pages page, homepage, catalogue and library rendered.');
  await page.goto(process.env.APP_ORIGIN+'/admin/',{waitUntil:'networkidle'});
  await page.locator('#admin-content h1').waitFor();assert.equal(await page.locator('#admin-message').textContent(),'');
  await page.goto(process.env.APP_ORIGIN+'/product/?slug='+slug,{waitUntil:'networkidle'});
  await page.evaluate(slug=>window.InkframeCart.add(slug),slug);
  await visit('/cart/');assert.match(await page.locator('body').innerText(),/Security Browser Fixture/);
  await visit('/checkout/');await page.locator('#fn').fill('Browser');await page.locator('#ln').fill('Fixture');await page.locator('#checkout-terms').check();
  await Promise.all([page.waitForURL('**/thank-you/**'),page.locator('#checkout-submit').click()]);
  assert.equal(deliveries,1);
  await visit('/library/');
  const download=await context.request.get(process.env.APP_ORIGIN+'/api/library/'+slug+'/download');assert.equal(download.status(),200);assert.equal((await download.body()).subarray(0,5).toString(),'%PDF-');
  console.log('PASS: admin access, product browsing, cart, test checkout, captured book email and protected PDF download.');
  assert.deepEqual(violations,[],'Browser CSP violations');assert.deepEqual(exceptions,[],'Browser exceptions');
  await fs.mkdir('.tmp/hardening',{recursive:true});await fs.writeFile('.tmp/hardening/browser-results.json',JSON.stringify({pageCount:pages.length+3,cspViolations:violations,exceptions,networkFailures,flows:'OTP, admin, cart, test checkout, captured email, download'},null,2));
  console.log('PASS: zero CSP violations and JavaScript exceptions. External network failures: '+networkFailures.length);
}finally{
  if(browser)await browser.close();if(server)await new Promise(resolve=>server.close(resolve));
  if(!userId){const [[u]]=await pool.execute('select id from users where email=?',[email]);userId=u?.id;}
  if(userId){await pool.execute('delete from orders where user_id=?',[userId]);await pool.execute('delete from users where id=?',[userId]);}
  if(bookId)await pool.execute('delete from ebooks where id=?',[bookId]);
  await pool.execute("delete from sessions where data like ?",['%'+email+'%']);
  await sessionStore.close();await pool.end();
}})().catch(e=>{console.error(e.message);process.exitCode=1;});
