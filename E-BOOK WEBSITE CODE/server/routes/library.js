const express = require('express');
const pool = require('../database');
const { requireAuth } = require('../middleware');

const {paidCondition}=require('../purchase-access');
const router = express.Router();
router.use(requireAuth);

router.get('/:slug/download', async (request, response, next) => {
  try {
    const [[order]] = await pool.execute(`select o.id,e.pdf_path,e.title from orders o join ebooks e on e.id=o.ebook_id where o.user_id=? and ${paidCondition()} and e.slug=? order by o.id desc limit 1`, [request.session.userId, request.params.slug]);
    if (!order) return response.status(403).json({error:'Purchase this book to download it.'});
    response.setHeader('Cache-Control', 'private, no-store');
    response.download(require('../book-files').paidFile(order.pdf_path), order.title.replace(/[^a-zA-Z0-9 -]/g,'').slice(0,100)+'.pdf', async error => {
      if (error) return next(error);
      try { await pool.execute('update orders set download_count=download_count+1 where id=?',[order.id]); } catch(e) { console.error('Download count update failed.'); }
    });
  } catch (error) { next(error); }
});

router.get('/', async (request, response, next) => {
  try {
    const [books] = await pool.execute(
      `select e.slug, e.title, e.author, e.cover_path, e.pdf_path, e.epub_path, o.created_at as purchased_at
       from orders o join ebooks e on e.id = o.ebook_id
       where o.user_id = ? and ${paidCondition()} order by o.created_at desc`,
      [request.session.userId]
    );
    const [orders] = await pool.execute(
      `select o.id, e.slug, e.title, e.author, e.cover_path, o.amount_paise, o.status, o.payment_method, o.created_at,
       o.download_count, o.email_sent_at, case when ${paidCondition()} then 1 else 0 end as can_download
       from orders o join ebooks e on e.id=o.ebook_id where o.user_id=? order by o.created_at desc, o.id desc`,
      [request.session.userId]
    );
    const uniqueBooks = books.filter((book, index) => books.findIndex(other => other.slug === book.slug) === index);
    response.setHeader('Cache-Control', 'no-store');
    response.json({ orders: orders.map(order => ({...order, can_download: Boolean(order.can_download), download_url: order.can_download ? '/api/library/'+encodeURIComponent(order.slug)+'/download' : null})), books: uniqueBooks.map(book => ({...book, pdf_path:'/api/library/'+encodeURIComponent(book.slug)+'/download', epub_path:null})) });
  } catch (error) {
    next(error);
  }
});

module.exports = router;
