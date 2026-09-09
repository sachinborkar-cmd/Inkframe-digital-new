const fs=require('node:fs');
(async()=>{
const targets=await (await fetch('http://localhost:9333/json')).json();
const ws=new WebSocket(targets.find(t=>t.type==='page').webSocketDebuggerUrl);await new Promise(r=>ws.onopen=r);
let serial=0;const waiting=new Map();ws.onmessage=e=>{const msg=JSON.parse(e.data);if(waiting.has(msg.id)){waiting.get(msg.id)(msg.result);waiting.delete(msg.id);}};
const call=(method,params={})=>new Promise(resolve=>{const id=++serial;waiting.set(id,resolve);ws.send(JSON.stringify({id,method,params}));});
await call('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true});
await call('Page.navigate',{url:'http://localhost:8000/signin/'});
await new Promise(r=>setTimeout(r,3000));
console.log(JSON.stringify(await call('Runtime.evaluate',{expression:'JSON.stringify({viewport:innerWidth,page:document.documentElement.scrollWidth,form:document.querySelector(".account-form-wrap").getBoundingClientRect().width})',returnByValue:true})));
const result=await call('Page.captureScreenshot',{format:'png',captureBeyondViewport:true});fs.writeFileSync('tmp/account-preview/mobile.png',Buffer.from(result.data,'base64'));
await call('Browser.close');ws.close();
})().catch(e=>{console.error(e);process.exitCode=1;});
