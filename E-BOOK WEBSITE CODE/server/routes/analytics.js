const express=require('express');
const pool=require('../database');
const {requireAdmin}=require('../middleware');
const router=express.Router();router.use(requireAdmin);
router.get('/',async(req,res,next)=>{try{
  const real="payment_method is not null and payment_method<>'test'";
  const [[totals]]=await pool.query(`select count(*) total_orders,
    coalesce(sum(status='paid' and verified_at is not null and ${real}),0) successful_orders,
    coalesce(sum(status='failed' and ${real}),0) failed_payments,
    coalesce(sum(case when status='paid' and verified_at is not null and ${real} then amount_paise else 0 end),0) revenue_paise,
    coalesce(sum(payment_method='test'),0) test_orders from orders`);
  const [[counts]]=await pool.query("select (select count(*) from ebooks) books,(select count(*) from users where role='CUSTOMER') customers");
  const [monthly]=await pool.query(`select date_format(created_at,'%Y-%m') month,
    sum(status='paid' and verified_at is not null) purchases,sum(status='failed') failed_payments,
    sum(case when status='paid' and verified_at is not null then amount_paise else 0 end) revenue_paise
    from orders where ${real} and created_at>=date_format(date_sub(now(),interval 11 month),'%Y-%m-01') group by month order by month`);
  const [bestsellers]=await pool.query(`select e.title,count(*) purchases,sum(o.amount_paise) revenue_paise
    from orders o join ebooks e on e.id=o.ebook_id where o.status='paid' and verified_at is not null and o.${real}
    group by e.id order by purchases desc,revenue_paise desc limit 10`);
  const [recent]=await pool.query('select o.id,o.status,o.amount_paise,o.payment_method,o.created_at,e.title from orders o join ebooks e on e.id=o.ebook_id order by o.id desc limit 8');
  res.json({totals:{...totals,...counts},monthly,bestsellers,recent});
}catch(e){next(e);}});
module.exports=router;
