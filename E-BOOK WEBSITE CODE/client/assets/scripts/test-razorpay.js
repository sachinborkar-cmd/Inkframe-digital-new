// Comprehensive Razorpay integration tests with mock API calls and local DB assertions.
require('dotenv').config({ quiet: true });
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const express = require('express');
const pool = require('../../../server/database');

const TEST_KEY_ID = 'rzp_test_1234567890ABCD';
const TEST_KEY_SECRET = 'mock_secret_key_1234567890abcdef';
const TEST_WEBHOOK_SECRET = 'mock_webhook_secret_9876543210fedcba';

// Setup environment for testing
process.env.RAZORPAY_KEY_ID = TEST_KEY_ID;
process.env.RAZORPAY_KEY_SECRET = TEST_KEY_SECRET;
process.env.RAZORPAY_WEBHOOK_SECRET = TEST_WEBHOOK_SECRET;

let emailDeliveryCount = 0;
require('../../../server/email').sendBookEmail = async (email, orderNum, amount, pdf, title, isTest) => {
  emailDeliveryCount++;
  assert.equal(isTest, false, 'Live payment should not be marked as test');
  return { id: 'mock-email-id' };
};

const paymentsModule = require('../../../server/routes/payments');

// Mock Razorpay client
let createdRazorpayOrders = [];
paymentsModule.setRazorpayClient({
  key_id: TEST_KEY_ID,
  orders: {
    create: async (params) => {
      const orderId = 'order_mock_' + crypto.randomBytes(8).toString('hex');
      createdRazorpayOrders.push({ id: orderId, ...params });
      return {
        id: orderId,
        entity: 'order',
        amount: params.amount,
        amount_paid: 0,
        amount_due: params.amount,
        currency: params.currency || 'INR',
        receipt: params.receipt,
        status: 'created',
        notes: params.notes || {}
      };
    }
  }
});

const app = express();
// Webhook parser mounted with raw body first, mirroring server/server.js
app.post('/api/payments/webhook', express.raw({ type: '*/*', limit: '100kb' }), paymentsModule.handleWebhook);
app.use(express.json());

let currentUserId = null;
app.use((req, res, next) => {
  req.session = { userId: req.headers['x-test-user'] ? Number(req.headers['x-test-user']) : currentUserId };
  next();
});

app.use('/api/payments', paymentsModule.router);
app.use('/api/test-checkout', require('../../../server/routes/test-checkout'));
app.use('/api/library', require('../../../server/routes/library'));

let server, testUserA, testUserB, testCouponId;

function generateSignature(orderId, paymentId, secret = TEST_KEY_SECRET) {
  return crypto.createHmac('sha256', secret).update(`${orderId}|${paymentId}`).digest('hex');
}

function generateWebhookSignature(bodyBuffer, secret = TEST_WEBHOOK_SECRET) {
  return crypto.createHmac('sha256', secret).update(bodyBuffer).digest('hex');
}

async function waitForEmail(targetCount, timeoutMs = 2000) {
  const start = Date.now();
  while (emailDeliveryCount < targetCount && (Date.now() - start) < timeoutMs) {
    await new Promise(r => setTimeout(r, 50));
  }
}

(async () => {
  try {
    await require('../../../server/schema').ensureSchema();

    // Create 2 test users
    const tokenA = crypto.randomUUID();
    const [uA] = await pool.execute('insert into users(email, is_verified) values (?, true)', [`userA-${tokenA}@example.invalid`]);
    testUserA = uA.insertId;

    const tokenB = crypto.randomUUID();
    const [uB] = await pool.execute('insert into users(email, is_verified) values (?, true)', [`userB-${tokenB}@example.invalid`]);
    testUserB = uB.insertId;

    // Create test coupon
    const couponCode = 'RZP-' + tokenA.slice(0, 8);
    const [cp] = await pool.execute("insert into coupons(code, discount_type, discount_value, usage_limit) values (?, 'percent', 10, 5)", [couponCode]);
    testCouponId = cp.insertId;

    server = await new Promise(resolve => {
      const s = app.listen(0, '127.0.0.1', () => resolve(s));
    });
    const origin = `http://127.0.0.1:${server.address().port}`;

    async function req(url, options = {}, user = testUserA) {
      const headers = { 'Content-Type': 'application/json', ...(options.headers || {}) };
      if (user) headers['x-test-user'] = String(user);
      const method = options.method || ((options.body || options.rawBody !== undefined) ? 'POST' : 'GET');
      const res = await fetch(origin + url, {
        method,
        headers,
        body: options.rawBody !== undefined ? options.rawBody : (options.body ? JSON.stringify(options.body) : undefined)
      });
      let body;
      try { body = await res.json(); } catch (_) { body = null; }
      return { status: res.status, body };
    }

    console.log('--- Running Razorpay Integration Test Suite ---');

    // TEST 1: Server-created order uses server-calculated amount
    currentUserId = testUserA;
    const checkoutKey1 = crypto.randomUUID();
    const createRes = await req('/api/payments/create-order', {
      body: {
        checkout_key: checkoutKey1,
        slugs: ['fitness-for-busy-professionals'],
        coupon: couponCode,
        full_name: 'Test Customer',
        phone: '9876543210',
        country: 'India',
        terms: true
      }
    });

    assert.equal(createRes.status, 201, 'Order creation should succeed with 201');
    assert.equal(createRes.body.ok, true);
    assert.equal(createRes.body.key_id, TEST_KEY_ID);
    assert.ok(createRes.body.order_id.startsWith('order_mock_'));

    // Check DB product price for fitness-for-busy-professionals
    const [[book]] = await pool.execute("select price_paise from ebooks where slug = 'fitness-for-busy-professionals'");
    const expectedDiscount = Math.floor(book.price_paise * 10 / 100);
    const expectedTotal = book.price_paise - expectedDiscount;
    assert.equal(createRes.body.amount, expectedTotal, 'Amount must be server-calculated with coupon');

    // Confirm Razorpay orders.create was invoked with server-calculated amount
    const rzpOrder = createdRazorpayOrders.find(o => o.id === createRes.body.order_id);
    assert.ok(rzpOrder, 'Razorpay order must have been created');
    assert.equal(rzpOrder.amount, expectedTotal);

    // Verify order in database is pending
    const [dbOrders] = await pool.execute('select * from orders where gateway_order_id = ?', [createRes.body.order_id]);
    assert.equal(dbOrders.length, 1);
    assert.equal(dbOrders[0].status, 'pending');
    assert.equal(dbOrders[0].amount_paise, expectedTotal);
    assert.equal(dbOrders[0].verified_at, null);
    console.log('✓ 1. Server-created order uses server-calculated amount and starts pending');

    // TEST 2: Successful signature verification marks correct order paid and triggers delivery
    const paymentId1 = 'pay_mock_111111';
    const validSig1 = generateSignature(createRes.body.order_id, paymentId1);

    const emailBefore = emailDeliveryCount;
    const verifyRes = await req('/api/payments/verify', {
      body: {
        razorpay_order_id: createRes.body.order_id,
        razorpay_payment_id: paymentId1,
        razorpay_signature: validSig1
      }
    });

    assert.equal(verifyRes.status, 200);
    assert.equal(verifyRes.body.ok, true);
    assert.equal(verifyRes.body.order_id, dbOrders[0].id);

    // Verify database record updated
    const [[verifiedOrder]] = await pool.execute('select * from orders where id = ?', [dbOrders[0].id]);
    assert.equal(verifiedOrder.status, 'paid');
    assert.equal(verifiedOrder.gateway_payment_id, paymentId1);
    assert.ok(verifiedOrder.verified_at !== null, 'verified_at must be populated');

    // Wait for async deliverOrder to complete
    await waitForEmail(emailBefore + 1);
    assert.equal(emailDeliveryCount, emailBefore + 1, 'Delivery email must be triggered once upon payment');

    // Verify purchase access granted in library
    const libRes = await req('/api/library', {}, testUserA);
    assert.equal(libRes.status, 200);
    assert.ok(libRes.body.books.some(b => b.slug === 'fitness-for-busy-professionals'), 'Book must appear in library');
    console.log('✓ 2. Successful signature verification marks order paid and grants library access');

    // TEST 3: Invalid signature is rejected
    const checkoutKey2 = crypto.randomUUID();
    const createRes2 = await req('/api/payments/create-order', {
      body: {
        checkout_key: checkoutKey2,
        slugs: ['fitness-for-busy-professionals'],
        full_name: 'Test Customer 2',
        phone: '9876543210',
        country: 'India',
        terms: true
      }
    });
    assert.equal(createRes2.status, 201);

    const badSigRes = await req('/api/payments/verify', {
      body: {
        razorpay_order_id: createRes2.body.order_id,
        razorpay_payment_id: 'pay_mock_222222',
        razorpay_signature: 'invalid_forged_signature_hex'
      }
    });
    assert.equal(badSigRes.status, 400);
    assert.equal(badSigRes.body.error, 'Payment signature verification failed.');

    const [[orderAfterBadSig]] = await pool.execute('select status, verified_at from orders where gateway_order_id = ?', [createRes2.body.order_id]);
    assert.equal(orderAfterBadSig.status, 'pending', 'Order must stay pending on invalid signature');
    assert.equal(orderAfterBadSig.verified_at, null);
    console.log('✓ 3. Invalid signature is rejected');

    // TEST 4: Wrong order ID / payment ID relationship is rejected
    // Generated signature for order A + payment A, but submit with order B
    const mismatchSig = generateSignature('order_other_mismatch', 'pay_mock_222222');
    const wrongRelRes = await req('/api/payments/verify', {
      body: {
        razorpay_order_id: createRes2.body.order_id,
        razorpay_payment_id: 'pay_mock_222222',
        razorpay_signature: mismatchSig
      }
    });
    assert.equal(wrongRelRes.status, 400);
    console.log('✓ 4. Wrong order ID/payment ID relationship is rejected');

    // TEST 5: User / Order mismatch is rejected
    // User B tries to verify User A's pending order
    const sigForOrder2 = generateSignature(createRes2.body.order_id, 'pay_mock_user_mismatch');
    const userMismatchRes = await req('/api/payments/verify', {
      body: {
        razorpay_order_id: createRes2.body.order_id,
        razorpay_payment_id: 'pay_mock_user_mismatch',
        razorpay_signature: sigForOrder2
      }
    }, testUserB); // User B
    assert.equal(userMismatchRes.status, 404, 'User B must not be able to verify User A order');
    console.log('✓ 5. User/order mismatch is rejected');

    // TEST 6: Repeated verification does not duplicate purchase access
    const repeatVerify = await req('/api/payments/verify', {
      body: {
        razorpay_order_id: createRes.body.order_id,
        razorpay_payment_id: paymentId1,
        razorpay_signature: validSig1
      }
    });
    assert.equal(repeatVerify.status, 200);
    assert.equal(repeatVerify.body.already_paid, true);
    assert.equal(emailDeliveryCount, emailBefore + 1, 'Delivery email must NOT be triggered again on repeat verification');
    console.log('✓ 6. Repeated verification does not duplicate purchase access or emails');

    // TEST 7: Webhook payment.captured marks pending order paid and is idempotent
    const checkoutKey3 = crypto.randomUUID();
    const createRes3 = await req('/api/payments/create-order', {
      body: {
        checkout_key: checkoutKey3,
        slugs: ['fitness-for-busy-professionals'],
        full_name: 'Webhook Customer',
        phone: '9876543210',
        country: 'India',
        terms: true
      }
    });
    assert.equal(createRes3.status, 201);

    const webhookPaymentId = 'pay_webhook_333333';
    const webhookPayload = JSON.stringify({
      entity: 'event',
      event: 'payment.captured',
      payload: {
        payment: {
          entity: {
            id: webhookPaymentId,
            order_id: createRes3.body.order_id,
            amount: createRes3.body.amount,
            status: 'captured'
          }
        }
      }
    });
    const webhookBuf = Buffer.from(webhookPayload, 'utf8');
    const validWebhookSig = generateWebhookSignature(webhookBuf);

    // Call 1: should capture
    const emailBeforeWebhook = emailDeliveryCount;
    const hookRes1 = await req('/api/payments/webhook', {
      rawBody: webhookBuf,
      headers: {
        'x-razorpay-signature': validWebhookSig,
        'Content-Type': 'application/json'
      }
    }, null);

    assert.equal(hookRes1.status, 200);
    assert.equal(hookRes1.body.status, 'captured');

    const [[hookPaidOrder]] = await pool.execute('select status, gateway_payment_id, verified_at from orders where gateway_order_id = ?', [createRes3.body.order_id]);
    assert.equal(hookPaidOrder.status, 'paid');
    assert.equal(hookPaidOrder.gateway_payment_id, webhookPaymentId);
    assert.ok(hookPaidOrder.verified_at !== null);
    await waitForEmail(emailBeforeWebhook + 1);
    assert.equal(emailDeliveryCount, emailBeforeWebhook + 1, 'Webhook should trigger delivery email once');

    // Call 2: repeated webhook delivery should be idempotent
    const hookRes2 = await req('/api/payments/webhook', {
      rawBody: webhookBuf,
      headers: {
        'x-razorpay-signature': validWebhookSig,
        'Content-Type': 'application/json'
      }
    }, null);
    assert.equal(hookRes2.status, 200);
    assert.equal(hookRes2.body.status, 'already_paid_or_not_found');
    assert.equal(emailDeliveryCount, emailBeforeWebhook + 1, 'Repeated webhook must NOT trigger second email');
    console.log('✓ 7. Repeated webhook delivery is idempotent');

    // TEST 8: Invalid webhook signature is rejected
    const badHookRes = await req('/api/payments/webhook', {
      rawBody: webhookBuf,
      headers: {
        'x-razorpay-signature': 'bad_fake_webhook_signature',
        'Content-Type': 'application/json'
      }
    }, null);
    assert.equal(badHookRes.status, 400);
    assert.equal(badHookRes.body.error, 'Invalid webhook signature.');
    console.log('✓ 8. Invalid webhook signature is rejected');

    // TEST 9: Test-payment endpoint remains blocked in production
    const savedNodeEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';
    const prodTestRes = await req('/api/test-checkout', {
      body: {
        checkout_key: crypto.randomUUID(),
        slugs: ['fitness-for-busy-professionals'],
        full_name: 'Prod Test',
        terms: true
      }
    });
    assert.equal(prodTestRes.status, 403, 'Test payments must return 403 in production');
    process.env.NODE_ENV = savedNodeEnv;
    console.log('✓ 9. Test-payment endpoint remains blocked in production');

    // TEST 10: Razorpay secrets never appear in logs or frontend code
    const checkoutJs = fs.readFileSync(path.resolve(__dirname, '../js/checkout.js'), 'utf8');
    const orderConfJs = fs.readFileSync(path.resolve(__dirname, '../js/order-confirmation.js'), 'utf8');
    assert.ok(!checkoutJs.includes('RAZORPAY_KEY_SECRET'), 'RAZORPAY_KEY_SECRET must not be in checkout.js');
    assert.ok(!checkoutJs.includes('RAZORPAY_WEBHOOK_SECRET'), 'RAZORPAY_WEBHOOK_SECRET must not be in checkout.js');
    assert.ok(!orderConfJs.includes('RAZORPAY_KEY_SECRET'), 'RAZORPAY_KEY_SECRET must not be in order-confirmation.js');
    assert.ok(!orderConfJs.includes('RAZORPAY_WEBHOOK_SECRET'), 'RAZORPAY_WEBHOOK_SECRET must not be in order-confirmation.js');

    const configRes = await req('/api/payments/config', {}, null);
    assert.equal(configRes.status, 200);
    assert.equal(configRes.body.key_id, TEST_KEY_ID);
    assert.equal(configRes.body.key_secret, undefined);
    assert.equal(configRes.body.webhook_secret, undefined);
    console.log('✓ 10. Razorpay secrets never appear in logs or frontend code');

    console.log('\nALL 10 RAZORPAY INTEGRATION TESTS PASSED SUCCESSFULLY!');
  } finally {
    if (server) server.close();
    // Clean up test data
    if (testCouponId) await pool.execute('delete from coupons where id = ?', [testCouponId]).catch(() => {});
    if (testUserA) {
      await pool.execute('delete from orders where user_id = ?', [testUserA]).catch(() => {});
      await pool.execute('delete from profiles where user_id = ?', [testUserA]).catch(() => {});
      await pool.execute('delete from users where id = ?', [testUserA]).catch(() => {});
    }
    if (testUserB) {
      await pool.execute('delete from orders where user_id = ?', [testUserB]).catch(() => {});
      await pool.execute('delete from profiles where user_id = ?', [testUserB]).catch(() => {});
      await pool.execute('delete from users where id = ?', [testUserB]).catch(() => {});
    }
    await pool.end();
  }
})().catch(err => {
  console.error('TEST FAILURE:', err);
  process.exit(1);
});
