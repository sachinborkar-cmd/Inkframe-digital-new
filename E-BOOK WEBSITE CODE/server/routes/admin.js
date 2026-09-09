const express = require('express');
const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const path = require('node:path');
const pool = require('../database');
const {requireAdmin} = require('../middleware');
const {sendBookEmail, sendAdminInvite} = require('../email');
const router = express.Router();
router.use(requireAdmin);
router.use((req,res,next)=>{
  if (!req.session.adminCsrf) req.session.adminCsrf=crypto.randomBytes(32).toString('hex');
  if (!['GET','HEAD'].includes(req.method) && req.get('X-CSRF-Token') !== req.session.adminCsrf) return res.status(403).json({error:'Security check failed. Reload the admin panel.'});
  next();
});
const wrap=fn=>async(req,res,next)=>{try{await fn(req,res);}catch(e){if(e.code==='ER_DUP_ENTRY')return res.status(409).json({error:'That code, slug or email already exists.'});if(e.status)return res.status(e.status).json({error:e.message});next(e);}};
function fail(message,status=400){throw Object.assign(new Error(message),{status});}
function text(value,max=255){const s=String(value||'').trim();if(s.length>max)fail('A field is too long.');return s;}
function number(value,min=0,max=10000000){const n=Number(value);if(!Number.isFinite(n)||n<min||n>max)fail('Enter a valid number.');return n;}
const slugify=s=>text(s,160).toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'');
const paise=value=>Math.round(number(value)*100);
function landingFields(b){
 const previews=b.preview_pages||[],testimonials=b.testimonials||[];
 if(!Array.isArray(previews)||previews.length>12)fail('Add up to 12 preview pages.');
 if(!Array.isArray(testimonials)||testimonials.length>10)fail('Add up to 10 testimonials.');
 return [JSON.stringify(previews.map(p=>{
  if(!p||typeof p!=='object')fail('Invalid preview page.');
  const image=filePath(p.path,'public');
  if(!image||!/\.(png|jpe?g)$/.test(image))fail('Preview pages must be PNG or JPEG images.');
  return {path:image,caption:text(p.caption,200)};
 })),JSON.stringify(testimonials.map(t=>{
  if(!t||typeof t!=='object')fail('Invalid testimonial.');
  const name=text(t.name,120),quote=text(t.quote,1500);
  if(!name||!quote)fail('Each testimonial needs a reader name and quote.');
  return {name,quote};
 }))];
}
const audit=(req,action,details)=>pool.execute('insert into activity_log(user_id,action,details) values (?,?,?)',[req.session.userId,action,JSON.stringify(details)]);
async function exists(table,id){const [[row]]=await pool.execute(`select id from ${table} where id=?`,[id]);if(!row)fail('Record not found.',404);}
function filePath(value,kind){value=text(value,500);if(!value)return '';const valid=kind==='pdf'?/^server\/private\/ebooks\/[a-zA-Z0-9-]+\.pdf$/:/^\/(?:assets\/uploads\/[a-zA-Z0-9-]+\.(?:png|jpg|pdf)|images\/[a-zA-Z0-9_.-]+\.(?:png|jpg|jpeg))$/;if(!valid.test(value))fail('Select a valid uploaded file.');return value;}
router.get('/me',wrap(async(req,res)=>res.json({email:req.session.email,isOwner:req.isOwner,csrf:req.session.adminCsrf})));
router.get('/dashboard',wrap(async(req,res)=>{
  const days=Math.round(number(req.query.days||30,1,365));
  const [[totals]]=await pool.execute(`select count(*) orders,coalesce(sum(case when status='paid' and verified_at is not null and coalesce(payment_method,'')<>'test' then amount_paise else 0 end),0) sales_paise,coalesce(sum(case when payment_method='test' then 1 else 0 end),0) test_orders from orders where created_at>=date_sub(now(),interval ? day)`,[days]);
  const [[customers]]=await pool.query('select count(*) total from users where is_verified=1');
  const [[products]]=await pool.query("select count(*) total from ebooks where status='published'");
  const [daily]=await pool.execute(`select date(created_at) day,count(*) orders,coalesce(sum(case when status='paid' and verified_at is not null and coalesce(payment_method,'')<>'test' then amount_paise else 0 end),0) sales_paise from orders where created_at>=date_sub(now(),interval ? day) group by date(created_at) order by day`,[days]);
  const [bestsellers]=await pool.execute(`select e.title,count(*) purchases from orders o join ebooks e on e.id=o.ebook_id where o.status='paid' and o.verified_at is not null and coalesce(o.payment_method,'')<>'test' and o.created_at>=date_sub(now(),interval ? day) group by e.id order by purchases desc limit 5`,[days]);
  const [recent]=await pool.query('select o.id,o.status,o.amount_paise,o.created_at,e.title from orders o join ebooks e on e.id=o.ebook_id order by o.id desc limit 5');
  res.json({metrics:{...totals,customers:customers.total,products:products.total},daily,bestsellers,recent});
}));
router.get('/products',wrap(async(req,res)=>{const [products]=await pool.query('select e.*,c.name category,(select count(*) from orders o where o.ebook_id=e.id and o.status=\'paid\') sales from ebooks e left join categories c on c.id=e.category_id order by e.id desc');res.json({products});}));
async function product(req,res){
 const b=req.body,title=text(b.title),slug=slugify(b.slug||title),price=paise(b.price),status=b.status;
 if(title.length<2||!slug||!['draft','published','archived'].includes(status))fail('Title, slug, price and status are required.');
 const category=b.category_id?Math.round(number(b.category_id,1)):null;
 if(category)await exists('categories',category);
 const pdf=filePath(b.pdf_path,'pdf'),cover=filePath(b.cover_path,'public'),sample=filePath(b.sample_path,'public');
 if(cover&&!/\.(png|jpe?g)$/.test(cover))fail('The cover must be a PNG or JPEG image.');
 if(sample&&!sample.endsWith('.pdf'))fail('The sample must be a PDF.');
 if(status==='published'&&!pdf)fail('Upload the paid PDF before publishing.');
 if(pdf)await fs.access(path.resolve(__dirname,'../..',pdf)).catch(()=>fail('The PDF file is missing.'));
 if(sample){
   if(!await require('../sample-files').safeSample(sample))fail('Upload a sample excerpt that is different from every paid PDF.');
   if(pdf){const [paid,preview]=await Promise.all([fs.readFile(path.resolve(__dirname,'../..',pdf)),fs.readFile(path.resolve(__dirname,'../../client','.'+sample))]);if(paid.equals(preview))fail('The sample cannot contain the full paid PDF.');}
 }
 const values=[title,text(b.author||'Inkframe Press',160),price,text(b.description,15000),cover,status,category,pdf||null,sample||null,...landingFields(b)];
 let id=req.params.id;
 if(id){await exists('ebooks',id);await pool.execute('update ebooks set title=?,author=?,price_paise=?,description=?,cover_path=?,status=?,category_id=?,pdf_path=?,sample_path=?,preview_pages=?,testimonials=? where id=?',[...values,id]);}
 else {const [r]=await pool.execute('insert into ebooks(title,author,price_paise,description,cover_path,status,category_id,pdf_path,sample_path,preview_pages,testimonials,slug) values (?,?,?,?,?,?,?,?,?,?,?,?)',[...values,slug]);id=r.insertId;}
 await audit(req,'Product saved',{id,title,status});res.json({id});
}
router.post('/products',wrap(product));router.put('/products/:id',wrap(product));
router.delete('/products/:id',wrap(async(req,res)=>{await exists('ebooks',req.params.id);await pool.execute("update ebooks set status='archived' where id=?",[req.params.id]);await audit(req,'Product archived',{id:req.params.id});res.json({ok:true});}));
router.post('/uploads',express.raw({type:['application/pdf','image/png','image/jpeg'],limit:'20mb'}),wrap(async(req,res)=>{
 const data=req.body;if(!Buffer.isBuffer(data)||!data.length)fail('Choose a PDF, PNG or JPEG file (maximum 20 MB).');
 const mime=req.get('Content-Type').split(';')[0];let ext;
 if(mime==='application/pdf'&&data.subarray(0,5).toString()==='%PDF-')ext='pdf';
 if(mime==='image/png'&&data.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])))ext='png';
 if(mime==='image/jpeg'&&data[0]===255&&data[1]===216&&data[2]===255)ext='jpg';
 if(!ext)fail('File contents do not match its type.');
 const paid=req.query.kind==='paid';if(paid&&ext!=='pdf')fail('Paid books must be PDF files.');
 const dir=paid?'server/private/ebooks':'assets/uploads';const name=crypto.randomUUID()+'.'+ext;
 const absolute=path.resolve(__dirname,'../..',paid?dir:'client/'+dir);await fs.mkdir(absolute,{recursive:true});await fs.writeFile(path.join(absolute,name),data,{flag:'wx'});
 await audit(req,'File uploaded',{kind:paid?'paid':'public',name});res.status(201).json({path:(paid?'':'/')+dir+'/'+name});
}));
router.get('/categories',wrap(async(req,res)=>{const [categories]=await pool.query('select c.*,(select count(*) from ebooks e where e.category_id=c.id) products from categories c order by sort_order,name');res.json({categories});}));
async function category(req,res){const b=req.body,name=text(b.name,120),slug=slugify(b.slug||name);if(name.length<2||!slug)fail('Category name is required.');const values=[name,text(b.description,3000),b.status==='draft'?'draft':'active',Math.round(number(b.sort_order||0,0,9999)),filePath(b.banner_path,'public')];let id=req.params.id;if(id){await exists('categories',id);await pool.execute('update categories set name=?,description=?,status=?,sort_order=?,banner_path=? where id=?',[...values,id]);}else{const [r]=await pool.execute('insert into categories(name,description,status,sort_order,banner_path,slug) values (?,?,?,?,?,?)',[...values,slug]);id=r.insertId;}await audit(req,'Category saved',{id,name});res.json({id});}
router.post('/categories',wrap(category));router.put('/categories/:id',wrap(category));
router.get('/coupons',wrap(async(req,res)=>{const [coupons]=await pool.query('select * from coupons order by id desc');res.json({coupons});}));
async function coupon(req,res){const b=req.body,code=text(b.code,40).toUpperCase(),type=b.type==='flat'?'flat':'percent';if(!/^[A-Z0-9_-]{2,40}$/.test(code))fail('Use letters, numbers, hyphens or underscores for the coupon code.');const value=type==='flat'?paise(b.value):number(b.value,1,100);if(value<=0)fail('Discount must be positive.');const expires=b.expires?text(b.expires,30):null;if(expires&&!/^\d{4}-\d{2}-\d{2}$/.test(expires))fail('Choose a valid expiry date.');const ebook=b.ebook_id?Math.round(number(b.ebook_id,1)):null;if(ebook)await exists('ebooks',ebook);const values=[code,type,value,paise(b.minimum||0),b.limit?Math.round(number(b.limit,1)):null,expires?expires+' 23:59:59':null,b.status==='inactive'?'inactive':'active',ebook];let id=req.params.id;if(id){await exists('coupons',id);await pool.execute('update coupons set code=?,discount_type=?,discount_value=?,minimum_paise=?,usage_limit=?,expires_at=?,status=?,ebook_id=? where id=?',[...values,id]);}else{const [r]=await pool.execute('insert into coupons(code,discount_type,discount_value,minimum_paise,usage_limit,expires_at,status,ebook_id) values (?,?,?,?,?,?,?,?)',values);id=r.insertId;}await audit(req,'Coupon saved',{id,code});res.json({id});}
router.post('/coupons',wrap(coupon));router.put('/coupons/:id',wrap(coupon));
router.get('/orders',wrap(async(req,res)=>{const [orders]=await pool.query(`select o.*,u.email,u.is_active as customer_active,p.full_name,p.mobile,e.title,e.slug,e.author,e.cover_path,case when ${require('../purchase-access').paidCondition()} then 1 else 0 end as can_download from orders o join users u on u.id=o.user_id left join profiles p on p.user_id=u.id join ebooks e on e.id=o.ebook_id order by o.id desc`);res.json({orders});}));
router.post('/orders/:id/resend',wrap(async(req,res)=>{
 const [[o]]=await pool.execute(`select o.*,u.email,e.title,e.pdf_path,e.slug from orders o join users u on u.id=o.user_id join ebooks e on e.id=o.ebook_id where o.id=?`,[req.params.id]);
 if(!o||o.status!=='paid'||(o.payment_method==='test'?!require('../purchase-access').testEnabled():!o.verified_at))fail('Only verified paid orders can be resent.');
 const pdf=filePath(o.pdf_path||(o.slug==='fitness-for-busy-professionals'?'server/private/ebooks/fitness-for-busy-professionals.pdf':''),'pdf');if(!pdf)fail('Upload the product PDF first.');
 const [claim]=await pool.execute('update orders set email_attempt_at=now(),email_attempt_count=email_attempt_count+1 where id=? and (email_attempt_at is null or email_attempt_at<date_sub(now(),interval 2 minute))',[o.id]);if(!claim.affectedRows)fail('Wait two minutes between delivery attempts.',429);
 try{await sendBookEmail(o.delivery_email||o.email,o.id,o.amount_paise,path.resolve(__dirname,'../..',pdf),o.title,o.payment_method==='test');}catch(error){await pool.execute('update orders set email_last_error=? where id=?',[String(error.code||'DELIVERY_FAILED').replace(/[^A-Z0-9_]/gi,'').slice(0,60),o.id]);fail('The email could not be sent. Check the email configuration and try again.',502);}
 await pool.execute('update orders set email_sent_at=now(),email_last_error=null where id=?',[o.id]);await audit(req,'Download email resent',{order:o.id});res.json({ok:true});
}));
router.post('/orders/:id/refund',wrap(async(req,res)=>{
 const [r]=await pool.execute("update orders set status='refunded' where id=? and status='paid' and payment_method='test'",[req.params.id]);
 if(!r.affectedRows)fail('Only paid test orders can be refunded here. Real refunds require a connected payment gateway.');
 await audit(req,'Test order refunded',{order:req.params.id});res.json({ok:true});
}));
router.get('/customers',wrap(async(req,res)=>{const [customers]=await pool.query(`select u.id,u.email,u.is_verified,u.is_active,u.role,u.created_at,p.full_name,p.mobile,count(o.id) orders,max(o.created_at) last_purchase,coalesce(sum(case when o.status='paid' and o.verified_at is not null and coalesce(o.payment_method,'')<>'test' then o.amount_paise else 0 end),0) lifetime_paise from users u left join profiles p on p.user_id=u.id left join orders o on o.user_id=u.id group by u.id,p.full_name,p.mobile order by u.id desc`);res.json({customers});}));
router.get('/settings',wrap(async(req,res)=>{const [rows]=await pool.query('select * from store_settings');res.json({settings:Object.fromEntries(rows.map(r=>[r.setting_key,r.setting_value])),payments:{mode:'test',enabled:process.env.NODE_ENV!=='production'&&process.env.TEST_PAYMENTS_ENABLED!=='false'},smtp_configured:Boolean(process.env.SMTP_USER&&process.env.SMTP_PASSWORD)});}));
router.put('/settings',wrap(async(req,res)=>{const b=req.body;const values={store_name:text(b.store_name,120),support_email:text(b.support_email,254),gstin:text(b.gstin,15)};if(values.support_email&&!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(values.support_email))fail('Enter a valid support email.');if(values.gstin&&!/^[0-9A-Z]{15}$/.test(values.gstin))fail('GSTIN must be 15 uppercase letters and digits.');const c=await pool.getConnection();try{await c.beginTransaction();for(const [k,v] of Object.entries(values))await c.execute('insert into store_settings(setting_key,setting_value) values (?,?) on duplicate key update setting_value=values(setting_value)',[k,v]);await c.commit();}catch(e){await c.rollback();throw e;}finally{c.release();}await audit(req,'Store settings updated',values);res.json({ok:true});}));
router.get('/team',wrap(async(req,res)=>{if(!req.isOwner)fail('Only the owner can manage admin access.',403);const [members]=await pool.query("select email,created_at from users where role='ADMIN' and is_owner=0");res.json({owner:req.user.email,members});}));
router.post('/team',wrap(async(req,res)=>{
 if(!req.isOwner)fail('Only the owner can grant admin access.',403);
 const email=text(req.body.email,254).toLowerCase();
 const c=await pool.getConnection();try{await c.beginTransaction();
 const [[u]]=await c.execute('select id,is_verified,is_active,is_owner from users where email=? for update',[email]);
 if(!u||!u.is_verified||!u.is_active||u.is_owner)fail('Choose an existing verified, active customer account.');
 await c.execute("update users set role='ADMIN' where id=?",[u.id]);
 await c.execute('insert ignore into admin_members(email) values (?)',[email]);await c.commit();
 }catch(e){await c.rollback();throw e;}finally{c.release();}
 await audit(req,'Admin access granted',{email});res.status(201).json({ok:true});
}));
router.delete('/team/:email',wrap(async(req,res)=>{
 if(!req.isOwner)fail('Only the owner can revoke admin access.',403);
 const c=await pool.getConnection();try{await c.beginTransaction();
 const [r]=await c.execute("update users set role='CUSTOMER',session_version=session_version+1 where email=? and is_owner=0 and role='ADMIN'",[req.params.email]);
 if(!r.affectedRows)fail('Administrator not found or owner access cannot be revoked.',400);
 await c.execute('delete from admin_members where email=?',[req.params.email]);await c.commit();
 }catch(e){await c.rollback();throw e;}finally{c.release();}
 await audit(req,'Admin access revoked',{email:req.params.email});res.json({ok:true});
}));
router.post('/team/:email/invite',wrap(async(req,res)=>{
 if(!req.isOwner)fail('Only the owner can invite admins.',403);
 const [[member]]=await pool.execute("select email from users where email=? and role='ADMIN' and is_active=1",[req.params.email]);
 if(!member)fail('Grant access before sending an invitation.');
 if(!await require('../rate-limit').take('admin-invite:'+member.email,1,120))fail('Wait two minutes between invitations.',429);
 await sendAdminInvite(member.email);await audit(req,'Admin invitation sent',{email:member.email});res.json({ok:true});
}));
router.put('/customers/:id/access',wrap(async(req,res)=>{
 const active=req.body.active;if(typeof active!=='boolean')fail('Choose an account access status.');
 const [r]=await pool.execute("update users set is_active=?,session_version=session_version+1 where id=? and role='CUSTOMER'",[active,req.params.id]);
 if(!r.affectedRows)fail('Customer not found. Admin accounts must be managed by the owner.',404);
 await audit(req,active?'Customer access restored':'Customer access suspended',{id:req.params.id});res.json({ok:true});
}));
router.get('/activity',wrap(async(req,res)=>{const [activity]=await pool.query('select a.*,u.email from activity_log a left join users u on u.id=a.user_id order by a.id desc limit 200');res.json({activity});}));
module.exports=router;
