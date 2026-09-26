const crypto = require('node:crypto');
const path = require('node:path');
const {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  DeleteObjectCommand
} = require('@aws-sdk/client-s3');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');

let s3ClientInstance = null;
let customPresigner = null;

function isS3Configured(env = process.env) {
  return Boolean(
    env.AWS_ACCESS_KEY_ID &&
    String(env.AWS_ACCESS_KEY_ID).trim() &&
    env.AWS_SECRET_ACCESS_KEY &&
    String(env.AWS_SECRET_ACCESS_KEY).trim() &&
    env.AWS_REGION &&
    String(env.AWS_REGION).trim() &&
    env.AWS_S3_BUCKET &&
    String(env.AWS_S3_BUCKET).trim()
  );
}

function getS3Bucket() {
  const bucket = process.env.AWS_S3_BUCKET;
  if (!bucket || !String(bucket).trim()) {
    throw new Error('AWS_S3_BUCKET is not configured.');
  }
  return String(bucket).trim();
}

function getS3Client() {
  if (!isS3Configured()) {
    throw new Error('AWS S3 is not configured. Missing required AWS environment variables.');
  }
  if (!s3ClientInstance) {
    s3ClientInstance = new S3Client({
      region: String(process.env.AWS_REGION).trim(),
      credentials: {
        accessKeyId: String(process.env.AWS_ACCESS_KEY_ID).trim(),
        secretAccessKey: String(process.env.AWS_SECRET_ACCESS_KEY).trim()
      }
    });
  }
  return s3ClientInstance;
}

function setS3Client(client) {
  s3ClientInstance = client;
}

function setPresigner(presignerFn) {
  customPresigner = presignerFn;
}

function isS3Path(value) {
  return typeof value === 'string' && (value.startsWith('s3:') || value.startsWith('ebooks/'));
}

function validateEbookKey(key) {
  if (typeof key !== 'string') {
    throw new Error('Invalid S3 object key: must be a string.');
  }
  // Prevent directory traversal and dangerous characters
  if (key.includes('..') || key.startsWith('/') || key.includes('\\')) {
    throw new Error('Invalid S3 object key: path traversal detected.');
  }
  // Enforce deterministic safe ebooks folder prefix and pdf extension
  if (!/^ebooks\/[a-zA-Z0-9-]+\.pdf$/.test(key)) {
    throw new Error('Invalid S3 object key format. Must match ebooks/{safe-id}.pdf.');
  }
  return key;
}

function extractS3Key(value) {
  if (!isS3Path(value)) return null;
  const raw = value.startsWith('s3:') ? value.slice(3) : value;
  return validateEbookKey(raw);
}

function generateEbookKey(stem = 'ebook') {
  const safeStem = String(stem || 'ebook')
    .replace(/\.[^.]+$/, '')
    .replace(/[^a-zA-Z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80) || 'ebook';
  const uuid = crypto.randomUUID();
  return `ebooks/${uuid}-${safeStem}.pdf`;
}

async function uploadEbook(key, buffer, contentType = 'application/pdf') {
  validateEbookKey(key);
  if (!Buffer.isBuffer(buffer) || !buffer.length) {
    throw new Error('Upload buffer must not be empty.');
  }
  const client = getS3Client();
  const command = new PutObjectCommand({
    Bucket: getS3Bucket(),
    Key: key,
    Body: buffer,
    ContentType: contentType,
    ServerSideEncryption: 'AES256'
  });
  await client.send(command);
  return { key, bucket: getS3Bucket() };
}

async function getEbookDownloadUrl(key, filename = 'ebook.pdf', expiresIn = 300) {
  validateEbookKey(key);
  const client = getS3Client();
  const base = String(filename || 'ebook')
    .replace(/\.pdf$/i, '')
    .replace(/[^a-zA-Z0-9 -]/g, '')
    .slice(0, 100) || 'ebook';
  const cleanFilename = `${base}.pdf`;

  const command = new GetObjectCommand({
    Bucket: getS3Bucket(),
    Key: key,
    ResponseContentType: 'application/pdf',
    ResponseContentDisposition: `attachment; filename="${cleanFilename}"`
  });

  const duration = Math.min(Math.max(expiresIn, 60), 3600);
  if (customPresigner) {
    return customPresigner(client, command, { expiresIn: duration });
  }
  return getSignedUrl(client, command, { expiresIn: duration });
}

async function getEbookObject(key) {
  validateEbookKey(key);
  const client = getS3Client();
  const command = new GetObjectCommand({
    Bucket: getS3Bucket(),
    Key: key
  });
  const response = await client.send(command);
  return {
    stream: response.Body,
    contentType: response.ContentType,
    contentLength: response.ContentLength
  };
}

async function getEbookBuffer(key) {
  validateEbookKey(key);
  const { stream } = await getEbookObject(key);
  if (Buffer.isBuffer(stream)) {
    return stream;
  }
  const chunks = [];
  for await (const chunk of stream) {
    chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
  }
  return Buffer.concat(chunks);
}

async function ebookExists(key) {
  try {
    validateEbookKey(key);
    const client = getS3Client();
    const command = new HeadObjectCommand({
      Bucket: getS3Bucket(),
      Key: key
    });
    await client.send(command);
    return true;
  } catch (error) {
    if (error.name === 'NotFound' || error.$metadata?.httpStatusCode === 404) {
      return false;
    }
    throw error;
  }
}

async function deleteEbook(key) {
  validateEbookKey(key);
  const client = getS3Client();
  const command = new DeleteObjectCommand({
    Bucket: getS3Bucket(),
    Key: key
  });
  await client.send(command);
  return true;
}

module.exports = {
  isS3Configured,
  getS3Bucket,
  getS3Client,
  setS3Client,
  setPresigner,
  isS3Path,
  validateEbookKey,
  extractS3Key,
  generateEbookKey,
  uploadEbook,
  getEbookDownloadUrl,
  getEbookObject,
  getEbookBuffer,
  ebookExists,
  deleteEbook
};
