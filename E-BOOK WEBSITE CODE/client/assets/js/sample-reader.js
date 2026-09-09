(function () {
  'use strict';
  const get = id => document.getElementById(id);
  const dialog = get('sample-reader');
  if (!dialog) return;
  let pages = [], pdf = '', page = 0, mode = 'pages', trigger;
  const safePath = value => {
    if (typeof value !== 'string' || !value.startsWith('/')) return '';
    const url = new URL(value, location.origin);
    return url.origin === location.origin && /^\/(?:assets\/uploads|images)\/[a-zA-Z0-9_.-]+\.(?:pdf|png|jpe?g)$/.test(url.pathname) ? url.pathname : '';
  };
  function render() {
    const images = mode === 'pages';
    dialog.dataset.mode = mode;
    get('reader-stage').hidden = !images;
    get('reader-pdf').hidden = images;
    get('reader-progress').hidden = !images;
    get('reader-zoom').hidden = !images;
    get('reader-pdf-link').hidden = images || !pdf;
    get('reader-pages-mode').setAttribute('aria-pressed', String(images));
    get('reader-pdf-mode').setAttribute('aria-pressed', String(!images));
    if (images) {
      get('reader-error').hidden = true;
      get('reader-image').hidden = false;
      get('reader-image').src = pages[page].path;
      get('reader-image').alt = pages[page].caption || 'Sample page ' + (page + 1);
      get('reader-previous').disabled = page === 0;
      get('reader-next').disabled = page === pages.length - 1;
      get('reader-progress').max = pages.length;
      get('reader-progress').value = page + 1;
      get('reader-progress').disabled = pages.length < 2;
      get('reader-position').textContent = 'Page ' + (page + 1) + ' of ' + pages.length + (pages[page].caption ? ' - ' + pages[page].caption : '');
      get('reader-paper').scrollTop = 0;
      get('reader-paper').scrollLeft = 0;
    } else {
      if (!get('reader-pdf').hasAttribute('src')) get('reader-pdf').src = pdf + '#view=FitH';
      get('reader-position').textContent = 'Use the PDF controls to browse. If the preview is unavailable, select Open PDF.';
    }
  }
  function open(event, selectedMode, index = 0) {
    event.preventDefault();
    trigger = event.currentTarget;
    mode = selectedMode;
    page = index;
    render();
    if (!dialog.open) dialog.showModal();
    document.body.classList.add('sample-reader-open');
    get('reader-close').focus();
  }
  function move(amount) { page = Math.max(0, Math.min(pages.length - 1, page + amount)); render(); }
  get('reader-close').addEventListener('click', () => dialog.close());
  dialog.addEventListener('close', () => {
    document.body.classList.remove('sample-reader-open');
    get('reader-pdf').removeAttribute('src');
    if (trigger && trigger.isConnected) trigger.focus();
  });
  dialog.addEventListener('click', event => {
    if (event.target !== dialog) return;
    const r = dialog.getBoundingClientRect();
    if (event.clientX < r.left || event.clientX > r.right || event.clientY < r.top || event.clientY > r.bottom) dialog.close();
  });
  dialog.addEventListener('keydown', event => {
    if (mode !== 'pages' || event.target.matches('input')) return;
    if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
      event.preventDefault(); move(event.key === 'ArrowLeft' ? -1 : 1);
    }
  });
  get('reader-previous').addEventListener('click', () => move(-1));
  get('reader-next').addEventListener('click', () => move(1));
  get('reader-progress').addEventListener('input', event => { page = Number(event.target.value) - 1; render(); });
  get('reader-pages-mode').addEventListener('click', () => { mode = 'pages'; render(); });
  get('reader-pdf-mode').addEventListener('click', () => { mode = 'pdf'; render(); });
  get('reader-zoom').addEventListener('click', () => {
    const enlarged = get('reader-paper').classList.toggle('is-enlarged');
    get('reader-zoom').setAttribute('aria-pressed', String(enlarged));
    get('reader-zoom').textContent = enlarged ? 'Fit page' : 'Enlarge page';
  });
  get('reader-image').addEventListener('error', () => { get('reader-image').hidden = true; get('reader-error').hidden = false; });
  window.InkframeCatalogue.then(data => {
    const slug = new URLSearchParams(location.search).get('slug');
    const book = data.products.find(product => product.slug === slug);
    if (!book) return;
    const previews = typeof book.preview_pages === 'string' ? JSON.parse(book.preview_pages) : book.preview_pages || [];
    pages = previews.map((item, index) => ({path:safePath(item.path), caption:item.caption || '', index})).filter(item => item.path);
    pdf = safePath(book.sample_path);
    if (!pages.length && !pdf) return;
    get('reader-title').textContent = book.title;
    get('reader-buy').href = '/checkout/?product=' + encodeURIComponent(book.slug);
    get('reader-pdf-mode').hidden = !pdf;
    get('reader-pages-mode').hidden = !pages.length;
    get('reader-pdf-link').href = pdf;
    get('cover-sample').addEventListener('click', event => open(event, pages.length ? 'pages' : 'pdf'));

  }).catch(() => { /* Keep the existing sample links usable if setup fails. */ });
})();
