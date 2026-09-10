(async function(){
'use strict';
const $=s=>document.querySelector(s), escape=v=>String(v==null?'':v).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const money=n=>'INR '+(Number(n||0)/100).toLocaleString('en-IN',{minimumFractionDigits:2}),date=v=>v?new Date(v).toLocaleString('en-IN'):'-';
let csrf='',me={},data=[],categories=[],view='',generation=0,page=1;
const pageSize=10;
const descriptions={dashboard:'A clear picture of your store and recent activity.',products:'Manage your books, files and publishing status.',categories:'Organize your catalogue into easy-to-browse collections.',orders:'Track purchases, delivery and customer access.',customers:'Get to know the readers behind your orders.',coupons:'Create offers that give readers a reason to return.',settings:'Manage your store details and payment configuration.',team:'Choose who can manage your store.',activity:'A record of changes made in your workspace.'};
const message=(t,tone='success')=>{const el=$('#admin-message');el.textContent=t;el.dataset.tone=tone;};
async function api(p,options={}){
 const headers={'X-CSRF-Token':csrf,...(options.body instanceof File?{}:{'Content-Type':'application/json'}),...options.headers};
 const r=await fetch('/api/admin'+p,{credentials:'same-origin',cache:'no-store',...options,headers});
 const b=await r.json().catch(()=>({}));
 if(r.status===401){location.href='/signin/?next=/admin/';throw Error('Sign in required.');}
 if(!r.ok)throw Error(b.error||'The request failed.');return b;
}
const paths={dashboard:'M3 3h7v7H3z M14 3h7v7h-7z M3 14h7v7H3z M14 14h7v7h-7z',book:'M4 3h14a2 2 0 0 1 2 2v16H6a2 2 0 0 1-2-2V3z M4 17h16 M8 7h8 M8 10h5',grid:'M3 4h7v6H3z M14 4h7v6h-7z M3 14h7v6H3z M14 14h7v6h-7z',orders:'M6 3h12v18l-3-2-3 2-3-2-3 2V3z M9 7h6 M9 11h6 M9 15h4',users:'M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2 M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8 M20 21v-2a4 4 0 0 0-3-4 M17 3a4 4 0 0 1 0 8',tag:'M20 13l-7 7-10-10V3h7l10 10z M7 7h.01',settings:'M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8 M10 2h4l1 3 3 1 3-1 2 4-2 3 1 3-3 2-1 3h-4l-1-3-3-1-3 1-2-4 2-3-1-3 3-2 1-3z',shield:'M12 3l8 3v6c0 5-8 9-8 9s-8-4-8-9V6l8-3z M8 12l3 3 5-6',activity:'M3 12h4l3-8 4 16 3-8h4',external:'M14 3h7v7 M21 3l-11 11 M10 3H4v17h17v-6',logout:'M9 3H4v18h5 M10 12h11 M17 8l4 4-4 4',search:'M21 21l-5-5 M10 3a7 7 0 1 0 0 14 7 7 0 0 0 0-14'};
function icon(name){return '<svg class="admin-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="'+(paths[name]||paths.grid)+'"></path></svg>';}
document.querySelectorAll('[data-icon]').forEach(el=>el.insertAdjacentHTML('afterbegin',icon(el.dataset.icon)));
const send=(p,b,method='POST')=>api(p,{method,body:JSON.stringify(b)});
function heading(title,actions=''){return '<div class="admin-toolbar page-heading"><div><h1>'+escape(title)+'</h1><p class="page-description">'+escape(descriptions[view]||'Manage your store.')+'</p></div><div class="admin-actions">'+actions+'</div></div>';}
function button(label,action,id='',extra=''){return '<button type="button" class="btn '+(action==='add'?'btn-primary':'btn-ghost')+(['refund','revoke','archive','delete'].includes(action)?' btn-danger':'')+'" data-action="'+action+'" data-id="'+escape(id)+'" '+extra+'>'+escape(label)+'</button>';}
function table(headers,rows){return '<div class="card table-wrap mt-6" tabindex="0" role="region" aria-label="'+escape(view||'Records')+' table"><table class="data-table"><thead><tr>'+headers.map(h=>'<th scope="col">'+escape(h)+'</th>').join('')+'</tr></thead><tbody>'+ (rows.length?rows.map(r=>'<tr>'+r.map((c,i)=>'<td data-label="'+escape(headers[i])+'"><div class="cell-content">'+c+'</div></td>').join('')+'</tr>').join(''):'<tr><td class="table-empty" colspan="'+headers.length+'"><strong>No records to show</strong>New records will appear here. Try adjusting your filters.</td></tr>')+'</tbody></table></div>';}
function activitySummary(record){
 let details=record.details;
 if(typeof details==='string'){try{details=JSON.parse(details);}catch{details={};}}
 if(!details||typeof details!=='object'||Array.isArray(details))details={};
 const value=key=>['string','number'].includes(typeof details[key])?String(details[key]).trim():'';
 const item=(label,key)=>value(key)?label+' "'+value(key)+'"':value('id')?label+' #'+value('id'):label.toLowerCase();
 const order=value('order')?'order #'+value('order'):'an order';
 const customer=value('id')?'customer #'+value('id'):'a customer';
 const email=value('email')||'an admin';
 switch(record.action){
  case 'Product saved':return 'Saved '+item('Book','title')+({published:' with published status',draft:' as a draft',archived:' with archived status'}[value('status')]||'')+'.';
  case 'Product archived':return 'Archived '+item('Book','title')+'.';
  case 'Product deleted':return 'Deleted '+item('Book','title')+'.';
  case 'Category deleted':return 'Deleted '+item('Category','name')+'.';
  case 'Category saved':return 'Saved '+item('Category','name')+'.';
  case 'Coupon saved':return 'Saved '+item('Coupon','code')+'.';
  case 'File uploaded':{
   const extension=value('name').split('.').pop().toLowerCase();
   if(value('kind')==='paid')return 'Uploaded a book file for paying customers.';
   if(['jpg','jpeg','png','gif','webp','avif','svg'].includes(extension))return 'Uploaded an image for the store.';
   if(extension==='pdf')return 'Uploaded a public PDF file.';
   return 'Uploaded a file for the store.';
  }
  case 'Download email resent':return 'Resent the download email for '+order+'.';
  case 'Test order refunded':return 'Marked test '+order+' as refunded.';
  case 'Store settings updated':return 'Updated the store settings.';
  case 'Admin access granted':return 'Granted admin access to '+email+'.';
  case 'Admin access revoked':return 'Removed admin access for '+email+'.';
  case 'Admin invitation sent':return 'Sent an admin invitation to '+email+'.';
  case 'Customer access restored':return 'Restored account access for '+customer+'.';
  case 'Customer access suspended':return 'Suspended account access for '+customer+'.';
  default:return 'Recorded an admin action.';
 }
}
function orderDetails(r){
 let customer=r.customer_details;
 if(typeof customer==='string'){try{customer=JSON.parse(customer);}catch{customer={};}}
 if(!customer||typeof customer!=='object'||Array.isArray(customer))customer={};
 const textValue=value=>typeof value==='string'||typeof value==='number'?String(value):'';
 const field=(label,value)=>'<div><dt>'+escape(label)+'</dt><dd>'+escape(value||'Not recorded')+'</dd></div>';
 const section=(title,fields,note='')=>'<section class="order-detail-section"><h3>'+escape(title)+'</h3><dl>'+fields+'</dl>'+(note?'<p class="order-detail-note">'+escape(note)+'</p>':'')+'</section>';
 const test=r.payment_method==='test',eligible=Boolean(Number(r.can_download)),attempts=Number(r.email_attempt_count||0);
 const emailStatus=r.email_sent_at?'Sent — accepted by mail server':!eligible?'Not scheduled':attempts>=5?'Needs attention — automatic retries stopped':r.email_last_error?'Not sent — retry pending':'Pending delivery';
 const problems={EAUTH:'Email account sign-in failed. Check the store’s email settings.',ECONNECTION:'The mail server could not be reached.',ETIMEDOUT:'The mail server took too long to respond.',ESOCKET:'The connection to the mail server was interrupted.',EENVELOPE:'The sender or recipient address was rejected.',EMESSAGE:'The mail server did not accept the email.',ENOENT:'The book attachment could not be found.'};
 const problem=r.email_last_error?(problems[r.email_last_error]||'The latest email attempt did not complete. Check the email settings and book attachment.'):'None recorded';
 const status={paid:'Paid',pending:'Awaiting payment',refunded:'Refunded',cancelled:'Cancelled',failed:'Payment failed'}[r.status]||'Not recorded';
 let cover='';
 try{const url=new URL(r.cover_path||'',location.origin);if(r.cover_path&&url.origin===location.origin&&url.pathname.startsWith('/'))cover='<img src="'+escape(url.pathname)+'" alt="'+escape(r.title)+' cover" width="64" height="88">';}catch{}
 let html='<div class="order-detail-book">'+cover+'<div><h3>'+escape(r.title)+'</h3><p>'+escape(r.author||'Digital ebook')+'</p><span class="status-badge status-'+(r.status==='paid'?'green':r.status==='refunded'?'red':'amber')+'">'+escape(status)+'</span>'+(test?' <span class="status-badge status-gray">Test order</span>':'')+'</div><strong>'+money(r.amount_paise)+'</strong></div><div class="order-detail-grid">';
 html+=section('Order & payment',field('Order number','#'+r.order_number)+field('Placed on',date(r.created_at))+field(test?'Simulated order total':'Order total',money(r.amount_paise))+field('Payment status',status)+field('Payment method',test?'Test payment':({razorpay:'Razorpay',stripe:'Stripe',paypal:'PayPal'}[r.payment_method]||'Not recorded'))+field('Payment verified',test?'Not applicable — test payment':r.verified_at?date(r.verified_at):'Not confirmed'),test?'No money was charged for this order.':'');
 html+=section('Customer at checkout',field('Full name',textValue(customer.full_name)||r.full_name)+field('Account email',r.email)+field('Phone',Object.hasOwn(customer,'phone')?(textValue(customer.phone)||'Not provided'):(r.mobile||'Not provided'))+field('Country',textValue(customer.country))+field('Account access',Number(r.customer_active)?'Active':'Suspended'));
 html+=section('Email delivery',field('Delivery status',emailStatus)+field('Recipient',r.delivery_email||r.email)+field('Last email sent',r.email_sent_at?date(r.email_sent_at):'Not sent yet')+field('Last attempt',r.email_attempt_at?date(r.email_attempt_at):'Not recorded')+field('Recorded attempts',attempts?String(attempts):'No attempts recorded')+field('Latest delivery issue',problem),r.email_sent_at?'The mail server accepted the email. Inbox arrival and whether the customer opened it are not tracked.':eligible?(attempts>=5?'Automatic retries have reached their limit. Use Resend email to try again.':'Unsent emails are retried automatically, up to five attempts. Allow at least two minutes between manual attempts.'):'Email delivery is available only for eligible paid orders.');
 html+=section('Book access',field('Format','PDF ebook')+field('Download access',eligible?(Number(r.customer_active)?'Available in My Library':'Account suspended — restore access to sign in'):r.status==='refunded'?'Removed after refund':'Not available')+field('Downloads',String(Number(r.download_count||0)))+field('Delivery method','Email attachment and My Library'),'Download dates and individual device activity are not recorded.');
 html+='</div>';
 const related=r.checkout_group?data.filter(o=>o.checkout_group===r.checkout_group&&String(o.id)!==String(r.id)):[];
 if(related.length)html+='<section class="order-detail-section order-related"><h3>Other books in this checkout</h3>'+related.map(o=>'<div>'+button('Order #'+o.order_number,'details',o.id)+'<span>'+escape(o.title)+'</span><strong>'+money(o.amount_paise)+'</strong></div>').join('')+'</section>';
 html+='<p class="order-detail-note">This order records the final amount. A separate original price, coupon, and tax breakdown was not saved.</p>';
 html+='<div class="order-detail-actions">'+button('Refresh status','order-refresh',r.id)+(eligible?button('Resend email','resend',r.id):'')+'</div>';
 return html;
}

function badge(value){const green=['paid','published','active','verified'],amber=['pending','draft','unverified'];return '<span class="status-badge status-'+(green.includes(value)?'green':amber.includes(value)?'amber':value==='refunded'?'red':'gray')+'">'+escape(value)+'</span>';}
function person(name,email){return '<div class="customer-cell"><span class="customer-avatar" aria-hidden="true">'+escape((name||email||'?').slice(0,2).toUpperCase())+'</span><div><span class="cell-primary">'+escape(name||'Customer')+'</span><span class="cell-secondary">'+escape(email)+'</span></div></div>';}
function input(name,label,value='',type='text',extra=''){return '<label>'+escape(label)+'<input class="field mt-2" name="'+name+'" type="'+type+'" value="'+escape(value)+'" '+extra+'></label>';}
function select(name,label,options,value){return '<label>'+escape(label)+'<select class="field mt-2" name="'+name+'">'+options.map(o=>'<option value="'+escape(o[0])+'" '+(String(o[0])===String(value)?'selected':'')+'>'+escape(o[1])+'</option>').join('')+'</select></label>';}
function open(title,html){$('#dialog-title').textContent=title;$('#dialog-body').innerHTML=html;$('#dialog-message').textContent='';$('#admin-dialog').showModal();document.body.classList.add('dialog-open');}
function form(kind,id,html){return '<form data-form="'+kind+'" data-id="'+escape(id||'')+'" class="admin-form">'+html+'<div class="wide"><button class="btn btn-primary" type="submit">Save changes</button></div></form>';}
function filters(statuses=[]){
 const statusControl=view==='products'?'<div id="status" class="status-filters" role="group" aria-label="Filter product status" data-value="">'+['',...statuses].map(s=>'<button type="button" data-status-filter="'+escape(s)+'" aria-pressed="'+(s==='')+'">'+(s?escape(s.charAt(0).toUpperCase()+s.slice(1)):'All statuses')+'</button>').join('')+'</div>':statuses.length?'<select class="field !w-auto" id="status" aria-label="Filter status"><option value="">All statuses</option>'+statuses.map(s=>'<option>'+s+'</option>').join('')+'</select>':'';
 return '<div class="list-filters"><div class="search-control">'+icon('search')+'<input class="field" id="search" placeholder="Search '+escape(view)+'..." aria-label="Search '+escape(view)+'"></div>'+statusControl+(view==='orders'?'<input type="date" id="order-date" class="field !w-auto" aria-label="Filter order date">':'')+'<span class="filter-count" id="filter-count"></span></div><div id="list"></div>';
}
function selectedRows(){const q=($('#search')?.value||'').toLowerCase(),status=$('#status')?.value??$('#status')?.dataset.value,day=$('#order-date')?.value;return data.filter(r=>(!q||(JSON.stringify(r).toLowerCase().includes(q)||(view==='orders'&&('#'+r.order_number).includes(q))))&&(!status||r.status===status)&&(!day||new Date(r.created_at).toLocaleDateString('en-CA')===day));}
function renderList(){const all=selectedRows();const pages=Math.max(1,Math.ceil(all.length/pageSize));page=Math.min(page,pages);const rows=all.slice((page-1)*pageSize,page*pageSize);let html='';
 if(view==='products')html=table(['Select','Product','Category','Price','Purchases','Status','Actions'],rows.map(r=>['<input type="checkbox" data-product-check value="'+r.id+'" aria-label="Select '+escape(r.title)+'">',escape(r.title),escape(r.category||'-'),money(r.price_paise),escape(r.sales),badge(r.status),button('Edit','edit',r.id)+button('Archive','archive',r.id)+button('Delete','delete',r.id)+' <a class="nav-link" href="/product/?slug='+encodeURIComponent(r.slug)+'" target="_blank" rel="noopener">Preview</a>']));
 if(view==='categories')html=table(['Name','Order','Products','Status','Actions'],rows.map(r=>[escape(r.name),escape(r.sort_order),escape(r.products),badge(r.status),button('Edit','edit',r.id)+button('Delete','delete',r.id)]));
 if(view==='coupons')html=table(['Code','Discount','Minimum','Usage','Expiry','Status','Actions'],rows.map(r=>[escape(r.code),r.discount_type==='percent'?escape(r.discount_value)+'%':money(r.discount_value),money(r.minimum_paise),escape(r.used_count)+' / '+escape(r.usage_limit||'Unlimited'),date(r.expires_at),badge(r.status),button('Edit / disable','edit',r.id)]));
 if(view==='orders')html=table(['Order','Customer','Product','Payment','Total','Delivery','Downloads','Actions'],rows.map(r=>['#'+r.order_number+'<br>'+escape(date(r.created_at)),person(r.full_name,r.email),escape(r.title),badge(r.status)+'<br>'+escape(r.payment_method||'Unconfirmed'),money(r.amount_paise),r.email_sent_at?'Sent '+escape(date(r.email_sent_at)):'Not confirmed',escape(r.download_count),button('Details','details',r.id)+(r.status==='paid'?button('Resend PDF','resend',r.id):'')]));
 if(view==='customers')html=table(['Customer','Mobile','Orders','Spending','Last purchase','Status','Actions'],rows.map(r=>[person(r.full_name,r.email),escape(r.mobile||'-'),escape(r.orders),money(r.lifetime_paise),escape(date(r.last_purchase)),badge(!r.is_active?'suspended':r.is_verified?'verified':'unverified'),button('View purchases','customer-orders',r.id)+(r.role==='CUSTOMER'?button(r.is_active?'Suspend access':'Restore access','customer-access',r.id):'')]));
 $('#list').innerHTML=html+'<div class="list-pagination"><span>'+ (all.length?((page-1)*pageSize+1)+'–'+Math.min(page*pageSize,all.length):'0')+' of '+all.length+' records</span><div class="pagination-controls">'+button('Previous','previous-page','',''+(page===1?'disabled':''))+'<span>Page '+page+' of '+pages+'</span>'+button('Next','next-page','',''+(page===pages?'disabled':''))+'</div></div>';if($('#filter-count'))$('#filter-count').textContent=all.length+' results';
}
function bestsellerCard(books){
 const highest=Math.max(1,...books.map(b=>Number(b.purchases)||0));
 const content=books.length?'<ol class="bestseller-list">'+books.map((book,index)=>'<li><span class="bestseller-rank">'+String(index+1).padStart(2,'0')+'</span><div class="bestseller-book"><span class="bestseller-name">'+escape(book.title)+'</span><div class="bestseller-track" aria-hidden="true"><span style="width:'+Math.min(100,(Number(book.purchases)||0)/highest*100)+'%"></span></div></div><div class="bestseller-sales"><strong>'+escape(book.purchases)+'</strong><span>'+ (Number(book.purchases)===1?'purchase':'purchases')+'</span></div></li>').join('')+'</ol>':'<div class="bestseller-empty"><span class="bestseller-empty-icon">'+icon('book')+'</span><h3>No paid purchases yet</h3><p>Your books will appear here after their first real purchase. Test orders are not included.</p><a class="btn btn-ghost" href="#orders">View orders <span aria-hidden="true">&rarr;</span></a></div>';
 return '<section class="card dashboard-card bestseller-card" aria-labelledby="bestseller-title"><header class="dashboard-card-header"><div><h2 id="bestseller-title">Bestsellers</h2><p>Ranked by real purchases in this period</p></div><span class="bestseller-label">'+icon('activity')+' Real sales</span></header>'+content+'</section>';
}
async function load(){const version=++generation;view=location.hash.slice(1)||'dashboard';page=1;message('Loading your workspace...');$('#admin-content').setAttribute('aria-busy','true');setMenu(false);
 try{
  let html='';
  if(view==='dashboard'){
   const days=sessionStorage.getItem('adminDays')||'30',d=await api('/dashboard?days='+days);
   html=heading('Store overview','<select id="days" class="field"><option value="7" '+(days==='7'?'selected':'')+'>Last 7 days</option><option value="30" '+(days==='30'?'selected':'')+'>Last 30 days</option><option value="365" '+(days==='365'?'selected':'')+'>Last year</option></select>')+'<div class="grid sm:grid-cols-2 xl:grid-cols-4 gap-4 mt-7">'+[['Real sales',money(d.metrics.sales_paise)],['Orders',d.metrics.orders],['Verified customers',d.metrics.customers],['Published books',d.metrics.products]].map(x=>'<div class="metric"><span>'+x[0]+'</span><strong>'+escape(x[1])+'</strong></div>').join('')+'</div><p class="dashboard-test-note">'+escape(d.metrics.test_orders)+' test orders in this period. Test payments are excluded from real sales.</p><div class="dashboard-insights"><section class="card dashboard-card daily-activity" aria-labelledby="daily-title"><header class="dashboard-card-header"><div><h2 id="daily-title">Daily activity</h2><p>Orders and revenue over your selected period</p></div></header>'+table(['Day','Orders','Real sales'],d.daily.map(r=>[escape(new Date(r.day).toLocaleDateString()),escape(r.orders),money(r.sales_paise)]))+'</section>'+bestsellerCard(d.bestsellers)+'</div><h2 class="text-xl font-bold mt-8">Recent orders</h2>'+table(['Order','Book','Status','Amount'],d.recent.map(r=>['#'+r.order_number,escape(r.title),badge(r.status),money(r.amount_paise)]));
  }else if(['products','categories','coupons','orders','customers'].includes(view)){
   const result=await api('/'+view);if(version!==generation)return;data=result[view];
   html=heading(view.charAt(0).toUpperCase()+view.slice(1),(['products','categories','coupons'].includes(view)?button('Add new','add'):'')+(view==='products'?button('Archive selected','bulk'):'')+(view==='orders'?button('Export filtered CSV','export'):''))+filters(view==='products'?['published','draft','archived']:view==='orders'?['paid','pending','refunded','cancelled']:view==='coupons'?['active','inactive']:[]);
  }else if(view==='analytics'){
   const d=await api('/analytics'),t=d.totals;
   html=heading('Analytics')+'<p class="muted mt-4">Revenue includes backend-verified paid orders only. Test orders and unverified legacy orders are excluded. Purchases count book order lines.</p><div class="grid sm:grid-cols-2 xl:grid-cols-4 gap-4 mt-7">'+[['Total revenue',money(t.revenue_paise)],['Completed purchases',t.successful_orders],['Failed payments',t.failed_payments],['Total orders',t.total_orders],['Total books',t.books],['Customers',t.customers]].map(x=>'<div class="metric"><span>'+escape(x[0])+'</span><strong>'+escape(x[1])+'</strong></div>').join('')+'</div><h2 class="text-xl font-bold mt-8">Monthly sales and revenue trend</h2>'+table(['Month','Completed purchases','Failed payments','Revenue'],d.monthly.map(r=>[escape(r.month),escape(r.purchases),escape(r.failed_payments),money(r.revenue_paise)]))+'<h2 class="text-xl font-bold mt-8">Best-selling books</h2>'+table(['Book','Purchases','Revenue'],d.bestsellers.map(r=>[escape(r.title),escape(r.purchases),money(r.revenue_paise)]))+'<h2 class="text-xl font-bold mt-8">Recent orders</h2>'+table(['Order','Book','Status','Amount'],d.recent.map(r=>['#'+r.order_number,escape(r.title),badge(r.status),money(r.amount_paise)]));
  }else if(view==='settings'){
   const d=await api('/settings'),s=d.settings;
   html=heading('Payments & settings')+'<div class="card p-6 mt-6"><h2 class="text-xl font-bold">Test payments '+(d.payments.enabled?'enabled':'disabled')+'</h2><p class="mt-3">No live gateway is connected. Real charges, payouts, gateway refunds and GST invoice generation are unavailable until a provider is integrated.</p><p class="mt-3">Email credentials: '+(d.smtp_configured?'Configured':'Missing')+'</p></div><div class="card p-6 mt-6">'+form('settings','',input('store_name','Store name',s.store_name||'Inkframe Press','text','maxlength="120" required')+input('support_email','Support email',s.support_email||'','email')+input('gstin','GSTIN (optional, stored for future invoices)',s.gstin||'','text','maxlength="15"'))+'</div>';
  }else if(view==='team'){
   const d=await api('/team');data=d.members;html=heading('Admin access')+'<p class="muted mt-5">Owner: '+escape(d.owner)+'. Only the owner can grant or revoke access. Grant access only to existing verified customer accounts.</p><div class="card p-6 mt-6">'+form('team','',input('email','New administrator email','','email','required'))+'</div>'+table(['Administrator','Access granted','Actions'],d.members.map(r=>[escape(r.email),escape(date(r.created_at)),button('Send invitation','invite',r.email)+button('Revoke access','revoke',r.email)]));
  }else if(view==='activity'){
   const d=await api('/activity');html=heading('Activity log')+'<p class="muted mt-4">The latest 200 admin actions: who made each change and when.</p>'+table(['When','Admin','What changed'],d.activity.map(r=>[escape(date(r.created_at)),escape(r.email||'System'),escape(activitySummary(r))]));
  }else{location.hash='#dashboard';return;}
  if(version!==generation)return;$('#admin-content').innerHTML=html;$('#admin-content').setAttribute('aria-busy','false');$('#admin-breadcrumb').textContent=({dashboard:'Overview',settings:'Payments & settings',team:'Admin access',activity:'Activity log'}[view]||view.charAt(0).toUpperCase()+view.slice(1));document.title=$('#admin-breadcrumb').textContent+' | Inkframe Admin';document.querySelectorAll('.admin-nav a').forEach(a=>{a.classList.toggle('is-active',a.hash==='#'+view);if(a.hash==='#'+view)a.setAttribute('aria-current','page');else a.removeAttribute('aria-current');});if($('#list'))renderList();message('');
 }catch(e){if(version!==generation)return;message(e.message,'error');$('#admin-content').innerHTML=button('Try again','reload');$('#admin-content').setAttribute('aria-busy','false');}
}
function listValue(value){return typeof value==='string'?JSON.parse(value):value||[];}
function previewRow(p={}){return '<div class="landing-row" data-preview-row><label>Preview image<input class="field mt-2" data-preview-path value="'+escape(p.path||'')+'" readonly></label><input class="field" type="file" data-preview-upload accept="image/png,image/jpeg" aria-label="Upload preview page"><label>Page caption<input class="field mt-2" data-preview-caption maxlength="200" value="'+escape(p.caption||'')+'"></label><button type="button" class="btn btn-ghost" data-remove-landing>Remove page</button></div>';}
function testimonialRow(t={}){return '<div class="landing-row" data-testimonial-row><label>Reader name<input class="field mt-2" data-reader-name maxlength="120" required value="'+escape(t.name||'')+'"></label><label>Testimonial<textarea class="field mt-2" data-reader-quote rows="3" maxlength="1500" required>'+escape(t.quote||'')+'</textarea></label><button type="button" class="btn btn-ghost" data-remove-landing>Remove testimonial</button></div>';}
async function editor(row={}){
 if(view==='products'){
  categories=(await api('/categories')).categories;
  open(row.id?'Edit product':'Add product',form('products',row.id,input('title','Title',row.title||'','text','required minlength="2" maxlength="255"')+input('slug','URL slug',row.slug||'','text',row.id?'readonly':'')+input('author','Author',row.author||'Inkframe Press','text','required maxlength="160"')+input('price','Price in INR',(row.price_paise||0)/100,'number','required min="0" step="0.01"')+select('category_id','Category',[['','Unassigned'],...categories.map(c=>[c.id,c.name])],row.category_id)+select('status','Status',[['draft','Draft'],['published','Published'],['archived','Archived']],row.status||'draft')+'<label class="wide">Description<textarea name="description" class="field mt-2" rows="5" maxlength="15000">'+escape(row.description||'')+'</textarea></label>'+['cover_path','pdf_path','sample_path'].map((field,i)=>'<div>'+input(field,['Cover image','Paid PDF (private)','Sample preview'][i],row[field]||'','text','readonly')+'<input class="field mt-2" type="file" data-upload="'+field+'" accept="'+(i===0?'image/png,image/jpeg':'application/pdf')+'"><p class="text-sm muted">'+(i===1?'PDF up to 20 MB.':'Optional; up to 20 MB.')+'</p></div>').join('')));
  const f=$('[data-form="products"]');
  ['cover_path','sample_path'].forEach(field=>{f.elements[field].parentElement.parentElement.insertAdjacentHTML('beforeend','<button type="button" class="btn btn-ghost" data-clear-file="'+field+'">Remove '+(field==='cover_path'?'cover':'sample')+'</button>');});
  f.lastElementChild.insertAdjacentHTML('beforebegin','<section class="wide landing-editor"><h3>Preview pages</h3><p class="muted">Add up to 3 PNG or JPEG images in reading order. Recommended publisher banner size: 970 &times; 600 px (97:60 ratio). These appear in From the Publisher, centered at up to 970 px wide and scaled proportionally on mobile. Optimize file size while keeping text sharp. Empty slots are optional; the cover is shown separately.</p><div id="preview-rows">'+Array.from({length:Math.max(3,listValue(row.preview_pages).length)},(_,i)=>previewRow(listValue(row.preview_pages)[i]||{})).join('')+'</div><button class="btn btn-ghost" type="button" data-add-preview>Add preview page</button></section><section class="wide landing-editor"><h3>Reader testimonials</h3><p class="muted">Add up to 10 reader quotes you have permission to publish.</p><div id="testimonial-rows">'+listValue(row.testimonials).map(testimonialRow).join('')+'</div><button class="btn btn-ghost" type="button" data-add-testimonial>Add testimonial</button></section>');
 }else if(view==='categories')open('Category details',form('categories',row.id,input('name','Name',row.name||'','text','required minlength="2" maxlength="120"')+input('slug','URL slug',row.slug||'','text',row.id?'readonly':'')+input('description','Description',row.description||'','text','maxlength="3000"')+input('sort_order','Display order',row.sort_order||0,'number','min="0" max="9999"')+select('status','Status',[['active','Active'],['draft','Draft']],row.status||'active')+'<div>'+input('banner_path','Category banner',row.banner_path||'','text','readonly')+'<input class="field mt-2" type="file" data-upload="banner_path" accept="image/png,image/jpeg"></div>'));
 else if(view==='coupons'){const books=(await api('/products')).products;open('Coupon details',form('coupons',row.id,input('code','Coupon code',row.code||'','text','required minlength="2" maxlength="40"')+select('type','Discount type',[['percent','Percent'],['flat','INR amount']],row.discount_type||'percent')+input('value','Discount value',row.discount_type==='flat'?row.discount_value/100:row.discount_value||20,'number','required min="0.01" step="0.01"')+input('minimum','Minimum order in INR',(row.minimum_paise||0)/100,'number','min="0" step="0.01"')+input('limit','Total usage limit (blank for unlimited)',row.usage_limit||'','number','min="1" step="1"')+input('expires','Expiry date',row.expires_at?new Date(row.expires_at).toLocaleDateString('en-CA'):'','date')+select('status','Status',[['active','Active'],['inactive','Inactive']],row.status||'active')+select('ebook_id','Applies to',[['','All products'],...books.map(p=>[p.id,p.title])],row.ebook_id)));}
}
document.addEventListener('submit',async e=>{
 const f=e.target.closest('[data-form]');if(!f)return;e.preventDefault();if(Number(f.dataset.uploads)>0)return;if(!f.reportValidity())return;const b=f.querySelector('button[type=submit]');b.disabled=true;
 try{const body=Object.fromEntries(new FormData(f));if(f.dataset.form==='products'){
  body.preview_pages=Array.from(f.querySelectorAll('[data-preview-row]')).map(r=>({path:r.querySelector('[data-preview-path]').value,caption:r.querySelector('[data-preview-caption]').value})).filter(p=>p.path);
  body.testimonials=Array.from(f.querySelectorAll('[data-testimonial-row]')).map(r=>({name:r.querySelector('[data-reader-name]').value,quote:r.querySelector('[data-reader-quote]').value}));
 }await send('/'+f.dataset.form+(f.dataset.id?'/'+f.dataset.id:''),body,f.dataset.form==='settings'||f.dataset.id?'PUT':'POST');$('#admin-dialog').close();await load();message('Saved successfully.');}catch(error){if($('#admin-dialog').open)$('#dialog-message').textContent=error.message;else message(error.message,'error');}finally{b.disabled=false;}
});
document.addEventListener('change',async e=>{
 if(e.target.id==='days'){sessionStorage.setItem('adminDays',e.target.value);load();}
 if(['status','order-date'].includes(e.target.id)){page=1;renderList();}
 const field=e.target.dataset.upload,preview=e.target.hasAttribute('data-preview-upload');if(!field&&!preview)return;const file=e.target.files[0];if(!file)return;const form=e.target.closest('form'),save=form.querySelector('button[type=submit]');form.dataset.uploads=Number(form.dataset.uploads||0)+1;save.disabled=true;
 try{if(file.size>20*1024*1024)throw Error('Maximum upload size is 20 MB.');if((preview||field==='cover_path')&&!['image/png','image/jpeg'].includes(file.type))throw Error('Choose a PNG or JPEG image.');const result=await api('/uploads?kind='+(field==='pdf_path'?'paid':'public'),{method:'POST',headers:{'Content-Type':file.type},body:file});if(preview)e.target.closest('[data-preview-row]').querySelector('[data-preview-path]').value=result.path;else form.elements[field].value=result.path;$('#dialog-message').textContent='File uploaded. Save the product to attach it.';}catch(error){$('#dialog-message').textContent=error.message;}finally{form.dataset.uploads=Number(form.dataset.uploads)-1;save.disabled=Number(form.dataset.uploads)>0;}
});
document.addEventListener('input',e=>{if(e.target.id==='search'){page=1;renderList();}});
document.addEventListener('click',async e=>{
 const statusButton=e.target.closest('[data-status-filter]');
 if(statusButton){
  const group=statusButton.closest('.status-filters');group.dataset.value=statusButton.dataset.statusFilter;
  group.querySelectorAll('button').forEach(button=>button.setAttribute('aria-pressed',String(button===statusButton)));
  page=1;renderList();return;
 }
 const clear=e.target.closest('[data-clear-file]');if(clear){clear.closest('form').elements[clear.dataset.clearFile].value='';return;}
 if(e.target.closest('[data-add-preview]')){if($('#preview-rows').children.length<3)$('#preview-rows').insertAdjacentHTML('beforeend',previewRow());else $('#dialog-message').textContent='You can add up to 3 preview pages.';return;}
 if(e.target.closest('[data-add-testimonial]')){if($('#testimonial-rows').children.length<10)$('#testimonial-rows').insertAdjacentHTML('beforeend',testimonialRow());else $('#dialog-message').textContent='You can add up to 10 testimonials.';return;}
 if(e.target.closest('[data-remove-landing]')){e.target.closest('.landing-row').remove();return;}
 const b=e.target.closest('[data-action]');if(!b||b.disabled)return;const a=b.dataset.action,id=b.dataset.id,r=data.find(r=>String(r.id)===id);b.disabled=true;
 try{
  if(a==='reload'){await load();return;}
  if(a==='next-page'||a==='previous-page'){page+=a==='next-page'?1:-1;renderList();return;}
  if(a==='add'||a==='edit')await editor(r||{});
  if(a==='archive'||a==='bulk'){const ids=a==='archive'?[id]:Array.from(document.querySelectorAll('[data-product-check]:checked')).map(c=>c.value);if(!ids.length)throw Error('Select products first.');if(!confirm('Archive '+ids.length+' product(s)? Existing buyers keep access.'))return;for(const i of ids)await api('/products/'+i,{method:'DELETE'});await load();message('Products archived.');}
  if(a==='delete'&&r&&['products','categories'].includes(view)){
   const product=view==='products',name=product?r.title:r.name;
   if(!confirm('Permanently delete "'+name+'"? '+(product?'This cannot be undone. Products with order history cannot be deleted; use Archive instead.':'Books in this category will be kept and marked Unassigned. This cannot be undone.')))return;
   await api('/'+view+'/'+id+(product?'/permanent':''),{method:'DELETE'});
   await load();message(product?'Product deleted.':'Category deleted. Its books were kept.');
  }
  if(a==='details')open('Order #'+r.order_number,orderDetails(r));
  if(a==='order-refresh'){await load();const updated=data.find(o=>String(o.id)===id);if(updated)$('#dialog-body').innerHTML=orderDetails(updated);}
  if(a==='resend'){if(!confirm('Send the PDF to this customer again?'))return;await send('/orders/'+id+'/'+a,{});await load();if(a==='resend'&&$('#admin-dialog').open){const updated=data.find(o=>String(o.id)===id);if(updated){$('#dialog-body').innerHTML=orderDetails(updated);$('#dialog-message').textContent='Email accepted for delivery.';}}message('Email accepted for delivery.');}
  if(a==='customer-access'){if(!confirm(r.is_active?'Suspend this account and sign out its sessions?':'Restore this customer account?'))return;await send('/customers/'+id+'/access',{active:!r.is_active},'PUT');await load();message('Customer access updated.');}
  if(a==='customer-orders'){const d=await api('/orders');open('Customer purchases',table(['Order','Book','Status','Total'],d.orders.filter(o=>String(o.user_id)===id).map(o=>['#'+o.order_number,escape(o.title),escape(o.status),money(o.amount_paise)])));}
  if(a==='revoke'){if(!confirm('Revoke admin access for '+id+' immediately?'))return;await api('/team/'+encodeURIComponent(id),{method:'DELETE'});await load();}
  if(a==='invite'){await send('/team/'+encodeURIComponent(id)+'/invite',{});message('Invitation email sent.');}
  if(a==='export'){const cell=v=>'"'+String(v??'').replace(/^[=+@-]/,"'$&").replace(/"/g,'""')+'"';const rows=[['Order','Date','Customer','Product','Status','Payment method','Amount INR'],...selectedRows().map(o=>[o.order_number,o.created_at,o.email,o.title,o.status,o.payment_method,(o.amount_paise/100).toFixed(2)])];const blob=new Blob(['\uFEFF'+rows.map(row=>row.map(cell).join(',')).join('\r\n')],{type:'text/csv;charset=utf-8'});const url=URL.createObjectURL(blob),link=document.createElement('a');link.href=url;link.download='orders.csv';link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
 }catch(error){if($('#admin-dialog').open)$('#dialog-message').textContent=error.message;else message(error.message,'error');}finally{b.disabled=false;}
});
function setMenu(open){
 const sidebar=$('#admin-sidebar'),mobile=matchMedia('(max-width: 1000px)').matches,restoreFocus=mobile&&!open&&sidebar.contains(document.activeElement);
 sidebar.classList.toggle('open',open&&mobile);$('#sidebar-backdrop').hidden=!(open&&mobile);$('#open-menu').setAttribute('aria-expanded',String(open&&mobile));document.body.classList.toggle('menu-open',open&&mobile);$('#admin-main').inert=open&&mobile;sidebar.inert=mobile&&!open;
 if(open&&mobile)$('#close-menu').focus();else if(restoreFocus)$('#open-menu').focus();
}
$('#open-menu').onclick=()=>setMenu(true);$('#close-menu').onclick=()=>{setMenu(false);$('#open-menu').focus();};$('#sidebar-backdrop').onclick=()=>{setMenu(false);$('#open-menu').focus();};
$('#close-dialog').onclick=()=>$('#admin-dialog').close();$('#admin-dialog').addEventListener('close',()=>document.body.classList.remove('dialog-open'));
$('#admin-dialog').addEventListener('click',e=>{if(e.target===$('#admin-dialog')){const r=e.target.getBoundingClientRect();if(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom)e.target.close();}});
addEventListener('resize',()=>setMenu(false));
document.addEventListener('keydown',e=>{if(!$('#admin-sidebar').classList.contains('open'))return;if(e.key==='Escape'){setMenu(false);$('#open-menu').focus();}if(e.key==='Tab'){const focusable=Array.from($('#admin-sidebar').querySelectorAll('a,button')).filter(el=>el.offsetParent!==null),first=focusable[0],last=focusable[focusable.length-1];if(e.shiftKey&&document.activeElement===first){e.preventDefault();last.focus();}else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first.focus();}}});
setMenu(false);
$('#admin-logout').onclick=async()=>{try{const r=await fetch('/api/auth/logout',{method:'POST',credentials:'same-origin'});if(!r.ok)throw Error('Sign out failed.');location.href='/signin/';}catch(e){message(e.message,'error');}};
try{me=await api('/me');csrf=me.csrf;$('#admin-role').textContent=me.isOwner?'Store owner':'Administrator';$('#admin-identity').textContent=me.email||'Verified account';$('.account-avatar').textContent=(me.email||'A').slice(0,2).toUpperCase();$('#team-link').hidden=!me.isOwner;addEventListener('hashchange',load);await load();}catch(e){message(e.message,'error');}
})();
