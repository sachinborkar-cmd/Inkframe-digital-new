const pool = require('./database');
const {sendBookEmail} = require('./email');
const {paidFile} = require('./book-files');
const {paidCondition} = require('./purchase-access');

async function deliverOrder(id) {
  const [[order]] = await pool.execute(`select o.id,o.delivery_email,o.amount_paise,o.payment_method,e.pdf_path,e.title
    from orders o join ebooks e on e.id=o.ebook_id
    where o.id=? and ${paidCondition()} and o.email_sent_at is null`, [id]);
  if (!order) return false;
  const [claim] = await pool.execute(`update orders set email_attempt_at=now(),email_attempt_count=email_attempt_count+1
    where id=? and status='paid' and email_sent_at is null
    and (email_attempt_at is null or email_attempt_at<date_sub(now(),interval 2 minute))`, [id]);
  if (!claim.affectedRows) return false;
  try {
    await sendBookEmail(order.delivery_email, order.id, order.amount_paise, paidFile(order.pdf_path), order.title, order.payment_method === 'test');
    await pool.execute('update orders set email_sent_at=now(),email_last_error=null where id=?', [id]);
    return true;
  } catch (error) {
    const code = String(error.code || 'DELIVERY_FAILED').replace(/[^A-Z0-9_]/gi, '').slice(0,60);
    await pool.execute('update orders set email_last_error=? where id=?', [code, id]);
    console.error('Book email delivery failed:', id, code);
    return false;
  }
}

let running = false;
async function retryPending() {
  if (running) return;
  running = true;
  try {
    const [orders] = await pool.query(`select o.id from orders o
      where ${paidCondition()} and o.email_sent_at is null and o.delivery_email is not null
      and o.email_attempt_count<5
      and (o.email_attempt_at is null or timestampdiff(second,o.email_attempt_at,now()) >= 120 * power(2,greatest(o.email_attempt_count-1,0)))
      order by o.id limit 5`);
    for (const order of orders) await deliverOrder(order.id);
  } catch (error) {
    console.error('Purchase email retry failed:', error.code || 'DELIVERY_FAILED');
  } finally { running = false; }
}

function startDeliveryRetries() {
  const initial = setTimeout(retryPending, 5000);
  const interval = setInterval(retryPending, 60000);
  initial.unref(); interval.unref();
  return () => { clearTimeout(initial); clearInterval(interval); };
}
module.exports = {deliverOrder, retryPending, startDeliveryRetries};
