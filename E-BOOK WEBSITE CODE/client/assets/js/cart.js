(function () {
  function escape(value){return String(value==null?'':value).replace(/[&<>"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]});}
  var root = document.getElementById('cart-items');
  if (!root) return;
  function money(value) { return '\u20b9' + Number(value).toLocaleString('en-IN', {minimumFractionDigits: 0, maximumFractionDigits: 2}); }
  function render() {
    var items = InkframeCart.items();
    root.innerHTML = '';
    if (!items.length) {
      root.innerHTML = '<div class="card p-10 text-center"><h2 class="text-2xl font-bold">Your cart is empty</h2><p class="muted mt-2">Choose a guide and it will appear here.</p><a class="btn btn-primary mt-6" href="/ebooks/">Browse ebooks</a></div>';
    }
    items.forEach(function (item) {
      var card = document.createElement('article');
      card.className = 'card p-5 md:p-7 flex gap-5 items-start';
      var visual = item.image ? '<img class="w-24 md:w-32 rounded-lg" src="' + escape(item.image) + '" alt="">' : '<div class="w-24 h-32 rounded-lg bg-[#2b0d08] text-white flex items-center justify-center text-xs font-ui text-center p-3">Meal Prep Planner</div>';
      card.innerHTML = visual + '<div class="flex-1"><p class="eyebrow">Digital product</p><h2 class="text-xl font-bold mt-2">' + escape(item.title) + '</h2><p class="muted text-sm mt-2">' + escape(item.detail) + ' · Instant digital delivery</p><div class="flex gap-3 mt-5"><a class="nav-link" href="' + escape(item.url) + '">View details</a><button class="nav-link" data-remove-item="' + escape(item.id) + '">Remove</button></div></div><strong class="font-ui">' + money(item.price) + '</strong>';
      root.appendChild(card);
    });
    var subtotal = items.reduce(function (sum, item) { return sum + item.price; }, 0);
    document.getElementById('cart-subtotal').textContent = money(subtotal);
    document.getElementById('cart-discount').textContent = money(0);
    document.getElementById('cart-total').textContent = money(subtotal);
    var checkout = document.getElementById('cart-checkout');
    checkout.style.pointerEvents = items.length ? '' : 'none'; checkout.style.opacity = items.length ? '' : '.45';
  }
  root.addEventListener('click', function (event) { var button = event.target.closest('[data-remove-item]'); if (button) InkframeCart.remove(button.dataset.removeItem); });
  window.addEventListener('inkframe:cart', render); render();
})();
