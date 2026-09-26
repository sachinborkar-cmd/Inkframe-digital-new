const path = require('node:path');
const fs = require('node:fs/promises');
const s3Storage = require('./storage/s3');

function paidFile(value) {
  if (typeof value === 'string' && /^[a-zA-Z0-9-]+\.pdf$/.test(value)) {
    value = 'server/private/ebooks/' + value;
  }
  if (!/^server\/private\/ebooks\/[a-zA-Z0-9-]+\.pdf$/.test(value || '')) throw new Error('The private ebook file is not configured.');
  return path.resolve(__dirname, '..', value);
}

async function checkEbookExists(value) {
  if (s3Storage.isS3Path(value)) {
    const key = s3Storage.extractS3Key(value);
    if (!key) throw new Error('Invalid S3 ebook reference.');
    const exists = await s3Storage.ebookExists(key);
    if (!exists) throw new Error('Private ebook file not found in S3.');
    return true;
  }
  await fs.access(paidFile(value));
  return true;
}

module.exports = { paidFile, checkEbookExists };
