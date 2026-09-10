(function () {
  'use strict';
  var get = function (id) { return document.getElementById(id); };
  if (!get('product-detail')) return;
  window.InkframeCatalogue.then(function (data) {
    var book = data.products.find(function (item) { return item.slug === new URLSearchParams(location.search).get('slug'); });
    if (!book) return;
    var previews = typeof book.preview_pages === 'string' ? JSON.parse(book.preview_pages) : book.preview_pages || [];
    var images = (book.cover_path ? [{path:book.cover_path,caption:'Cover'}] : []).concat(previews.map(function (item, index) { return {path:item.path,caption:item.caption || 'Preview ' + (index + 1)}; }));
    var art = document.querySelector('.product-art');
    var cover = get('product-cover');
    var caption = document.querySelector('.showcase-caption');
    var thumbs = document.createElement('div');
    thumbs.className = 'product-thumbnails';
    thumbs.setAttribute('role', 'group');
    thumbs.setAttribute('aria-label', 'Book cover and previews');
    function selectImage(index) {
      cover.src = images[index].path;
      cover.alt = book.title + ' — ' + images[index].caption;
      cover.hidden = false;
      get('product-cover-placeholder').hidden = true;
      caption.textContent = images[index].caption + ' · ' + (index + 1) + ' / ' + images.length;
      art.classList.toggle('is-preview', images[index].caption !== 'Cover');
      thumbs.querySelectorAll('button').forEach(function (button, i) { button.setAttribute('aria-pressed', String(i === index)); });
    }
    cover.addEventListener('error', function () {
      cover.hidden = true;
      get('product-cover-placeholder').hidden = false;
      get('product-cover-placeholder').textContent = 'Image unavailable';
    });
    if (images.length > 1) {
      images.forEach(function (item, index) {
        var button = document.createElement('button');
        button.type = 'button'; button.setAttribute('aria-label', 'Show ' + item.caption);
        button.setAttribute('aria-pressed', String(index === 0));
        var image = document.createElement('img'); image.src = item.path; image.alt = ''; image.loading = 'lazy';
        button.appendChild(image);
        button.addEventListener('click', function () { selectImage(index); });
        thumbs.appendChild(button);
      });
      art.insertAdjacentElement('afterend', thumbs);
      selectImage(0);
    }
    var sticky = get('product-sticky-buy');
    var purchase = document.querySelector('.product-purchase');
    var scheduled = false;
    function updatePurchaseBar() {
      if (scheduled) return;
      scheduled = true;
      window.requestAnimationFrame(function () {
        sticky.hidden = purchase.getBoundingClientRect().bottom > 64;
        scheduled = false;
      });
    }
    window.addEventListener('scroll', updatePurchaseBar, {passive:true});
    window.addEventListener('resize', updatePurchaseBar);
    updatePurchaseBar();
  }).catch(function () { /* The main renderer handles unavailable products. */ });
})();
