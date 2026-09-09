(function () {
  'use strict';
  var profile = document.getElementById('profile');
  var profileTrigger;
  function openProfile() {
    if (!profile || profile.open) return;
    profileTrigger = document.activeElement;
    profile.showModal();
    document.body.classList.add('profile-dialog-open');
    document.getElementById('close-profile').focus();
  }
  document.getElementById('open-profile').addEventListener('click', openProfile);
  document.getElementById('close-profile').addEventListener('click', function () { profile.close(); });
  profile.addEventListener('click', function (event) {
    if (event.target !== profile) return;
    var bounds = profile.getBoundingClientRect();
    if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) profile.close();
  });
  profile.addEventListener('close', function () {
    document.body.classList.remove('profile-dialog-open');
    if (location.hash === '#profile') history.replaceState(null, '', location.pathname + location.search);
    if (profileTrigger && profileTrigger !== document.body) profileTrigger.focus();
    else document.getElementById('open-profile').focus();
  });
  if (location.hash === '#profile') openProfile();
  window.addEventListener('hashchange', function () { if (location.hash === '#profile') openProfile(); });
  document.addEventListener('click', function (event) {
    var link = event.target.closest('[data-account-link]');
    if (link && new URL(link.href, location.origin).hash === '#profile') { event.preventDefault(); openProfile(); }
  });

  function element(tag, className, text) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (text != null) node.textContent = text;
    return node;
  }
  function localPath(path) {
    if (typeof path !== 'string' || !path.startsWith('/')) return '';
    try { var url = new URL(path, location.origin); return url.origin === location.origin ? url.pathname + url.search : ''; } catch (_) { return ''; }
  }
  function cover(order) {
    var fallback = element('div', 'purchase-cover cover-placeholder', order.title || 'Ebook');
    fallback.setAttribute('aria-label', 'Cover unavailable');
    var src = localPath(order.cover_path);
    if (!src) return fallback;
    var image = element('img', 'purchase-cover');
    image.src = src; image.alt = (order.title || 'Ebook') + ' cover'; image.loading = 'lazy'; image.width = 120; image.height = 180;
    image.addEventListener('error', function () { image.replaceWith(fallback); }, {once:true});
    return image;
  }
  function detail(root, label, value) {
    var group = element('div'); group.append(element('dt', '', label), element('dd', '', value)); root.appendChild(group);
  }
  function purchaseCard(order) {
    var card = element('article', 'purchase-card');
    var body = element('div');
    var statuses = {paid:'Paid',pending:'Payment pending',failed:'Payment failed',refunded:'Refunded',cancelled:'Cancelled'};
    var status = statuses[order.status] || 'Processing';
    if (order.payment_method === 'test') status += ' · Test order';
    body.appendChild(element('span', 'purchase-status' + (order.status === 'paid' ? ' is-paid' : order.status === 'refunded' ? ' is-refunded' : ''), status));
    body.appendChild(element('h3', 'purchase-title', order.title || 'Ebook'));
    body.appendChild(element('p', 'purchase-author', order.author ? 'By ' + order.author : 'Digital ebook'));
    var meta = element('dl', 'purchase-meta');
    var purchased = new Date(order.created_at);
    detail(meta, 'Order', '#' + order.order_number);
    detail(meta, 'Purchased', Number.isNaN(purchased.getTime()) ? 'Date unavailable' : purchased.toLocaleDateString('en-IN', {day:'numeric',month:'short',year:'numeric'}));
    detail(meta, order.status === 'paid' || order.status === 'refunded' ? 'Amount paid' : 'Order total', 'INR ' + (Number(order.amount_paise || 0) / 100).toLocaleString('en-IN', {minimumFractionDigits:2,maximumFractionDigits:2}));
    body.appendChild(meta);
    var actions = element('div', 'purchase-actions');
    var download = localPath(order.download_url);
    if (order.can_download && download && download.startsWith('/api/library/')) {
      var link = element('a', 'btn btn-primary', 'Download PDF'); link.href = download; link.setAttribute('aria-label', 'Download ' + order.title + ' as PDF'); actions.appendChild(link);
      body.appendChild(element('p', 'purchase-delivery', (order.email_sent_at ? 'Download email sent' : 'Your PDF is ready to download') + ' · ' + Number(order.download_count || 0) + ' downloads'));
    } else {
      actions.appendChild(element('p', 'purchase-access-note', order.status === 'refunded' ? 'Download access ended after the refund.' : order.status === 'paid' ? 'Download unavailable. Contact us for help with this order.' : 'Downloads become available after payment is confirmed.'));
    }
    if (order.payment_method === 'test') {
      var orderLink = element('a', 'purchase-order-link', 'View order details'); orderLink.href = '/thank-you/?order=' + encodeURIComponent(order.id); actions.appendChild(orderLink);
    }
    card.append(cover(order), body, actions);
    return card;
  }
  var root = document.getElementById('customer-library');
  if (!root) return;
  fetch('/api/library', {credentials:'same-origin',cache:'no-store'}).then(async function (response) {
    if (response.status === 401) { location.href = '/signin/?next=/library/'; throw new Error('Please sign in to view your purchases.'); }
    var result = await response.json();
    if (!response.ok) throw new Error(result.error || 'We couldn’t load your purchases. Please reload the page.');
    var orders = result.orders || [];
    var bookCount = (result.books || []).length;
    document.getElementById('library-count').textContent = orders.length + (orders.length === 1 ? ' purchase' : ' purchases') + ' · ' + bookCount + (bookCount === 1 ? ' book available' : ' books available');
    document.getElementById('library-status').textContent = '';
    document.getElementById('library-empty').hidden = orders.length !== 0;
    orders.forEach(function (order) { root.appendChild(purchaseCard(order)); });
  }).catch(function (error) {
    document.getElementById('library-status').textContent = error.message;
    document.getElementById('library-count').textContent = 'Purchases unavailable';
  }).finally(function () { root.setAttribute('aria-busy', 'false'); });
})();
