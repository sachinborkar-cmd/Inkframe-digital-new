const express = require('express');
const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const Razorpay = require('razorpay');
const pool = require('../database');
const { requireAuth } = require('../middleware');
const { reserveOrderNumbers } = require('../order-numbering');
const { deliverOrder } = require('../book-delivery');
const { paidFile, checkEbookExists } = require('../book-files');

const router = express.Router();

let razorpayClient = null;
function getRazorpayClient() {
  const keyId = process.env.RAZORPAY_KEY_ID;
  const keySecret = process.env.RAZORPAY_KEY_SECRET;
  if (!keyId || !keySecret) {
    throw new Error('Razorpay is not configured. Set RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET.');
  }
  if (!razorpayClient || razorpayClient.key_id !== keyId) {
    razorpayClient = new Razorpay({ key_id: keyId, key_secret: keySecret });
  }
  return razorpayClient;
}

function setRazorpayClient(client) {
  razorpayClient = client;
}

function isLiveEnabled() {
  return Boolean(process.env.RAZORPAY_KEY_ID && process.env.RAZORPAY_KEY_SECRET);
}

function publicOrder(order) {
  if (!order) return null;
  const { pdf_path, customer_details, ...rest } = order;
  return rest;
}

async function receipt(id, userId) {
  const [[order]] = await pool.execute(
    `select o.id, o.order_number, o.amount_paise, o.status, o.payment_method, o.delivery_email,
            o.email_sent_at, o.checkout_group, o.verified_at, e.title, e.slug, e.pdf_path
     from orders o join ebooks e on e.id = o.ebook_id
     where o.id = ? and o.user_id = ?`,
    [id, userId]
  );
  return order;
}

async function orderResult(id, userId) {
  const order = await receipt(id, userId);
  if (!order) return null;
  const [ids] = order.checkout_group
    ? await pool.execute('select id from orders where checkout_group = ? and user_id = ? order by id', [order.checkout_group, userId])
    : [[{ id: order.id }]];
  const orders = await Promise.all(ids.map(r => receipt(r.id, userId)));
  return { order: publicOrder(order), orders: orders.map(publicOrder) };
}

// 1. Payment configuration endpoint
router.get('/config', (req, res) => {
  const live = isLiveEnabled();
  res.json({
    live_enabled: live,
    test_enabled: require('../purchase-access').testEnabled(),
    key_id: live ? process.env.RAZORPAY_KEY_ID : null
  });
});

// 2. Order creation handler
async function createOrder(req, res, next) {
  if (!isLiveEnabled()) {
    return res.status(503).json({ error: 'Live payments are currently not configured.' });
  }

  const b = req.body;
  const key = b.checkout_key;
  if (b.coupon && (typeof b.coupon !== 'string' || b.coupon.length > 40)) {
    return res.status(400).json({ error: 'Invalid coupon code.' });
  }
  if (!/^[a-zA-Z0-9-]{16,64}$/.test(key || '')) {
    return res.status(400).json({ error: 'Invalid checkout reference.' });
  }
  const slugs = Array.isArray(b.slugs) ? [...new Set(b.slugs)] : [];
  if (!slugs.length || slugs.length > 20 || slugs.some(s => typeof s !== 'string' || !/^[a-z0-9-]{1,160}$/.test(s))) {
    return res.status(400).json({ error: 'Choose between 1 and 20 published ebooks.' });
  }
  const name = String(b.full_name || '').trim();
  const phone = String(b.phone || '').trim();
  if (name.length < 2 || name.length > 120 || (phone && !/^[0-9+() -]{7,24}$/.test(phone)) || !['India', 'Other'].includes(b.country) || b.terms !== true) {
    return res.status(400).json({ error: 'Enter valid customer details and accept the terms.' });
  }

  let c;
  try {
    c = await pool.getConnection();
    await c.beginTransaction();

    const [[user]] = await c.execute('select email from users where id = ? and is_verified = 1 and is_active = 1 for update', [req.session.userId]);
    if (!user) {
      await c.rollback();
      return res.status(403).json({ error: 'Verify your account before checkout.' });
    }

    // Check if pending order with this checkout key already exists
    const [existing] = await c.execute(
      `select id, order_number, amount_paise, gateway_order_id, status
       from orders where (checkout_group = ? or checkout_key = ?) and user_id = ? and payment_method = 'razorpay'
       order by id`,
      [key, key, req.session.userId]
    );

    if (existing.length && existing.every(o => o.status === 'pending' && o.gateway_order_id)) {
      const totalAmount = existing.reduce((sum, o) => sum + o.amount_paise, 0);
      await c.commit();
      return res.json({
        ok: true,
        key_id: process.env.RAZORPAY_KEY_ID,
        order_id: existing[0].gateway_order_id,
        amount: totalAmount,
        currency: 'INR',
        customer: { name, email: user.email, phone }
      });
    }

    // Fetch and validate published ebooks
    const [books] = await c.query(
      `select id, price_paise, pdf_path from ebooks where slug in (${slugs.map(() => '?').join(',')}) and status = 'published' order by id`,
      slugs
    );
    if (books.length !== slugs.length) {
      await c.rollback();
      return res.status(400).json({ error: 'One or more books are no longer available.' });
    }

    for (const book of books) {
      await checkEbookExists(book.pdf_path);
    }

    // Server-side calculation of subtotal, discount, and total
    const subtotal = books.reduce((sum, book) => sum + book.price_paise, 0);
    let discount = 0;
    let eligibleId = null;
    let eligibleSubtotal = subtotal;
    let couponRecord = null;

    if (b.coupon) {
      const [[coupon]] = await c.execute(
        `select * from coupons where code = ? and status = 'active'
         and (expires_at is null or expires_at > now())
         and (usage_limit is null or used_count < usage_limit) for update`,
        [String(b.coupon).trim().toUpperCase()]
      );
      if (!coupon || subtotal < coupon.minimum_paise) {
        await c.rollback();
        return res.status(400).json({ error: 'Coupon is no longer valid. Remove it or apply another code.' });
      }
      couponRecord = coupon;
      eligibleId = coupon.ebook_id;
      eligibleSubtotal = books.filter(book => !eligibleId || book.id === eligibleId).reduce((sum, book) => sum + book.price_paise, 0);
      if (!eligibleSubtotal) {
        await c.rollback();
        return res.status(400).json({ error: 'This coupon does not apply to the selected products.' });
      }
      discount = Math.min(
        eligibleSubtotal,
        coupon.discount_type === 'percent'
          ? Math.floor(eligibleSubtotal * coupon.discount_value / 100)
          : coupon.discount_value
      );
    }

    const totalAmount = Math.max(0, subtotal - discount);
    if (totalAmount < 100) {
      // Razorpay online checkout requires a minimum of 100 paise (₹1)
      await c.rollback();
      return res.status(400).json({ error: 'Payable amount must be at least ₹1.00 for online checkout.' });
    }

    // Call Razorpay API to create order
    const rzp = getRazorpayClient();
    const rzpOrder = await rzp.orders.create({
      amount: totalAmount,
      currency: 'INR',
      receipt: `rcpt_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`,
      notes: {
        checkout_key: key,
        user_id: String(req.session.userId)
      }
    });

    // Reserve order numbers in sequence
    const firstOrderNumber = await reserveOrderNumbers(c, books.length);
    let allocated = 0;
    let cumulative = 0;

    for (let i = 0; i < books.length; i++) {
      const book = books[i];
      cumulative += (!eligibleId || book.id === eligibleId) ? book.price_paise : 0;
      const target = eligibleSubtotal ? Math.floor(discount * cumulative / eligibleSubtotal) : 0;
      const share = target - allocated;
      allocated = target;

      await c.execute(
        `insert into orders (
          order_number, user_id, ebook_id, amount_paise, status, payment_method,
          checkout_key, checkout_group, delivery_email, customer_details, gateway_order_id
        ) values (?, ?, ?, ?, 'pending', 'razorpay', ?, ?, ?, ?, ?)`,
        [
          firstOrderNumber + i,
          req.session.userId,
          book.id,
          book.price_paise - share,
          i ? key + '-' + i : key,
          key,
          user.email,
          JSON.stringify({
            full_name: name,
            phone,
            country: b.country,
            coupon_code: couponRecord ? couponRecord.code : null,
            coupon_id: couponRecord ? couponRecord.id : null
          }),
          rzpOrder.id
        ]
      );
    }

    await c.execute(
      `insert into profiles(user_id, full_name, mobile) values (?, ?, ?)
       on duplicate key update full_name = values(full_name), mobile = values(mobile)`,
      [req.session.userId, name, phone]
    );

    await c.commit();

    res.status(201).json({
      ok: true,
      key_id: process.env.RAZORPAY_KEY_ID,
      order_id: rzpOrder.id,
      amount: totalAmount,
      currency: 'INR',
      customer: { name, email: user.email, phone }
    });
  } catch (error) {
    if (c) await c.rollback().catch(() => {});
    next(error);
  } finally {
    if (c) c.release();
  }
}

router.post('/create-order', requireAuth, createOrder);

// 3. Payment verification endpoint
router.post('/verify', requireAuth, async (req, res, next) => {
  const { razorpay_order_id, razorpay_payment_id, razorpay_signature } = req.body;

  if (
    typeof razorpay_order_id !== 'string' ||
    typeof razorpay_payment_id !== 'string' ||
    typeof razorpay_signature !== 'string' ||
    !razorpay_order_id.trim() ||
    !razorpay_payment_id.trim() ||
    !razorpay_signature.trim()
  ) {
    return res.status(400).json({ error: 'Missing or invalid payment signature parameters.' });
  }

  const secret = process.env.RAZORPAY_KEY_SECRET;
  if (!secret) {
    return res.status(500).json({ error: 'Payment gateway secret is not configured.' });
  }

  // Cryptographic HMAC SHA-256 signature verification
  const generatedSignature = crypto
    .createHmac('sha256', secret)
    .update(`${razorpay_order_id}|${razorpay_payment_id}`)
    .digest('hex');

  const expBuf = Buffer.from(generatedSignature, 'utf8');
  const recBuf = Buffer.from(razorpay_signature, 'utf8');
  if (expBuf.length !== recBuf.length || !crypto.timingSafeEqual(expBuf, recBuf)) {
    return res.status(400).json({ error: 'Payment signature verification failed.' });
  }

  let c;
  try {
    c = await pool.getConnection();
    await c.beginTransaction();

    const [orders] = await c.execute(
      `select o.id, o.status, o.amount_paise, o.ebook_id, o.customer_details, o.gateway_payment_id
       from orders o where o.gateway_order_id = ? and o.user_id = ? for update`,
      [razorpay_order_id, req.session.userId]
    );

    if (!orders.length) {
      await c.rollback();
      return res.status(404).json({ error: 'Order not found for this account.' });
    }

    // Idempotency: if already paid, return existing success state without re-running mutations
    if (orders.every(o => o.status === 'paid')) {
      await c.commit();
      return res.json({ ok: true, order_id: orders[0].id, already_paid: true });
    }

    const pendingOrders = orders.filter(o => o.status === 'pending');
    if (!pendingOrders.length) {
      await c.rollback();
      return res.status(400).json({ error: 'Order is no longer in a payable state.' });
    }

    // Update pending orders to paid
    await c.execute(
      `update orders
       set status = 'paid', verified_at = now(), gateway_payment_id = ?, email_attempt_at = null
       where gateway_order_id = ? and user_id = ? and status = 'pending'`,
      [razorpay_payment_id, razorpay_order_id, req.session.userId]
    );

    // Increment coupon used_count if coupon was used
    try {
      const details = typeof orders[0].customer_details === 'string'
        ? JSON.parse(orders[0].customer_details)
        : orders[0].customer_details;
      if (details && details.coupon_id) {
        await c.execute('update coupons set used_count = used_count + 1 where id = ?', [details.coupon_id]);
      }
    } catch (_) {}

    // Clean up purchased books from cart
    for (const o of orders) {
      await c.execute('delete from carts where user_id = ? and ebook_id = ?', [req.session.userId, o.ebook_id]);
    }

    await c.commit();
    c.release();
    c = null;

    // Asynchronously trigger eBook delivery only for newly-paid orders
    for (const o of pendingOrders) {
      deliverOrder(o.id).catch(e => console.error('Delivery trigger error:', e.code || 'DELIVERY_FAILED'));
    }

    res.json({ ok: true, order_id: orders[0].id });
  } catch (error) {
    if (c) await c.rollback().catch(() => {});
    next(error);
  } finally {
    if (c) c.release();
  }
});

// 4. Webhook handler (must be called with raw Buffer body)
async function handleWebhook(req, res) {
  const secret = process.env.RAZORPAY_WEBHOOK_SECRET;
  if (!secret) {
    return res.status(500).json({ error: 'Webhook secret is not configured.' });
  }

  const signature = req.get('x-razorpay-signature');
  if (!signature) {
    return res.status(400).json({ error: 'Missing webhook signature header.' });
  }

  const rawBody = Buffer.isBuffer(req.body) ? req.body : Buffer.from(req.body || '');
  const expectedSignature = crypto.createHmac('sha256', secret).update(rawBody).digest('hex');

  const expBuf = Buffer.from(expectedSignature, 'utf8');
  const recBuf = Buffer.from(signature, 'utf8');
  if (expBuf.length !== recBuf.length || !crypto.timingSafeEqual(expBuf, recBuf)) {
    return res.status(400).json({ error: 'Invalid webhook signature.' });
  }

  let eventPayload;
  try {
    eventPayload = JSON.parse(rawBody.toString('utf8'));
  } catch (_) {
    return res.status(400).json({ error: 'Invalid webhook payload JSON.' });
  }

  const eventName = eventPayload.event;

  if (eventName === 'payment.captured' || eventName === 'order.paid') {
    const paymentEntity = eventPayload.payload?.payment?.entity;
    const orderId = paymentEntity?.order_id || eventPayload.payload?.order?.entity?.id;
    const paymentId = paymentEntity?.id;

    if (!orderId) {
      return res.status(200).json({ status: 'ignored_no_order_id' });
    }

    let c;
    try {
      c = await pool.getConnection();
      await c.beginTransaction();

      const [orders] = await c.execute(
        'select id, user_id, ebook_id, status, customer_details from orders where gateway_order_id = ? for update',
        [orderId]
      );

      if (!orders.length || orders.every(o => o.status === 'paid')) {
        await c.commit();
        return res.status(200).json({ status: 'already_paid_or_not_found' });
      }

      const pendingOrders = orders.filter(o => o.status === 'pending');
      if (!pendingOrders.length) {
        await c.commit();
        return res.status(200).json({ status: 'not_payable' });
      }

      await c.execute(
        `update orders
         set status = 'paid', verified_at = now(), gateway_payment_id = coalesce(?, gateway_payment_id), email_attempt_at = null
         where gateway_order_id = ? and status = 'pending'`,
        [paymentId || null, orderId]
      );

      try {
        const details = typeof orders[0].customer_details === 'string'
          ? JSON.parse(orders[0].customer_details)
          : orders[0].customer_details;
        if (details && details.coupon_id) {
          await c.execute('update coupons set used_count = used_count + 1 where id = ?', [details.coupon_id]);
        }
      } catch (_) {}

      for (const o of orders) {
        await c.execute('delete from carts where user_id = ? and ebook_id = ?', [o.user_id, o.ebook_id]);
      }

      await c.commit();
      c.release();
      c = null;

      for (const o of pendingOrders) {
        deliverOrder(o.id).catch(e => console.error('Webhook delivery trigger error:', e.code || 'DELIVERY_FAILED'));
      }

      return res.status(200).json({ status: 'captured' });
    } catch (err) {
      if (c) await c.rollback().catch(() => {});
      console.error('Webhook processing error:', err.code || 'WEBHOOK_FAILED');
      return res.status(500).json({ error: 'Webhook processing failed.' });
    } finally {
      if (c) c.release();
    }
  } else if (eventName === 'payment.failed') {
    const orderId = eventPayload.payload?.payment?.entity?.order_id;
    if (orderId) {
      await pool.execute(
        "update orders set status = 'failed' where gateway_order_id = ? and status = 'pending'",
        [orderId]
      ).catch(() => {});
    }
    return res.status(200).json({ status: 'payment_failed_recorded' });
  }

  return res.status(200).json({ status: 'ignored' });
}

router.post('/webhook', handleWebhook);

// 5. Order lookup for thank-you confirmation page
router.get('/orders/:id', requireAuth, async (req, res, next) => {
  try {
    const body = await orderResult(req.params.id, req.session.userId);
    if (!body) return res.status(404).json({ error: 'Order not found.' });
    res.json(body);
  } catch (e) {
    next(e);
  }
});

// 6. Retry email delivery for live orders
router.post('/orders/:id/retry-email', requireAuth, async (req, res, next) => {
  try {
    const body = await orderResult(req.params.id, req.session.userId);
    if (!body) return res.status(404).json({ error: 'Order not found.' });
    await Promise.all(body.orders.filter(o => o.status === 'paid').map(async o => deliverOrder(o.id)));
    res.json(await orderResult(req.params.id, req.session.userId));
  } catch (e) {
    next(e);
  }
});

module.exports = { router, createOrder, handleWebhook, isLiveEnabled, setRazorpayClient };
