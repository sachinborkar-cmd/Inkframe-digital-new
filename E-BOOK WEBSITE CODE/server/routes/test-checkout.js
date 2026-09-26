const express=require('express');
const fs=require('node:fs/promises');
const pool=require('../database');
const {reserveOrderNumbers}=require('../order-numbering');
const {requireAuth}=require('../middleware');
const {deliverOrder}=require('../book-delivery');
const {paidFile, checkEbookExists}=require('../book-files');
const router=express.Router();router.use(requireAuth);
router.param('id',require('../input-validation').idParam);
router.use((req,res,next)=>require('../purchase-access').testEnabled()?next():res.status(403).json({error:'Test payments are disabled.'}));
async function receipt(id,userId){const [[order]]=await pool.execute(`select o.id,o.order_number,o.amount_paise,o.status,o.delivery_email,o.email_sent_at,o.checkout_group,e.title,e.slug,e.pdf_path from orders o join ebooks e on e.id=o.ebook_id where o.id=? and o.user_id=? and o.payment_method='test'`,[id,userId]);return order;}
async function deliver(o){if(o)await deliverOrder(o.id);}
async function result(id,userId){const order=await receipt(id,userId);if(!order)return null;const [ids]=order.checkout_group?await pool.execute('select id from orders where checkout_group=? and user_id=? order by id',[order.checkout_group,userId]):[[{id:order.id}]];const orders=await Promise.all(ids.map(r=>receipt(r.id,userId)));return {order:publicOrder(order),orders:orders.map(publicOrder)};}
function publicOrder(o){const {pdf_path,checkout_group,...rest}=o;return rest;}
router.post('/',async(req,res,next)=>{
 if(process.env.NODE_ENV==='production'||process.env.TEST_PAYMENTS_ENABLED==='false')return res.status(403).json({error:'Test payments are disabled.'});
 const b=req.body,key=b.checkout_key;
 if(b.coupon && (typeof b.coupon!=='string'||b.coupon.length>40))return res.status(400).json({error:'Invalid coupon code.'});
 if(!/^[a-zA-Z0-9-]{16,64}$/.test(key||''))return res.status(400).json({error:'Invalid checkout reference.'});
 const slugs=Array.isArray(b.slugs)?[...new Set(b.slugs)]:[];
 if(!slugs.length||slugs.length>20||slugs.some(s=>typeof s!=='string'||!/^[a-z0-9-]{1,160}$/.test(s)))return res.status(400).json({error:'Choose between 1 and 20 published ebooks.'});
 const name=String(b.full_name||'').trim(),phone=String(b.phone||'').trim();
 if(name.length<2||name.length>120||(phone&&!/^[0-9+() -]{7,24}$/.test(phone))||!['India','Other'].includes(b.country)||b.terms!==true)return res.status(400).json({error:'Enter valid customer details and accept the terms.'});
 let c;
 try{
  c=await pool.getConnection();await c.beginTransaction();
  const [[user]]=await c.execute('select email from users where id=? and is_verified=1 for update',[req.session.userId]);
  if(!user){await c.rollback();return res.status(403).json({error:'Verify your email before checkout.'});}
  const [existing]=await c.execute('select id from orders where (checkout_group=? or checkout_key=?) and user_id=? order by id',[key,key,req.session.userId]);
  const ids=existing.map(o=>o.id);
  if(!ids.length){
   const [books]=await c.query("select id,price_paise,pdf_path from ebooks where slug in ("+slugs.map(()=>'?').join(',')+") and status='published' order by id",slugs);
   if(books.length!==slugs.length){await c.rollback();return res.status(400).json({error:'One or more books are no longer available.'});}
   for(const book of books)await checkEbookExists(book.pdf_path);
   const subtotal=books.reduce((sum,book)=>sum+book.price_paise,0);let discount=0,eligibleId=null,eligibleSubtotal=subtotal;
   if(b.coupon){const [[coupon]]=await c.execute("select * from coupons where code=? and status='active' and (expires_at is null or expires_at>now()) and (usage_limit is null or used_count<usage_limit) for update",[String(b.coupon).trim().toUpperCase()]);if(!coupon||subtotal<coupon.minimum_paise){await c.rollback();return res.status(400).json({error:'Coupon is no longer valid. Remove it or apply another code.'});}eligibleId=coupon.ebook_id;eligibleSubtotal=books.filter(book=>!eligibleId||book.id===eligibleId).reduce((sum,book)=>sum+book.price_paise,0);if(!eligibleSubtotal){await c.rollback();return res.status(400).json({error:'This coupon does not apply to the selected products.'});}discount=Math.min(eligibleSubtotal,coupon.discount_type==='percent'?Math.floor(eligibleSubtotal*coupon.discount_value/100):coupon.discount_value);await c.execute('update coupons set used_count=used_count+1 where id=?',[coupon.id]);}
   const firstOrderNumber=await reserveOrderNumbers(c,books.length);
   let allocated=0,cumulative=0;
   for(let i=0;i<books.length;i++){const book=books[i];cumulative+=(!eligibleId||book.id===eligibleId)?book.price_paise:0;const target=eligibleSubtotal?Math.floor(discount*cumulative/eligibleSubtotal):0,share=target-allocated;allocated=target;const [r]=await c.execute("insert into orders(order_number,user_id,ebook_id,amount_paise,status,payment_method,checkout_key,checkout_group,delivery_email,customer_details) values (?,?,?,?,'paid','test',?,?,?,?)",[firstOrderNumber+i,req.session.userId,book.id,book.price_paise-share,i?key+'-'+i:key,key,user.email,JSON.stringify({full_name:name,phone,country:b.country})]);ids.push(r.insertId);await c.execute('delete from carts where user_id=? and ebook_id=?',[req.session.userId,book.id]);}
   await c.execute('insert into profiles(user_id,full_name,mobile) values (?,?,?) on duplicate key update full_name=values(full_name),mobile=values(mobile)',[req.session.userId,name,phone]);
  }
  await c.commit();c.release();c=null;
  await Promise.all(ids.map(async id=>deliver(await receipt(id,req.session.userId))));
  res.status(201).json(await result(ids[0],req.session.userId));
 }catch(e){if(c)await c.rollback();next(e);}finally{if(c)c.release();}
});
router.get('/:id',async(req,res,next)=>{try{const body=await result(req.params.id,req.session.userId);if(!body)return res.status(404).json({error:'Order not found.'});res.json(body);}catch(e){next(e);}});
router.post('/:id/retry-email',async(req,res,next)=>{try{const body=await result(req.params.id,req.session.userId);if(!body)return res.status(404).json({error:'Order not found.'});await Promise.all(body.orders.filter(o=>o.status==='paid').map(async o=>deliver(await receipt(o.id,req.session.userId))));res.json(await result(req.params.id,req.session.userId));}catch(e){next(e);}});
module.exports=router;
