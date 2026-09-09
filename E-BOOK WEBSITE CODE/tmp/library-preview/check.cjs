const fs=require('node:fs'),assert=require('node:assert/strict');
(async()=>{
const targets=await(await fetch('http://localhost:9333/json')).json();const ws=new WebSocket(targets.find(t=>t.type==='page').webSocketDebuggerUrl);await new Promise(r=>ws.onopen=r);
let serial=0;const pending=new Map();const call=(method,params={})=>new Promise(r=>{const id=++serial;pending.set(id,r);ws.send(JSON.stringify({id,method,params}));});
const orders=[{id:1042,slug:'fitness-for-busy-professionals',title:'Fitness for Busy Professionals',author:'Inkframe Press',cover_path:'/assets/images/fitness-for-busy-professionals-cover.png',amount_paise:49900,status:'paid',payment_method:'test',created_at:'2026-09-09T10:00:00Z',download_count:2,email_sent_at:'2026-09-09T10:00:00Z',can_download:true,download_url:'/api/library/fitness-for-busy-professionals/download'},{id:1030,title:'A previous purchase',author:'Inkframe Press',cover_path:null,amount_paise:29900,status:'refunded',payment_method:'test',created_at:'2026-09-01T10:00:00Z',can_download:false,download_url:null}];
ws.onmessage=async e=>{const m=JSON.parse(e.data);if(pending.has(m.id)){pending.get(m.id)(m.result);pending.delete(m.id);}if(m.method==='Fetch.requestPaused'){
const p=m.params,url=new URL(p.request.url);let body,type='application/json';
if(url.pathname==='/library/'){body=fs.readFileSync('client/library/index.html','utf8');type='text/html';}
if(url.pathname==='/api/library')body=JSON.stringify({orders,books:[orders[0]]});
if(url.pathname==='/api/profile')body=JSON.stringify({profile:{email:'reader@example.com',full_name:'Sample Reader',mobile:'',has_password:false}});
if(url.pathname==='/api/auth/session')body=JSON.stringify({authenticated:true,email:'reader@example.com'});
if(url.pathname==='/api/store/cart')body=JSON.stringify({items:[]});
if(body!==undefined)await call('Fetch.fulfillRequest',{requestId:p.requestId,responseCode:200,responseHeaders:[{name:'Content-Type',value:type}],body:Buffer.from(body).toString('base64')});else await call('Fetch.continueRequest',{requestId:p.requestId});
}};
await call('Fetch.enable',{patterns:[{urlPattern:'*'}]});
const evaluate=async expression=>(await call('Runtime.evaluate',{expression,returnByValue:true})).result.value;
for(const [width,height,label] of [[1440,1000,'desktop'],[390,844,'mobile']]){
await call('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:width<700});await call('Page.navigate',{url:'http://localhost:8000/library/'});await new Promise(r=>setTimeout(r,2500));
assert.equal(await evaluate('document.querySelector("#profile").open'),false);
assert.equal(await evaluate('document.querySelectorAll(".purchase-card").length'),2);
assert.equal(await evaluate('document.querySelectorAll(".purchase-actions a[href*=download]").length'),1);
assert.equal(await evaluate('document.documentElement.scrollWidth <= innerWidth'),true);
const shot=await call('Page.captureScreenshot',{format:'png',captureBeyondViewport:true});fs.writeFileSync('tmp/library-preview/'+label+'.png',Buffer.from(shot.data,'base64'));
await evaluate('document.querySelector("[data-account-link]").click()');assert.equal(await evaluate('document.querySelector("#profile").open'),true);assert.equal(await evaluate('document.querySelector("#profile-password-action").textContent'),'Create a password');
await evaluate('document.querySelector("#profile summary").click()');assert.equal(await evaluate('document.querySelector("#profile").open'),false);
console.log('PASS '+label+': collapsed profile, header opens it, summary closes it, purchase cards, refund restriction, no horizontal overflow.');
}
await call('Page.navigate',{url:'http://localhost:8000/library/#profile'});await new Promise(r=>setTimeout(r,3500));assert.equal(await evaluate('document.querySelector("#profile").open'),true);
await call('Page.navigate',{url:'http://localhost:8000/forgot-password/?from=library'});await new Promise(r=>setTimeout(r,3500));assert.equal(await evaluate('document.querySelector("main a[href=\"/library/#profile\"]").textContent'),'Back to my profile');
console.log('PASS: direct profile link and password recovery return destination.');await call('Browser.close');ws.close();
})().catch(e=>{console.error(e);process.exitCode=1;});
