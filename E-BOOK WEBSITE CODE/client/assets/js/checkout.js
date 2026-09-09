(function () {
  function escape(value){return String(value==null?'':value).replace(/[&<>"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]});}
  var root = document.getElementById('checkout-items');
  var discountPaise = 0, appliedCoupon = '', ready = false, submitting = false;
  var key = sessionStorage.getItem('inkframeCheckoutKey') || crypto.randomUUID();
  sessionStorage.setItem('inkframeCheckoutKey', key);
  function checkoutItems(){var direct=new URLSearchParams(location.search).get('product');return direct?(InkframeCart.products[direct]?[InkframeCart.products[direct]]:[]):InkframeCart.items();}
  function money(value) { return '\u20b9' + Number(value).toLocaleString('en-IN', {minimumFractionDigits: 0, maximumFractionDigits: 2}); }
  function render() {
    var items = checkoutItems();
    root.innerHTML = items.length ? '' : '<div class="p-4 rounded-lg bg-[#fff4dc] text-sm">Your cart is empty. <a class="accent" href="/ebooks/">Choose a product</a>.</div>';
    items.forEach(function (item) {
      var row = document.createElement('div'); row.className = 'checkout-item';
      row.innerHTML = (item.image ? '<img src="'+escape(item.image)+'" alt="'+escape(item.title)+' cover">' : '<div class="checkout-cover-placeholder" aria-hidden="true"></div>') + '<div class="checkout-item-copy"><p class="font-semibold">'+escape(item.title)+'</p><p>'+escape(item.detail)+'</p></div><strong>'+money(item.price)+'</strong>';
      root.appendChild(row);
    });
    var subtotal = items.reduce(function(sum,item){return sum+item.price},0), discount = discountPaise / 100, total = Math.max(0, subtotal-discount);
    document.getElementById('checkout-subtotal').textContent=money(subtotal); document.getElementById('checkout-discount').textContent='−'+money(discount); document.getElementById('checkout-total').textContent=money(total);
    document.getElementById('checkout-submit').disabled=!items.length || !ready || submitting;
    return {items:items, subtotal:subtotal, discount:discount, total:total};
  }
  document.getElementById('apply-coupon').addEventListener('click',async function(){var code=document.getElementById('coupon').value.trim().toUpperCase(),message=document.getElementById('coupon-message'),subtotal=checkoutItems().reduce(function(sum,item){return sum+item.price*100},0);try{var response=await fetch('/api/store/coupon',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({code:code,slugs:checkoutItems().map(function(item){return item.id})})}),body=await response.json();if(!response.ok)throw new Error(body.error||'Coupon could not be applied.');discountPaise=body.discount_paise;appliedCoupon=body.coupon;message.textContent='Coupon '+body.coupon+' applied.';message.style.color='#26713b';render()}catch(error){discountPaise=0;appliedCoupon='';message.textContent=error.message;message.style.color='var(--accent)';render()}});
  var message = document.getElementById('checkout-message');
  fetch('/api/profile', {credentials:'same-origin'}).then(async function(response) {
    if (response.status === 401) { location.href='/signin/?next='+encodeURIComponent(location.pathname+location.search); return; }
    var body = await response.json();
    if (!response.ok) throw new Error(body.error || 'Could not load your details.');
    var names = (body.profile.full_name || '').split(' ');
    document.getElementById('fn').value = names.shift() || '';
    document.getElementById('ln').value = names.join(' ');
    document.getElementById('em').value = body.profile.email;
    document.getElementById('ph').value = body.profile.mobile || '';
    await window.InkframeCatalogue;
    var configResponse=await fetch('/api/payments/config'),config=await configResponse.json();
    if(!configResponse.ok||!config.test_enabled)throw Error('Checkout is unavailable until secure live payments are configured.');
    ready = true; message.textContent = ''; render();
  }).catch(function(error) { message.textContent = error.message + ' Please reload to try again.'; });
  document.getElementById('checkout-form').addEventListener('submit', async function(event) {
    event.preventDefault();
    if (!ready || submitting || !this.reportValidity()) return;
    var button = document.getElementById('checkout-submit'), items = checkoutItems();
    submitting = true; button.disabled = true; button.textContent = 'Processing test payment...';
    message.textContent = '';
    try {
      var response = await fetch('/api/test-checkout', {
        method:'POST', credentials:'same-origin', headers:{'Content-Type':'application/json'},
        body:JSON.stringify({
          checkout_key:key, slugs:items.map(function(item){return item.id}), coupon:appliedCoupon,
          full_name:(document.getElementById('fn').value+' '+document.getElementById('ln').value).trim(),
          phone:document.getElementById('ph').value, country:document.getElementById('ct').value,
          terms:document.getElementById('checkout-terms').checked
        })
      });
      var body = await response.json();
      if (response.status === 401) { location.href='/signin/?next='+encodeURIComponent(location.pathname+location.search); return; }
      if (!response.ok) throw new Error(body.error || 'Test payment could not be completed. Please retry.');
      items.forEach(function(item){ InkframeCart.remove(item.id); });
      sessionStorage.removeItem('inkframeCheckoutKey');
      location.href='/thank-you/?order='+encodeURIComponent(body.order.id);
    } catch(error) {
      message.textContent=error.message; submitting=false; render(); button.textContent='Complete test payment';
    }
  });
  window.addEventListener('inkframe:cart',render);render();
})();
