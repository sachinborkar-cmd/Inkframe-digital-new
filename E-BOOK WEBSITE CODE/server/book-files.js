const path = require('node:path');
function paidFile(value) {
  if (!/^server\/private\/ebooks\/[a-zA-Z0-9-]+\.pdf$/.test(value || '')) throw new Error('The private ebook file is not configured.');
  return path.resolve(__dirname, '..', value);
}
module.exports = { paidFile };
