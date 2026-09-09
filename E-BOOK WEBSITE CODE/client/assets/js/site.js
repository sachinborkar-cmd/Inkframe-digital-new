window.InkframeSession = fetch('/api/auth/session', {credentials:'same-origin', cache:'no-store'}).then(function(response) { if (!response.ok) throw new Error('Unable to check sign-in.'); return response.json(); });

window.InkframeCart = (function () {
  var products = {
    'fitness-for-busy-professionals': { id: 'fitness-for-busy-professionals', title: 'Fitness for Busy Professionals', price: 499, detail: '22-page PDF ebook', image: '/assets/images/fitness-for-busy-professionals-cover.png', url: '/ebooks/fitness-for-busy-professionals/' }
  };
  function get() { try { var ids=JSON.parse(localStorage.getItem('inkframeCart') || '[]'); return Array.isArray(ids)?ids.filter(function(id){return typeof id==='string'}):[]; } catch (_) { return []; } }
  window.InkframeCatalogue = fetch('/api/store/products').then(function(r){if(!r.ok)throw Error('Could not load the catalogue.');return r.json();}).then(function(data){
    Object.keys(products).forEach(function(key){delete products[key]});
    data.products.forEach(function(p){products[p.slug]={id:p.slug,title:p.title,price:p.price_paise/100,detail:'PDF ebook',image:p.cover_path,url:'/product/?slug='+encodeURIComponent(p.slug)};});
    window.dispatchEvent(new Event('inkframe:cart'));return data;
  });
  window.InkframeCatalogue.catch(function(){ showToast('Unable to load current products. Please reload.'); });
  var authenticated = false;
  function sync(ids) { if (!authenticated) return; fetch('/api/store/cart',{method:'PUT',credentials:'same-origin',headers:{'Content-Type':'application/json'},body:JSON.stringify({slugs:ids})}).catch(function(){}); }
  function save(ids) { localStorage.setItem('inkframeCart', JSON.stringify(ids)); updateCount(); sync(ids); window.dispatchEvent(new Event('inkframe:cart')); }
  function add(id) { var ids = get(); if (products[id] && ids.indexOf(id) === -1) ids.push(id); save(ids); }
  function remove(id) { save(get().filter(function (item) { return item !== id; })); }
  function items() { return get().map(function (id) { return products[id]; }).filter(Boolean); }
  function updateCount() { var count = get().length; document.querySelectorAll('[data-cart-count]').forEach(function (el) { el.textContent = count; }); }
  document.addEventListener('DOMContentLoaded', function(){updateCount();window.InkframeSession.then(function(session){authenticated=session.authenticated;if(!authenticated)return;return fetch('/api/store/cart',{credentials:'same-origin'}).then(function(r){return r.json()}).then(function(data){var merged=[...new Set(get().concat((data.items||[]).map(function(item){return item.slug})))];localStorage.setItem('inkframeCart',JSON.stringify(merged));sync(merged);updateCount();window.dispatchEvent(new Event('inkframe:cart'));});}).catch(function(){});});
  return { add: add, remove: remove, items: items, products: products, updateCount: updateCount };
})();

// Keep the same primary header on every static page.
(function () {
  var header = document.querySelector('.site-header');
  if (!header) return;
  header.innerHTML = [
    '<div class="shell flex items-center justify-between h-16">',
    '  <a href="/" class="font-ui font-bold tracking-tight text-lg">Inkframe<span class="accent">.</span></a>',
    '  <nav class="hidden md:flex items-center gap-8 font-ui" aria-label="Primary navigation">',
    '    <a class="nav-link" href="/">Home</a>',
    '    <a class="nav-link" href="/categories/">Categories</a>',
    '    <a class="nav-link" href="/library/">My Library</a>',
    '    <a class="nav-link" href="/about/">About</a>',
    '    <a class="nav-link" href="/contact/">Contact</a>',
    '  </nav>',
    '  <div class="flex items-center gap-3">',
    '    <a data-account-link href="/signin/" class="btn btn-primary">Account</a>',
    '    <a href="/cart/" class="cart-button" aria-label="Open cart">',
    '      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><circle cx="9" cy="20" r="1"></circle><circle cx="19" cy="20" r="1"></circle><path d="M3 4h2l2.4 10.4a2 2 0 0 0 2 1.6h7.7a2 2 0 0 0 2-1.6L21 7H6"></path></svg>',
    '      <span class="cart-count" data-cart-count>0</span>',
    '    </a>',
    '    <button type="button" data-menu-toggle class="md:hidden p-2 -mr-2" aria-label="Open menu" aria-expanded="false">',
    '      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M3 6h18M3 12h18M3 18h18"></path></svg>',
    '    </button>',
    '  </div>',
    '</div>',
    '<div id="mobile-menu" class="hidden md:hidden border-t" style="border-color:var(--line)">',
    '  <nav class="shell py-4 flex flex-col gap-3 font-ui" aria-label="Mobile navigation">',
    '    <a class="nav-link" href="/">Home</a>',
    '    <a class="nav-link" href="/categories/">Categories</a>',
    '    <a class="nav-link" href="/library/">My Library</a>',
    '    <a class="nav-link" href="/about/">About</a>',
    '    <a class="nav-link" href="/contact/">Contact</a>',
    '    <a data-account-link class="nav-link" href="/signin/">Account</a>',
    '    <a class="nav-link" href="/cart/">Cart (<span data-cart-count>0</span>)</a>',
    '  </nav>',
    '</div>'
  ].join('');
})();

window.InkframeSession.then(function(session) {
  if (session.isAdmin) {
    document.querySelectorAll('.site-header nav').forEach(function(nav) {
      var link=document.createElement('a');link.href='/admin/';link.className='nav-link';link.textContent='Admin';nav.appendChild(link);
    });
  }
  document.querySelectorAll('[data-account-link]').forEach(function(link) {
    link.textContent = session.authenticated ? 'My profile' : 'Sign in';
    link.href = session.authenticated ? '/library/#profile' : '/signin/';
    if (session.authenticated) link.title = session.email;
  });
}).catch(function() {
  document.querySelectorAll('[data-account-link]').forEach(function(link) { link.textContent='Sign in'; });
});

document.addEventListener('click', async function(event) {
  var button = event.target.closest('[data-logout]');
  if (!button || button.disabled) return;
  button.disabled = true;
  try {
    var response = await fetch('/api/auth/logout', {method:'POST', credentials:'same-origin'});
    if (!response.ok) throw new Error('Could not sign out. Please try again.');
    localStorage.removeItem('inkframeCart');
    sessionStorage.removeItem('inkframeCheckoutKey');
    location.href='/signin/';
  } catch(error) { button.disabled=false; showToast(error.message); }
});

// Shared navigation and accordions.
document.addEventListener('click', function (e) {
  var t = e.target.closest('.acc-trigger');
  if (t) {
    var item = t.closest('.acc-item');
    var open = item.classList.contains('open');
    item.classList.toggle('open', !open);
    t.setAttribute('aria-expanded', String(!open));
  }
  var burger = e.target.closest('[data-menu-toggle]');
  if (burger) {
    var menu = document.getElementById('mobile-menu');
    if (menu) {
      var isOpen = !menu.classList.toggle('hidden');
      burger.setAttribute('aria-expanded', String(isOpen));
    }
  }
  var download = e.target.closest('[data-demo-download]');
  if (download) {
    e.preventDefault();
    showToast('Your purchased files will be available here after checkout.');
  }
  var add = e.target.closest('[data-add-cart]');
  if (add) { e.preventDefault(); InkframeCart.add(add.dataset.product || 'fitness-for-busy-professionals'); showToast('Item added to your cart.'); }
  var buy = e.target.closest('[data-buy-now]');
  if (buy) { e.preventDefault(); InkframeCart.add(buy.dataset.product || 'fitness-for-busy-professionals'); window.location.href = '/checkout/?product='+encodeURIComponent(buy.dataset.product || 'fitness-for-busy-professionals'); }
  var remove = e.target.closest('[data-demo-remove]');
  if (remove) { InkframeCart.remove(remove.dataset.product); }
  var coupon = e.target.closest('[data-demo-coupon]');
  if (coupon) { showToast('Coupon validation UI is ready; backend rules come next.'); }
  var upsell = e.target.closest('[data-demo-upsell]');
  if (upsell) { showToast('This related product is coming soon.'); }
});

function showToast(message) {
  var oldToast = document.querySelector('.toast');
  if (oldToast) oldToast.remove();
  var toast = document.createElement('div');
  toast.className = 'toast';
  toast.setAttribute('role', 'status');
  toast.textContent = message;
  document.body.appendChild(toast);
  window.setTimeout(function () { toast.remove(); }, 3500);
}

// Mark the current navigation item for visual and screen-reader context.
(function () {
  var path = window.location.pathname.replace(/\/$/, '') || '/';
  document.querySelectorAll('.site-header a[href]').forEach(function (link) {
    var linkPath = new URL(link.href, window.location.href).pathname.replace(/\/$/, '') || '/';
    if (linkPath === path) link.setAttribute('aria-current', 'page');
  });
})();

// Static-demo form flows still provide a complete, predictable interaction.
(function () {
  var contactForm = document.getElementById('lead-form');
  if (contactForm) contactForm.addEventListener('submit', function (event) {
    event.preventDefault();
    if (!contactForm.reportValidity()) return;
    contactForm.hidden = true;
    var success = document.getElementById('lead-form-success');
    if (success) success.hidden = false;
  });
})();

// Published catalogue and product pages use current admin-managed data.
window.InkframeCatalogue.then(function(data){
  var escape=function(v){return String(v==null?'':v).replace(/[&<>"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]})};
  if(location.pathname.replace(/\/$/,'')==='/categories'){
    var categoryCard=document.querySelector('.cat-card'),categoryGrid=categoryCard&&categoryCard.parentElement;
    if(categoryGrid)categoryGrid.innerHTML=data.categories.map(function(c){return '<a class="cat-card" href="/?category='+encodeURIComponent(c.slug)+'">'+(c.banner_path?'<img class="w-full rounded-lg" src="'+escape(c.banner_path)+'" alt="">':'<div class="cat-swatch" style="background:#c1442a"></div>')+'<h2 class="mt-6 text-2xl font-bold">'+escape(c.name)+'</h2><p class="mt-2 muted">'+escape(c.description||'')+'</p><p class="mt-5">'+data.products.filter(function(p){return p.category_slug===c.slug}).length+' titles</p></a>'}).join('');
    var categoryRail=document.querySelector('.rail-scroll');if(categoryRail)categoryRail.innerHTML='<a class="rail-chip" href="/">All titles</a>'+data.categories.map(function(c){return '<a class="rail-chip" href="/?category='+encodeURIComponent(c.slug)+'">'+escape(c.name)+'</a>'}).join('');
  }
  if(data.settings&&data.settings.store_name){var brand=document.querySelector('.site-header a[href="/"]');if(brand)brand.textContent=data.settings.store_name;}
  var grid=document.querySelector('[data-book-grid]');
  if(grid){
    var category=new URLSearchParams(location.search).get('category')||'all';
    var firstChip=document.querySelector('[data-filter]'),rail=firstChip&&firstChip.parentElement;
    if(rail){rail.innerHTML='<button class="rail-chip" data-filter="all">All titles</button>'+data.categories.map(function(c){return '<button class="rail-chip" data-filter="'+escape(c.slug)+'">'+escape(c.name)+'</button>'}).join('');}
    var search=document.querySelector('input[name="q"]'),sort=document.querySelector('[data-sort]');
    function render(){
      var query=(search?search.value:'').trim().toLowerCase();
      var books=data.products.filter(function(p){return (category==='all'||p.category_slug===category)&&(!query||(p.title+' '+p.author).toLowerCase().includes(query));});
      if(sort&&sort.value==='price-low')books.sort(function(a,b){return a.price_paise-b.price_paise});
      if(sort&&sort.value==='price-high')books.sort(function(a,b){return b.price_paise-a.price_paise});
      if(sort&&sort.value==='popular')books.sort(function(a,b){return (b.sales||0)-(a.sales||0)});
      grid.innerHTML=books.map(function(p){return '<a class="book-card" href="/product/?slug='+encodeURIComponent(p.slug)+'">'+(p.cover_path?'<img class="w-full rounded-lg" src="'+escape(p.cover_path)+'" alt="'+escape(p.title)+'">':'<div class="card p-6">PDF ebook</div>')+'<h2 class="font-semibold mt-4">'+escape(p.title)+'</h2><p class="muted text-sm">'+escape(p.author)+'</p><p class="font-ui font-semibold mt-2">INR '+(p.price_paise/100).toLocaleString('en-IN')+'</p></a>'}).join('');
      document.querySelectorAll('[data-filter]').forEach(function(c){c.classList.toggle('is-active',c.dataset.filter===category)});
      var count=document.getElementById('title-count'),empty=document.getElementById('empty-state');if(count)count.textContent=books.length+' titles';if(empty)empty.classList.toggle('hidden',books.length>0);
    }
    if(rail)rail.addEventListener('click',function(e){var chip=e.target.closest('[data-filter]');if(chip){category=chip.dataset.filter;render();}});
    if(search){search.value=new URLSearchParams(location.search).get('q')||'';search.addEventListener('input',render);search.closest('form').addEventListener('submit',function(e){e.preventDefault();render();});}
    if(sort)sort.addEventListener('change',render);render();
  }
  if(document.querySelector('[data-live-title]')){
    var current=data.products.find(function(p){return p.slug==='fitness-for-busy-professionals'});
    if(current){document.querySelector('[data-live-title]').textContent=current.title;document.querySelector('[data-live-description]').textContent=current.description||'';document.querySelectorAll('[data-live-price]').forEach(function(el){el.textContent='INR '+(current.price_paise/100).toLocaleString('en-IN')});}
    else{document.querySelector('[data-live-title]').textContent='This book is currently unavailable';document.querySelectorAll('[data-buy-now],[data-add-cart]').forEach(function(el){el.removeAttribute('data-buy-now');el.removeAttribute('data-add-cart');el.removeAttribute('href');el.setAttribute('aria-disabled','true');el.style.pointerEvents='none';});}
  }
  var detail=document.getElementById('product-detail');
  if(detail){
    var slug=new URLSearchParams(location.search).get('slug'),p=data.products.find(function(p){return p.slug===slug});
    if(!p){document.getElementById('product-status').textContent='This book is not currently available.';return;}
    document.title=p.title+' | Inkframe Press';document.getElementById('product-status').textContent='';detail.hidden=false;
    document.getElementById('product-title').textContent=p.title;document.getElementById('product-author').textContent=p.author;document.getElementById('product-description').textContent=p.description||'';document.getElementById('product-price').textContent='INR '+(p.price_paise/100).toLocaleString('en-IN');
    var cover=document.getElementById('product-cover');if(p.cover_path){cover.src=p.cover_path;cover.alt=p.title;}else cover.hidden=true;
    document.getElementById('product-buy').dataset.product=p.slug;document.getElementById('product-cart').dataset.product=p.slug;
    var list=function(value){return typeof value==='string'?JSON.parse(value):value||[];};
    var previews=list(p.preview_pages),testimonials=list(p.testimonials);
    document.querySelector('meta[name="description"]').content=(p.description||p.title).slice(0,160);
    document.getElementById('product-category').textContent=p.category_name?' / '+p.category_name:'';
    document.getElementById('product-cover-placeholder').hidden=Boolean(p.cover_path);
    var summary=(p.description||'').trim().split(/\n\s*\n/)[0].replace(/\s+/g,' ');
    document.getElementById('product-summary').textContent=summary.length>220?summary.slice(0,217).replace(/\s+\S*$/,'')+'...':summary;
    document.getElementById('detail-author').textContent=p.author||'Not specified';
    document.getElementById('detail-category').textContent=p.category_name||'';
    document.getElementById('detail-category-row').hidden=!p.category_name;
    document.getElementById('product-seller').textContent=data.settings&&data.settings.store_name||'Inkframe Press';
    document.getElementById('cover-sample').hidden=!(previews.length||p.sample_path);
    document.getElementById('sample-help').textContent=(previews.length||p.sample_path)?'Yes. Use "Read sample" near the cover to explore the available sample before you buy.':'A sample has not been added for this book yet. Contact us if you would like more information before buying.';
    document.getElementById('product-description').textContent=p.description||'More information about this ebook will be available soon.';
    document.getElementById('product-buy').href='/checkout/?product='+encodeURIComponent(p.slug);
    document.getElementById('preview-pages').hidden=!(previews.length||p.cover_path);
    document.getElementById('preview-jump').hidden=!(previews.length||p.cover_path);
    var gallery=(p.cover_path?[{path:p.cover_path,caption:'Cover'}]:[]).concat(previews.map(function(page,i){return {path:page.path,caption:page.caption||'Page '+(i+1)};}));
    document.getElementById('product-previews').innerHTML=gallery.map(function(page){return '<figure><img loading="lazy" src="'+escape(page.path)+'" alt="'+escape(page.caption)+'"><figcaption>'+escape(page.caption)+'</figcaption></figure>';}).join('');
    document.getElementById('reader-testimonials').hidden=!testimonials.length;
    document.getElementById('testimonial-jump').hidden=!testimonials.length;
    document.getElementById('product-testimonials').innerHTML=testimonials.map(function(t){return '<blockquote><p>'+escape(t.quote)+'</p><cite>'+escape(t.name)+'</cite></blockquote>';}).join('');
  }
}).catch(function(){var status=document.getElementById('product-status');if(status)status.textContent='Could not load the ebook. Please reload.';});
