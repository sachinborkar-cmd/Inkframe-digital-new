// Local integration tests. Temporary records/files are removed; outgoing email is mocked.
require('dotenv').config({quiet:true});
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const path=require('node:path');
const crypto=require('node:crypto');
const express=require('express');
const pool=require('../../../server/database');
const email=require('../../../server/email');let deliveries=0;
email.sendBookEmail=async()=>{deliveries++;};email.sendAdminInvite=async()=>{};
const app=express();app.use(express.json({limit:'128kb'}));
const sessions={guest:{},owner:{},customer:{},unverified:{}};
app.use((req,res,next)=>{req.session=sessions[req.headers['x-test-role']||'guest'];next();});
app.use('/api/admin',require('../../../server/routes/admin'));
app.use('/api/store',require('../../../server/routes/store'));
app.use('/api/test-checkout',require('../../../server/routes/test-checkout'));
app.use('/api/library',require('../../../server/routes/library'));
app.use((err,req,res,next)=>res.status(err.status||500).json({error:err.message}));
const userIds=[],bookIds=[],categoryIds=[],couponIds=[],files=[];
let server;
(async()=>{
 try{
  await require('../../../server/schema').ensureSchema();
  const key=crypto.randomUUID();process.env.ADMIN_EMAIL='owner-'+key+'@example.invalid';process.env.NODE_ENV='development';process.env.TEST_PAYMENTS_ENABLED='true';
  for(const role of ['owner','customer','unverified']){const address=role==='owner'?process.env.ADMIN_EMAIL:role+'-'+key+'@example.invalid';const [r]=await pool.execute('insert into users(email,is_verified) values (?,?)',[address,role==='unverified'?0:1]);userIds.push(r.insertId);sessions[role]={userId:r.insertId,email:address,isAdmin:true};}
  await pool.execute("update users set role='ADMIN',is_owner=1 where id=?",[sessions.owner.userId]);
  server=await new Promise(resolve=>{const s=app.listen(0,'127.0.0.1',()=>resolve(s));});const base='http://127.0.0.1:'+server.address().port;
  async function request(route,body,method='GET',role='owner',csrf=true){const headers={'x-test-role':role};if(csrf)headers['X-CSRF-Token']=sessions[role].adminCsrf||'';if(body)headers['Content-Type']='application/json';const r=await fetch(base+route,{method,headers,body:body?JSON.stringify(body):undefined});const data=await r.json();return {status:r.status,data};}
  assert.equal((await request('/api/admin/me',null,'GET','guest')).status,401);
  assert.equal((await request('/api/admin/me',null,'GET','customer')).status,403);
  assert.equal((await request('/api/admin/me',null,'GET','unverified')).status,401);
  assert.equal((await request('/api/admin/me')).data.isOwner,true);
  assert.equal((await request('/api/admin/products',{},'POST','owner',false)).status,403);
  assert.equal((await request('/api/admin/products',{title:'Bad',price:'abc',status:'draft'},'POST')).status,400);
  const cat=await request('/api/admin/categories',{name:'Audit '+key,sort_order:2},'POST');assert.equal(cat.status,200);categoryIds.push(cat.data.id);
  assert.equal((await request('/api/admin/categories/'+cat.data.id,{name:'Edited audit category',sort_order:3,status:'draft'},'PUT')).status,200);
  const upload=await fetch(base+'/api/admin/uploads?kind=paid',{method:'POST',headers:{'x-test-role':'owner','X-CSRF-Token':sessions.owner.adminCsrf,'Content-Type':'application/pdf'},body:Buffer.from('%PDF-1.4\nIntegration test PDF\n%%EOF')});assert.equal(upload.status,201);const uploaded=await upload.json();files.push(uploaded.path);
  const invalidUpload=await fetch(base+'/api/admin/uploads?kind=paid',{method:'POST',headers:{'x-test-role':'owner','X-CSRF-Token':sessions.owner.adminCsrf,'Content-Type':'application/pdf'},body:Buffer.from('<script>not a PDF</script>')});assert.equal(invalidUpload.status,400);
  const product={title:'Audit book '+key,price:10,status:'published',category_id:cat.data.id,pdf_path:uploaded.path,description:'Integration test'};
  assert.equal((await request('/api/admin/products',{...product,pdf_path:'../../.env'},'POST')).status,400);
  for(let i=0;i<2;i++){const r=await request('/api/admin/products',{...product,title:product.title+i,slug:'audit-'+key+'-'+i},'POST');assert.equal(r.status,200);bookIds.push(r.data.id);}
  assert.equal((await request('/api/admin/products/'+bookIds[0],{...product,title:'Edited audit book'},'PUT')).status,200);
  const landing={...product,preview_pages:[{path:'/assets/uploads/test-page.png',caption:'A sample page <one>'}],testimonials:[{name:'Test reader',quote:'A useful read. <script>text only</script>'}]};
  assert.equal((await request('/api/admin/products/'+bookIds[0],landing,'PUT')).status,200);
  const publicBooks=(await request('/api/store/products',null,'GET','guest')).data.products;
  const saved=publicBooks.find(p=>p.id===bookIds[0]);
  const json=value=>typeof value==='string'?JSON.parse(value):value;
  assert.deepEqual(json(saved.preview_pages),landing.preview_pages);
  assert.deepEqual(json(saved.testimonials),landing.testimonials);
  assert.equal(saved.pdf_path,undefined);
  assert.equal((await request('/api/admin/products',{...landing,preview_pages:[{path:uploaded.path}]},'POST')).status,400);
  assert.equal((await request('/api/admin/products',{...landing,preview_pages:[{path:'javascript:alert(1)'}]},'POST')).status,400);
  assert.equal((await request('/api/admin/products',{...landing,testimonials:[{name:'',quote:'Missing name'}]},'POST')).status,400);
  assert.equal((await request('/api/admin/products',{...landing,testimonials:Array(11).fill({name:'Reader',quote:'Quote'})},'POST')).status,400);
  assert.equal((await request('/api/admin/products/'+bookIds[1],{...product,status:'draft'},'PUT')).status,200);
  assert.ok(!(await request('/api/store/products')).data.products.some(p=>p.id===bookIds[1]));
  assert.equal((await request('/api/admin/products/'+bookIds[1],product,'PUT')).status,200);
  assert.equal((await request('/api/admin/products/'+bookIds[0],{...product,preview_pages:[],testimonials:[]},'PUT')).status,200);
  const cleared=(await request('/api/store/products')).data.products.find(p=>p.id===bookIds[0]);
  assert.deepEqual(json(cleared.preview_pages),[]);assert.deepEqual(json(cleared.testimonials),[]);
  const coupon=await request('/api/admin/coupons',{code:'AUDIT-'+key.slice(0,8),type:'flat',value:1.25,minimum:0,limit:2,status:'active'},'POST');assert.equal(coupon.status,200);couponIds.push(coupon.data.id);
  const coupons=await request('/api/admin/coupons');assert.equal(coupons.data.coupons.find(c=>c.id===coupon.data.id).discount_value,125);
  assert.equal((await request('/api/admin/coupons/'+coupon.data.id,{code:'AUDIT-'+key.slice(0,8),type:'flat',value:1.25,ebook_id:bookIds[0],status:'active'},'PUT')).status,200);
  const checkout=await request('/api/test-checkout',{checkout_key:key,slugs:['audit-'+key+'-0','audit-'+key+'-1'],full_name:'Customer Test',phone:'',country:'India',terms:true,coupon:'AUDIT-'+key.slice(0,8)},'POST','customer');assert.equal(checkout.status,201);assert.equal(checkout.data.orders.length,2);assert.equal(checkout.data.orders.reduce((sum,o)=>sum+o.amount_paise,0),1875);assert.equal(deliveries,2);
  const orderId=checkout.data.order.id;
  assert.equal((await request('/api/admin/orders/'+orderId+'/refund',{},'POST')).status,200);
  const order=checkout.data.orders.find(o=>o.id===orderId);
  assert.equal((await fetch(base+'/api/library/'+order.slug+'/download',{headers:{'x-test-role':'customer'}})).status,403);
  const allowed=checkout.data.orders.find(o=>o.id!==orderId);const download=await fetch(base+'/api/library/'+allowed.slug+'/download',{headers:{'x-test-role':'customer'}});assert.equal(download.status,200);await download.arrayBuffer();
  await pool.execute('update orders set email_attempt_at=date_sub(now(),interval 3 minute) where id=?',[allowed.id]);
  assert.equal((await request('/api/admin/orders/'+allowed.id+'/resend',{},'POST')).status,200);
  assert.equal(deliveries,3);
  assert.equal((await request('/api/admin/settings',{support_email:'invalid'},'PUT')).status,400);
  for(const endpoint of ['dashboard','products','categories','orders','customers','coupons','settings','team','activity'])assert.equal((await request('/api/admin/'+endpoint)).status,200,endpoint);
  const member=sessions.customer.email;assert.equal((await request('/api/admin/team',{email:member},'POST')).status,201);
  assert.equal((await request('/api/admin/me',null,'GET','customer')).status,200);
  assert.equal((await request('/api/admin/team',null,'GET','customer')).status,403);
  assert.equal((await request('/api/admin/team/'+encodeURIComponent(member),null,'DELETE')).status,200);
  assert.equal((await request('/api/admin/me',null,'GET','customer')).status,401);
  assert.equal((await request('/api/admin/products/'+bookIds[0],null,'DELETE')).status,200);
  console.log('PASS: database-verified admin access, forged-role rejection, CSRF, product/category/coupon CRUD, PDF upload validation, multi-book checkout, refund access revocation, resend, settings validation, all admin reads, admin grant/revoke.');
 }finally{
  if(server)await new Promise(resolve=>server.close(resolve));
  for(const id of userIds){await pool.execute('delete from orders where user_id=?',[id]);await pool.execute('delete from activity_log where user_id=?',[id]);}
  for(const id of bookIds)await pool.execute('delete from ebooks where id=?',[id]);
  for(const id of categoryIds)await pool.execute('delete from categories where id=?',[id]);
  for(const id of couponIds)await pool.execute('delete from coupons where id=?',[id]);
  for(const session of Object.values(sessions))if(session.email)await pool.execute('delete from admin_members where email=?',[session.email]);
  for(const id of userIds)await pool.execute('delete from users where id=?',[id]);
  const root=path.resolve(__dirname,'../../../server/private/ebooks');for(const file of files){const target=path.resolve(__dirname,'../../..',file);if(!target.startsWith(root+path.sep))throw Error('Unsafe cleanup path');await fs.unlink(target);}
  await pool.end();
 }
})().catch(error=>{console.error(error);process.exitCode=1;});
