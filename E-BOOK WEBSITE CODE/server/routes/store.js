const express = require('express');
const pool = require('../database');
const { requireAuth } = require('../middleware');
const router = express.Router();
router.use((req,res,next)=>{
  const b=req.body;
  if(b && ((b.slugs!==undefined && (!Array.isArray(b.slugs)||b.slugs.length>50||b.slugs.some(s=>!require('../input-validation').validSlug(s)))) ||
    (b.code!==undefined && (typeof b.code!=='string'||b.code.length>40)))) return res.status(400).json({error:'Invalid product selection or coupon code.'});
  next();
});

router.get('/products', async (req,res,next)=>{try {const [products]=await pool.query("select e.id,e.slug,e.title,e.author,e.price_paise,e.description,e.cover_path,e.sample_path,e.preview_pages,e.testimonials,c.slug category_slug,c.name category_name from ebooks e left join categories c on c.id=e.category_id where e.status='published' order by e.created_at desc");const [categories]=await pool.query("select id,name,slug,description,banner_path from categories where status='active' order by sort_order,name");const [settings]=await pool.query("select setting_key,setting_value from store_settings where setting_key in ('store_name','support_email')");for(const product of products){if(product.sample_path&&!await require('../sample-files').safeSample(product.sample_path))product.sample_path=null;}res.json({products,categories,settings:Object.fromEntries(settings.map(s=>[s.setting_key,s.setting_value]))});}catch(e){next(e);}});
router.get('/cart', requireAuth, async (req, res, next) => { try { const [items] = await pool.execute(`select e.id,e.slug,e.title,e.author,e.price_paise,e.cover_path from carts c join ebooks e on e.id=c.ebook_id where c.user_id=? and e.status='published'`, [req.session.userId]); res.json({ items }); } catch(e){ next(e); } });
router.put('/cart', requireAuth, async (req, res, next) => { try { const slugs = Array.isArray(req.body.slugs) ? [...new Set(req.body.slugs.map(String))].slice(0,50) : []; const connection=await pool.getConnection(); try { await connection.beginTransaction(); await connection.execute('delete from carts where user_id=?',[req.session.userId]); if(slugs.length){const marks=slugs.map(()=>'?').join(',');const [books]=await connection.query(`select id from ebooks where slug in (${marks}) and status='published'`,slugs);for(const book of books)await connection.execute('insert into carts(user_id,ebook_id) values (?,?)',[req.session.userId,book.id]);} await connection.commit(); } catch(e){await connection.rollback();throw e;} finally{connection.release();} res.json({ok:true}); }catch(e){next(e);} });
router.post('/coupon',async(req,res,next)=>{try{
const code=String(req.body.code||'').trim().toUpperCase(),slugs=Array.isArray(req.body.slugs)?req.body.slugs.filter(s=>typeof s==='string').slice(0,20):[];
if(!slugs.length)return res.status(400).json({error:'Choose a product first.'});
const [books]=await pool.query("select id,price_paise from ebooks where status='published' and slug in ("+slugs.map(()=>'?').join(',')+")",slugs);
const subtotal=books.reduce((sum,b)=>sum+b.price_paise,0);
const [[c]]=await pool.execute("select * from coupons where code=? and status='active' and (expires_at is null or expires_at>now()) and (usage_limit is null or used_count<usage_limit)",[code]);
if(!c||subtotal<c.minimum_paise)return res.status(400).json({error:'Coupon is invalid or the minimum order is not met.'});
const eligible=books.filter(b=>!c.ebook_id||b.id===c.ebook_id).reduce((sum,b)=>sum+b.price_paise,0);
if(!eligible)return res.status(400).json({error:'Coupon does not apply to these products.'});
res.json({coupon:c.code,discount_paise:Math.min(eligible,c.discount_type==='percent'?Math.floor(eligible*c.discount_value/100):c.discount_value)});
}catch(e){next(e);}});
router.post('/orders', requireAuth, require('./payments').createOrder);
module.exports=router;
