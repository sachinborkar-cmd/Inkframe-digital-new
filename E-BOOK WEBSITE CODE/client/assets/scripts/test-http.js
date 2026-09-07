const assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path'),crypto=require('node:crypto');
const filename='security-'+crypto.randomUUID()+'.pdf',uploadRoot=path.resolve(__dirname,'../uploads'),fixture=path.join(uploadRoot,filename);
(async()=>{
 const origin=process.env.TEST_HTTP_ORIGIN||'http://localhost:8011';
 await fs.writeFile(fixture,'%PDF-1.4 public-upload restriction test',{flag:'wx'});
 try{
 for(const path of ['/','/ebooks/','/product/?slug=fitness-for-busy-professionals','/signin/','/forgot-password/','/assets/js/password.js','/assets/css/product.css']){const r=await fetch(origin+path);assert.equal(r.status,200,path);}
 for(const path of ['/api/admin/me','/api/admin/products','/api/admin/dashboard','/api/admin/analytics','/api/admin/orders','/api/admin/customers','/api/admin/settings','/api/admin/team','/api/admin/activity','/api/profile','/api/library','/api/library/fitness-for-busy-professionals/download','/api/store/cart']){const r=await fetch(origin+path);assert.equal(r.status,401,path);}
 for(const path of ['/server/private/ebooks/fitness-for-busy-professionals.pdf','/.env','/assets/uploads/'+filename,'/assets/uploads/'+filename.replace('.pdf','.%70df')]){const r=await fetch(origin+path);assert.equal(r.status,404,path);}
 const publicData=await (await fetch(origin+'/api/store/products')).json();assert.ok(Array.isArray(publicData.products));assert.ok(publicData.products.every(p=>!('pdf_path' in p)));
 const spoof=await fetch(origin+'/api/auth/login',{method:'POST',headers:{Origin:'https://attacker.example','Content-Type':'application/json'},body:'{}'});assert.equal(spoof.status,403);
 console.log('PASS: live frontend pages, public catalogue, protected API routes, private files, public-upload restrictions, and cross-origin write rejection.');
 }finally{if(path.dirname(fixture)!==uploadRoot)throw Error('Unsafe cleanup path');await fs.unlink(fixture);}
})().catch(e=>{console.error(e);process.exitCode=1;});
