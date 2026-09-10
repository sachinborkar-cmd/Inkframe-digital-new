// Exercise the customer renderer with published, empty and unavailable products.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = fs.readFileSync(path.join(__dirname, '../js/site.js'), 'utf8');
const render = source.slice(source.indexOf('// Published catalogue and product pages'));
async function page(products, slug = 'test-book') {
  const elements = new Map();
  const element = id => {
    if (!elements.has(id)) elements.set(id, {hidden: true, dataset: {}, textContent: '', innerHTML: ''});
    return elements.get(id);
  };
  const document = {getElementById: element, querySelector: s => s === 'meta[name="description"]' ? element('meta') : null};
  const context = {document, location: {pathname: '/product/', search: '?slug=' + slug}, URLSearchParams,
    window: {InkframeCatalogue: Promise.resolve({products, categories: []})}};
  await vm.runInNewContext(render, context);
  return {element, document};
}
(async () => {
  const book = {slug: 'test-book', title: 'A book', author: 'Author', price_paise: 49900,
    cover_path: '/images/cover.png', description: 'First paragraph\nSecond paragraph',
    sample_path: '/assets/uploads/sample.pdf', preview_pages: [{path: '/assets/uploads/page.png', caption: '<img src=x onerror=alert(1)>'}],
    testimonials: [{name: '<script>reader</script>', quote: '<img src=x onerror=alert(1)>'}]};
  const {element: el, document} = await page([book]);
  assert.equal(document.title, 'A book | Inkframe Press');
  assert.equal(el('product-detail').hidden, false);
  assert.equal(el('product-description').textContent, book.description);
  assert.equal(el('product-buy').dataset.product, book.slug);
  assert.equal(el('product-buy').href, '/checkout/?product=test-book');
  assert.equal(el('product-cart').dataset.product, book.slug);
  assert.ok(el('product-rating').innerHTML.includes('out of 5 stars'));
  assert.equal(el('sticky-book-buy').dataset.product, book.slug);
  assert.equal(el('sticky-book-buy').href, '/checkout/?product=test-book');
  assert.equal(el('related-books').hidden, true);
  assert.ok(!el('product-previews').innerHTML.includes('<a '));
  assert.ok(el('product-previews').innerHTML.includes(book.preview_pages[0].path));
  assert.ok(!el('product-previews').innerHTML.includes('<button'));
  assert.ok(!el('product-previews').innerHTML.includes(book.cover_path));
  assert.equal(el('preview-pages').hidden, false);
  assert.equal(el('reader-testimonials').hidden, false);
  assert.ok(el('product-previews').innerHTML.includes('&lt;img'));
  assert.ok(!el('product-testimonials').innerHTML.includes('<script>'));
  assert.ok(el('product-testimonials').innerHTML.includes('&lt;script&gt;'));
  assert.ok(el('product-testimonials').innerHTML.includes('book-rating-stars'));
  const {element: empty} = await page([{...book, cover_path: '', sample_path: null, preview_pages: null, testimonials: '[]'}]);
  assert.equal(empty('preview-pages').hidden, true);
  assert.equal(empty('reader-testimonials').hidden, true);
  assert.equal(empty('product-cover-placeholder').hidden, false);
  const {element: coverOnly} = await page([{...book, preview_pages:[]}]);
  assert.ok(coverOnly('product-previews').innerHTML.includes(book.cover_path));
  const {element: multiple} = await page([{...book, preview_pages:[...book.preview_pages,{path:'/images/second-page.png',caption:'Second page'}]}]);
  assert.equal((multiple('product-previews').innerHTML.match(/<figure>/g)||[]).length,2);
  assert.ok(multiple('product-previews').innerHTML.includes('/images/second-page.png'));
  const {element: related} = await page([book, {...book, slug:'another-book', title:'<script>unsafe</script>', id:2}]);
  assert.equal(related('related-books').hidden, false);
  assert.ok(related('related-book-grid').innerHTML.includes('/product/?slug=another-book'));
  assert.ok(!related('related-book-grid').innerHTML.includes('/product/?slug=test-book'));
  assert.ok(related('related-book-grid').innerHTML.includes('&lt;script&gt;'));
  const {element: missing} = await page([]);
  assert.equal(missing('product-detail').hidden, true);
  assert.equal(missing('product-status').textContent, 'This book is not currently available.');
  console.log('PASS: product rendering, purchase links, preview pages, escaped testimonials, optional sections and unavailable products.');
})().catch(error => {console.error(error);process.exitCode = 1;});
