const fs=require('node:fs'),assert=require('node:assert/strict');
(async()=>{
const targets=await(await fetch('http://localhost:9333/json')).json();const ws=new WebSocket(targets.find(t=>t.type==='page').webSocketDebuggerUrl);await new Promise(r=>ws.onopen=r);
let serial=0,submitted;const pending=new Map();const call=(method,params={})=>new Promise(r=>{const id=++serial;pending.set(id,r);ws.send(JSON.stringify({id,method,params}));});
ws.onmessage=async e=>{const m=JSON.parse(e.data);if(pending.has(m.id)){pending.get(m.id)(m.result);pending.delete(m.id);}if(m.method==='Fetch.requestPaused'){
const p=m.params,url=new URL(p.request.url);let body;
if(url.pathname==='/thank-you/'){await call('Fetch.fulfillRequest',{requestId:p.requestId,responseCode:200,responseHeaders:[{name:'Content-Type',value:'text/html'}],body:Buffer.from('<h1>Order confirmation</h1>').toString('base64')});return;}
if(url.pathname==='/api/profile')body={profile:{email:'reader@example.invalid',full_name:'Reader',mobile:''}};
if(url.pathname==='/api/auth/session')body={authenticated:true,email:'reader@example.invalid'};
if(url.pathname==='/api/store/cart')body={items:[]};
if(url.pathname==='/api/test-checkout'){submitted=JSON.parse(p.request.postData);body={order:{id:99999}};}
if(body!==undefined)await call('Fetch.fulfillRequest',{requestId:p.requestId,responseCode:200,responseHeaders:[{name:'Content-Type',value:'application/json'}],body:Buffer.from(JSON.stringify(body)).toString('base64')});else await call('Fetch.continueRequest',{requestId:p.requestId});
}};
await call('Fetch.enable',{patterns:[{urlPattern:'*'}]});
const evaluate=async expression=>{const r=await call('Runtime.evaluate',{expression,returnByValue:true});if(r.exceptionDetails)throw Error(r.exceptionDetails.text);return r.result.value;};
for(const [width,height,label] of [[1440,1100,'desktop'],[390,844,'mobile']]){
await call('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:width<700});await call('Page.navigate',{url:'http://localhost:8000/checkout/?product=book-name-1'});
for(let i=0;i<100;i++){if(await evaluate('!!document.querySelector("#checkout-submit") && !document.querySelector("#checkout-submit").disabled'))break;await new Promise(r=>setTimeout(r,100));}
assert.equal(await evaluate('document.querySelector("#checkout-submit").disabled'),false);
assert.equal(await evaluate('document.querySelectorAll(".checkout-item").length'),1);
assert.equal(await evaluate('InkframeCart.items().length'),0);
assert.equal(await evaluate('document.documentElement.scrollWidth<=innerWidth'),true);
if(width>700){assert.equal(await evaluate('document.querySelector(".checkout-summary").offsetHeight === document.querySelector(".checkout-details").offsetHeight'),true);assert.equal(await evaluate('document.querySelector(".checkout-summary").offsetWidth === document.querySelector(".checkout-details").offsetWidth'),true);}
const shot=await call('Page.captureScreenshot',{format:'png',captureBeyondViewport:true});fs.writeFileSync('tmp/checkout-preview/'+label+'.png',Buffer.from(shot.data,'base64'));
console.log('PASS '+label+': direct product, empty cart, payment enabled, responsive layout'+(width>700?', equal card dimensions':''));
}
await evaluate('document.querySelector("#checkout-terms").checked=true;document.querySelector("#checkout-submit").click()');
for(let i=0;i<60&&!submitted;i++)await new Promise(r=>setTimeout(r,100));
assert.deepEqual(submitted.slugs,['book-name-1']);assert.equal(submitted.full_name,'Reader');assert.equal(submitted.terms,true);
for(let i=0;i<50;i++){if((await evaluate('location.pathname'))==='/thank-you/')break;await new Promise(r=>setTimeout(r,100));}
assert.equal(await evaluate('location.pathname'),'/thank-you/');console.log('PASS: single-name customer submits selected product and reaches order confirmation (payment response mocked).');
await call('Browser.close');ws.close();
})().catch(e=>{console.error(e);process.exitCode=1;});
