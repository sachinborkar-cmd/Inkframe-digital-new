const fs=require('node:fs');
const assert=require('node:assert/strict');
(async()=>{
const targets=await(await fetch('http://localhost:9333/json')).json();
const ws=new WebSocket(targets.find(t=>t.type==='page').webSocketDebuggerUrl);await new Promise(r=>ws.onopen=r);
let serial=0;const pending=new Map();ws.onmessage=e=>{const m=JSON.parse(e.data);if(pending.has(m.id)){pending.get(m.id)(m.result);pending.delete(m.id);}};
const call=(method,params={})=>new Promise(r=>{const id=++serial;pending.set(id,r);ws.send(JSON.stringify({id,method,params}));});
await call('Page.navigate',{url:'http://localhost:8000/signin/'});await new Promise(r=>setTimeout(r,2000));
for(const [width,height] of [[1262,628],[1366,660],[1920,942],[1024,600]]){
await call('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:false});
await new Promise(r=>setTimeout(r,250));
const result=await call('Runtime.evaluate',{expression:'JSON.stringify({width:innerWidth,height:innerHeight,pageHeight:document.documentElement.scrollHeight,pageWidth:document.documentElement.scrollWidth,bottom:document.querySelector(".account-legal").getBoundingClientRect().bottom})',returnByValue:true});
const metrics=JSON.parse(result.result.value);console.log(metrics);assert.ok(metrics.pageHeight<=height,'Vertical overflow');assert.ok(metrics.pageWidth<=width,'Horizontal overflow');assert.ok(metrics.bottom<=height,'Legal links outside viewport');
if(width===1262){const shot=await call('Page.captureScreenshot',{format:'png'});fs.writeFileSync('tmp/account-preview/fitted-desktop.png',Buffer.from(shot.data,'base64'));}
}
await call('Browser.close');ws.close();
})().catch(e=>{console.error(e);process.exitCode=1;});
