// Comprehensive AWS S3 Storage and Download Test Suite
require('dotenv').config({ quiet: true });
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const express = require('express');
const pool = require('../../../server/database');

const MOCK_AWS_KEY = 'AKIAIOSFODNN7EXAMPLE';
const MOCK_AWS_SECRET = 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY';
const MOCK_AWS_REGION = 'ap-south-1';
const MOCK_AWS_BUCKET = 'inkframe-private-ebooks-test';

const s3Storage = require('../../../server/storage/s3');
const { paidFile, checkEbookExists } = require('../../../server/book-files');

// In-memory S3 mock storage
const mockS3Store = new Map();
let presignedRequests = [];

// Inject mock S3 client for tests
s3Storage.setS3Client({
  send: async (command) => {
    const cmdName = command.constructor.name;
    const input = command.input || {};

    if (cmdName === 'PutObjectCommand') {
      assert.equal(input.Bucket, MOCK_AWS_BUCKET);
      assert.equal(input.ServerSideEncryption, 'AES256', 'Must enforce server-side encryption');
      mockS3Store.set(input.Key, {
        body: input.Body,
        contentType: input.ContentType,
        length: input.Body.length
      });
      return { ETag: '"mock-etag"' };
    }

    if (cmdName === 'GetObjectCommand') {
      assert.equal(input.Bucket, MOCK_AWS_BUCKET);
      const item = mockS3Store.get(input.Key);
      if (!item) {
        const err = new Error('NoSuchKey');
        err.name = 'NotFound';
        err.$metadata = { httpStatusCode: 404 };
        throw err;
      }
      const { Readable } = require('node:stream');
      return {
        Body: Readable.from(item.body),
        ContentType: item.contentType,
        ContentLength: item.length
      };
    }

    if (cmdName === 'HeadObjectCommand') {
      assert.equal(input.Bucket, MOCK_AWS_BUCKET);
      const item = mockS3Store.get(input.Key);
      if (!item) {
        const err = new Error('NoSuchKey');
        err.name = 'NotFound';
        err.$metadata = { httpStatusCode: 404 };
        throw err;
      }
      return { ContentLength: item.length, ContentType: item.contentType };
    }

    if (cmdName === 'DeleteObjectCommand') {
      mockS3Store.delete(input.Key);
      return {};
    }

    throw new Error(`Unhandled mock S3 command: ${cmdName}`);
  }
});

// Mock presigner to verify parameters without network
s3Storage.setPresigner(async (client, command, options = {}) => {
  const key = command.input.Key;
  const bucket = command.input.Bucket;
  const disposition = command.input.ResponseContentDisposition;
  const expiresIn = options.expiresIn;
  presignedRequests.push({ bucket, key, disposition, expiresIn });

  // Generate safe simulated signed URL without exposing secrets
  const token = crypto.randomBytes(16).toString('hex');
  return `https://${bucket}.s3.${MOCK_AWS_REGION}.amazonaws.com/${encodeURIComponent(key)}?X-Amz-Expires=${expiresIn}&X-Amz-Signature=${token}`;
});

const app = express();
app.use(express.json());

let currentUserId = null;
app.use((req, res, next) => {
  req.session = { userId: req.headers['x-test-user'] ? Number(req.headers['x-test-user']) : currentUserId };
  next();
});

app.use('/api/library', require('../../../server/routes/library'));

let server, testUserPurchased, testUserUnpurchased, s3EbookId;

(async () => {
  try {
    console.log('--- Running AWS S3 Storage and Download Test Suite ---');

    // TEST A: S3 Configuration Detection & Validation
    assert.equal(s3Storage.isS3Configured({}), false, 'Empty env should not be detected as S3 configured');
    assert.equal(s3Storage.isS3Configured({ AWS_ACCESS_KEY_ID: 'key', AWS_SECRET_ACCESS_KEY: 'secret' }), false, 'Partial env should not be configured');

    const validEnv = {
      AWS_ACCESS_KEY_ID: MOCK_AWS_KEY,
      AWS_SECRET_ACCESS_KEY: MOCK_AWS_SECRET,
      AWS_REGION: MOCK_AWS_REGION,
      AWS_S3_BUCKET: MOCK_AWS_BUCKET
    };
    assert.equal(s3Storage.isS3Configured(validEnv), true, 'Complete env should be detected as S3 configured');

    // Set process.env for subsequent tests
    process.env.AWS_ACCESS_KEY_ID = MOCK_AWS_KEY;
    process.env.AWS_SECRET_ACCESS_KEY = MOCK_AWS_SECRET;
    process.env.AWS_REGION = MOCK_AWS_REGION;
    process.env.AWS_S3_BUCKET = MOCK_AWS_BUCKET;

    assert.equal(s3Storage.getS3Bucket(), MOCK_AWS_BUCKET);
    console.log('✓ A. S3 configuration detection and validation verified');

    // TEST B: Object-key Safety & Path Traversal Prevention
    assert.equal(s3Storage.validateEbookKey('ebooks/safe-book-123.pdf'), 'ebooks/safe-book-123.pdf');
    assert.equal(s3Storage.extractS3Key('s3:ebooks/my-book.pdf'), 'ebooks/my-book.pdf');
    assert.equal(s3Storage.extractS3Key('ebooks/my-book.pdf'), 'ebooks/my-book.pdf');
    assert.equal(s3Storage.extractS3Key('server/private/ebooks/local.pdf'), null, 'Local path is not S3 key');

    // Dangerous paths must throw
    const dangerousKeys = [
      '../.env',
      '../../secrets.txt',
      'ebooks/../server/private/x.pdf',
      '/ebooks/rooted.pdf',
      'ebooks\\windows-path.pdf',
      'other-bucket/file.pdf',
      'ebooks/bad-ext.exe',
      'ebooks/noext',
      'ebooks/spaces in name.pdf',
      'ebooks/<script>.pdf'
    ];
    for (const badKey of dangerousKeys) {
      assert.throws(() => s3Storage.validateEbookKey(badKey), /Invalid S3 object key|path traversal/i, `Should reject dangerous key: ${badKey}`);
    }

    const generated = s3Storage.generateEbookKey('My Test E-book! (2026).pdf');
    assert.match(generated, /^ebooks\/[0-9a-f-]{36}-My-Test-E-book-2026\.pdf$/);
    console.log('✓ B. Object-key safety and path traversal protection verified');

    // TEST C & D: Upload, Authorization, Presigned URL Generation
    const samplePdfContent = Buffer.from('%PDF-1.4 Mock PDF content for S3 unit test');
    const testKey = 'ebooks/test-s3-ebook-1.pdf';
    await s3Storage.uploadEbook(testKey, samplePdfContent);

    assert.equal(await s3Storage.ebookExists(testKey), true);
    assert.equal(await s3Storage.ebookExists('ebooks/non-existent.pdf'), false);

    const retrievedBuffer = await s3Storage.getEbookBuffer(testKey);
    assert.deepEqual(retrievedBuffer, samplePdfContent);

    // Database setup for library download tests
    await require('../../../server/schema').ensureSchema();

    const token = crypto.randomUUID();
    const [u1] = await pool.execute('insert into users(email, is_verified) values (?, true)', [`s3-buyer-${token}@example.invalid`]);
    testUserPurchased = u1.insertId;

    const [u2] = await pool.execute('insert into users(email, is_verified) values (?, true)', [`s3-nonbuyer-${token}@example.invalid`]);
    testUserUnpurchased = u2.insertId;

    const s3BookSlug = 's3-test-ebook-' + token.slice(0, 8);
    const [bRes] = await pool.execute(
      `insert into ebooks(slug, title, author, price_paise, status, pdf_path)
       values (?, 'S3 Test Ebook', 'Test Author', 49900, 'published', ?)`,
      [s3BookSlug, 's3:' + testKey]
    );
    s3EbookId = bRes.insertId;

    // Grant verified paid purchase to user 1
    await pool.execute(
      `insert into orders (order_number, user_id, ebook_id, amount_paise, status, payment_method, verified_at, checkout_key)
       values (999001, ?, ?, 49900, 'paid', 'razorpay', now(), ?)`,
      [testUserPurchased, s3EbookId, token]
    );

    server = await new Promise(resolve => {
      const s = app.listen(0, '127.0.0.1', () => resolve(s));
    });
    const origin = `http://127.0.0.1:${server.address().port}`;

    // Test C1: Unauthenticated request must return 401 (handled by auth middleware)
    const unauthRes = await fetch(`${origin}/api/library/${s3BookSlug}/download`, { redirect: 'manual' });
    assert.equal(unauthRes.status, 401, 'Unauthenticated download must be 401');

    // Test C2: Authenticated user WITHOUT purchase must return 403 Forbidden
    const unpurchasedRes = await fetch(`${origin}/api/library/${s3BookSlug}/download`, {
      headers: { 'x-test-user': String(testUserUnpurchased) },
      redirect: 'manual'
    });
    assert.equal(unpurchasedRes.status, 403, 'User without purchase must receive 403 Forbidden');
    console.log('✓ C. Customer purchase authorization strictly enforced');

    // Test D1: Authenticated user WITH purchase receives 302 redirect to short-lived presigned URL
    presignedRequests = [];
    const purchasedRes = await fetch(`${origin}/api/library/${s3BookSlug}/download`, {
      headers: { 'x-test-user': String(testUserPurchased) },
      redirect: 'manual'
    });

    assert.equal(purchasedRes.status, 302, 'Authorized user must receive 302 redirect to presigned S3 URL');
    const redirectUrl = purchasedRes.headers.get('Location');
    assert.ok(redirectUrl, 'Location header must be present');
    assert.ok(redirectUrl.includes(MOCK_AWS_BUCKET), 'Redirect must point to configured S3 bucket');
    assert.ok(redirectUrl.includes(encodeURIComponent(testKey)), 'Redirect must target correct object key');
    assert.ok(!redirectUrl.includes(MOCK_AWS_SECRET), 'AWS Secret Key must NEVER appear in URL');

    assert.equal(presignedRequests.length, 1);
    assert.equal(presignedRequests[0].bucket, MOCK_AWS_BUCKET);
    assert.equal(presignedRequests[0].key, testKey);
    assert.ok(presignedRequests[0].expiresIn <= 300, 'Presigned URL expiration must be short-lived (<= 300 seconds)');
    assert.ok(presignedRequests[0].disposition.includes('attachment; filename="S3 Test Ebook.pdf"'));

    // Verify download count was incremented
    const [[orderRecord]] = await pool.execute('select download_count from orders where user_id = ? and ebook_id = ?', [testUserPurchased, s3EbookId]);
    assert.equal(orderRecord.download_count, 1, 'Download count must increment upon successful S3 download authorization');

    // Test D2: Streaming option (?stream=true)
    const streamRes = await fetch(`${origin}/api/library/${s3BookSlug}/download?stream=true`, {
      headers: { 'x-test-user': String(testUserPurchased) }
    });
    assert.equal(streamRes.status, 200);
    assert.equal(streamRes.headers.get('content-type'), 'application/pdf');
    const streamBody = Buffer.from(await streamRes.arrayBuffer());
    assert.deepEqual(streamBody, samplePdfContent);
    console.log('✓ D. Presigned URL generation and streaming download verified');

    // TEST E: Local Fallback Verification
    // Existing book with local path: 'fitness-for-busy-professionals'
    const localRes = await fetch(`${origin}/api/library/fitness-for-busy-professionals/download`, {
      headers: { 'x-test-user': String(testUserPurchased) }
    });
    // User hasn't purchased fitness book, so should get 403
    assert.equal(localRes.status, 403);

    // Grant purchase for local book
    const [[localBook]] = await pool.execute("select id from ebooks where slug = 'fitness-for-busy-professionals'");
    await pool.execute(
      `insert into orders (order_number, user_id, ebook_id, amount_paise, status, payment_method, verified_at, checkout_key)
       values (999002, ?, ?, 29900, 'paid', 'razorpay', now(), ?)`,
      [testUserPurchased, localBook.id, crypto.randomUUID()]
    );

    const localDownloadRes = await fetch(`${origin}/api/library/fitness-for-busy-professionals/download`, {
      headers: { 'x-test-user': String(testUserPurchased) }
    });
    assert.equal(localDownloadRes.status, 200, 'Local fallback file download must return 200');
    assert.equal(localDownloadRes.headers.get('content-type'), 'application/pdf');
    await localDownloadRes.arrayBuffer();
    console.log('✓ E. Local development storage fallback verified');

    // TEST F: Email Attachment from S3 Buffer
    const emailModule = require('../../../server/email');
    let emailSentWithBuffer = false;
    emailModule.setResendClient({
      emails: {
        send: async (options) => {
          assert.equal(options.attachments.length, 1);
          assert.deepEqual(options.attachments[0].content, samplePdfContent);
          assert.equal(options.attachments[0].contentType, 'application/pdf');
          emailSentWithBuffer = true;
          return { data: { id: 'mock-s3-email' } };
        }
      }
    });

    const oldResendKey = process.env.RESEND_API_KEY;
    process.env.RESEND_API_KEY = 're_test_s3_mock_key';
    await emailModule.sendBookEmail('customer@example.invalid', 999001, 49900, 's3:' + testKey, 'S3 Test Ebook', false);
    assert.equal(emailSentWithBuffer, true, 'sendBookEmail must attach S3 buffer');
    process.env.RESEND_API_KEY = oldResendKey;
    console.log('✓ F. Email delivery with S3 Buffer attachment verified');

    // TEST G: CheckEbookExists helper with S3 and local paths
    assert.equal(await checkEbookExists('s3:' + testKey), true);
    await assert.rejects(async () => checkEbookExists('s3:ebooks/missing-file.pdf'), /Private ebook file not found in S3/);
    assert.equal(await checkEbookExists('server/private/ebooks/fitness-for-busy-professionals.pdf'), true);
    console.log('✓ G. checkEbookExists helper verified for both S3 and local files');

    console.log('\nALL S3 STORAGE AND DOWNLOAD TESTS PASSED SUCCESSFULLY!');
  } finally {
    if (server) server.close();
    // Clean up test database records
    if (testUserPurchased) {
      await pool.execute('delete from orders where user_id = ?', [testUserPurchased]).catch(() => {});
      await pool.execute('delete from users where id = ?', [testUserPurchased]).catch(() => {});
    }
    if (testUserUnpurchased) {
      await pool.execute('delete from orders where user_id = ?', [testUserUnpurchased]).catch(() => {});
      await pool.execute('delete from users where id = ?', [testUserUnpurchased]).catch(() => {});
    }
    if (s3EbookId) {
      await pool.execute('delete from ebooks where id = ?', [s3EbookId]).catch(() => {});
    }
    await pool.end();
  }
})().catch(err => {
  console.error('TEST FAILURE:', err);
  process.exit(1);
});
