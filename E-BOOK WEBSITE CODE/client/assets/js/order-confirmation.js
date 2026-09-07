(async function () {
  var id = new URLSearchParams(location.search).get('order');
  var heading = document.querySelector('h1'), description = heading.nextElementSibling;
  var note = document.getElementById('test-order-note'), retry = document.getElementById('retry-email');
  note.hidden = false;
  function render(order, orders) {
    orders=orders || [order];
    var sent=orders.filter(function(o){return o.status==='paid'}).every(function(o){return Boolean(o.email_sent_at)});
    var paid = order.status === 'paid';
    heading.textContent = paid ? 'Your test payment is complete.' : 'Your order is ' + order.status + '.';
    description.textContent = !paid ? 'A download is available only for completed purchases.' : sent
      ? 'Your purchased PDFs have been sent to ' + order.delivery_email + '. Check your inbox and spam folder.'
      : 'Your book is ready to download, but email delivery is not confirmed yet. You can retry in two minutes.';
    note.textContent = 'Test order #' + order.id + ' | INR ' + (orders.reduce(function(sum,o){return sum+o.amount_paise},0) / 100).toLocaleString('en-IN') + ' | No money was charged.';
    var download=document.getElementById('order-download');download.hidden=true;
    var links=document.getElementById('order-files');if(!links){links=document.createElement('div');links.id='order-files';download.parentNode.appendChild(links);}links.replaceChildren();
    orders.filter(function(o){return o.status==='paid'}).forEach(function(o){var link=document.createElement('a');link.className='btn btn-primary mt-3';link.href='/api/library/'+encodeURIComponent(o.slug)+'/download';link.textContent='Download '+o.title;links.appendChild(link);});
    retry.hidden = !orders.some(function(o){return o.status==='paid'}) || sent;
  }
  async function load(retryEmail) {
    var response = await fetch('/api/test-checkout/' + encodeURIComponent(id) + (retryEmail ? '/retry-email' : ''), {method:retryEmail ? 'POST' : 'GET', credentials:'same-origin'});
    if (response.status === 401) { location.href='/signin/?next='+encodeURIComponent(location.pathname+location.search); return; }
    var body = await response.json();
    if (!response.ok) throw new Error(body.error || 'Unable to load order.');
    render(body.order, body.orders);
  }
  retry.addEventListener('click', async function () {
    retry.disabled = true;
    try { await load(true); } catch (error) { note.textContent = error.message; }
    finally { retry.disabled = false; }
  });
  if (!id) { heading.textContent='No order selected'; description.textContent='Complete checkout to view your order and download your book.'; return; }
  try { await load(false); } catch (error) { heading.textContent='Unable to load your order'; description.textContent=error.message; }
})();
