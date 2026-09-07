(function () {
  'use strict';

  function showError(element, message) {
    if (!element) return;
    element.textContent = message;
    element.hidden = !message;
  }

  function setLoading(form, loading) {
    var button = form.querySelector('button[type="submit"]');
    if (!button.dataset.label) button.dataset.label = button.textContent;
    button.disabled = loading;
    button.textContent = loading ? 'Please wait…' : button.dataset.label;
  }

  async function api(path, options) {
    var response = await fetch(path, Object.assign({
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' }
    }, options));
    var body = await response.json().catch(function () { return {}; });
    if (response.status === 401 && document.getElementById('profile-form')) {
      window.location.href='/signin/?next=/library/';
      throw new Error('Your session expired. Please sign in again.');
    }
    if (!response.ok) throw new Error(body.error || 'Request failed. Please try again.');
    return body;
  }

  function destination() {
    var next = new URLSearchParams(window.location.search).get('next');
    if (!next || !next.startsWith('/')) return '/library/';
    try { var url=new URL(next, location.origin); return url.origin===location.origin?url.pathname+url.search+url.hash:'/library/'; } catch (_) { return '/library/'; }
  }

  async function initializeGoogleSignIn() {
    var container = document.getElementById('google-signin-button');
    var message = document.getElementById('google-signin-message');
    if (!container) return;
    try {
      var config = await api('/api/auth/google-config');
      if (!config.enabled) {
        message.textContent = 'Google sign-in is temporarily unavailable. Please use email OTP below.';
        return;
      }
      message.textContent = 'Loading Google sign-in...';
      await new Promise(function(resolve, reject) {
        var started = Date.now();
        function check() {
          if (window.google && window.google.accounts && window.google.accounts.id) return resolve();
          if (Date.now() - started >= 10000) return reject(new Error('Google could not load. Check your connection or browser blockers, then reload. You can also use email OTP.'));
          window.setTimeout(check, 100);
        }
        check();
      });
      container.innerHTML = '';
      google.accounts.id.initialize({
        client_id: config.clientId,
        nonce: config.nonce,
        callback: async function (credentialResponse) {
          message.textContent = 'Verifying your Google account…';
          try {
            await api('/api/auth/google', { method: 'POST', body: JSON.stringify({ credential: credentialResponse.credential }) });
            window.location.href = destination();
          } catch (error) {
            message.textContent = error.message;
          }
        }
      });
      google.accounts.id.renderButton(container, { theme: 'outline', size: 'large', shape: 'pill', text: 'signin_with', width: 320 });
      message.textContent = '';
    } catch (error) {
      message.textContent = error.message;
    }
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', initializeGoogleSignIn);
  else initializeGoogleSignIn();

  var signInForm = document.getElementById('customer-signin-form');
  var otpForm = document.getElementById('customer-otp-form');
  if (signInForm && otpForm) {
    var signInError = document.getElementById('customer-signin-error');
    var otpError = document.getElementById('customer-otp-error');

    signInForm.addEventListener('submit', async function (event) {
      event.preventDefault();
      if (!signInForm.reportValidity()) return;
      setLoading(signInForm, true);
      showError(signInError, '');
      var email = signInForm.elements.email.value.trim().toLowerCase();
      var fullName = signInForm.elements.full_name.value.trim();
      try {
        await api('/api/auth/send-otp', { method: 'POST', body: JSON.stringify({ email: email, full_name: fullName }) });
        sessionStorage.setItem('inkframeOtpEmail', email);
        sessionStorage.setItem('inkframeCustomerName', fullName);
        signInForm.hidden = true;
        otpForm.hidden = false;
        otpForm.elements.otp.focus();
      } catch (error) {
        showError(signInError, error.message);
      } finally {
        setLoading(signInForm, false);
      }
    });

    otpForm.addEventListener('submit', async function (event) {
      event.preventDefault();
      if (!otpForm.reportValidity()) return;
      setLoading(otpForm, true);
      showError(otpError, '');
      try {
        var result = await api('/api/auth/verify-otp', {
          method: 'POST',
          body: JSON.stringify({
            email: sessionStorage.getItem('inkframeOtpEmail'),
            otp: otpForm.elements.otp.value.trim()
          })
        });
        sessionStorage.removeItem('inkframeOtpEmail');
        sessionStorage.removeItem('inkframeCustomerName');
        window.location.href = destination() || result.redirect;
      } catch (error) {
        showError(otpError, error.message);
        setLoading(otpForm, false);
      }
    });
  }

  var confirmForm = document.getElementById('confirm-signup-form');
  if (confirmForm) {
    var rememberedEmail = sessionStorage.getItem('inkframeOtpEmail');
    if (rememberedEmail) confirmForm.elements.email.value = rememberedEmail;
    confirmForm.addEventListener('submit', async function (event) {
      event.preventDefault();
      if (!confirmForm.reportValidity()) return;
      var errorElement = document.getElementById('confirm-signup-error');
      setLoading(confirmForm, true);
      showError(errorElement, '');
      try {
        await api('/api/auth/verify-otp', {
          method: 'POST',
          body: JSON.stringify({
            email: confirmForm.elements.email.value.trim().toLowerCase(),
            otp: confirmForm.elements.token.value.trim()
          })
        });
        sessionStorage.removeItem('inkframeOtpEmail');
        window.location.href = '/library/';
      } catch (error) {
        showError(errorElement, error.message);
        setLoading(confirmForm, false);
      }
    });
  }

  var profileForm = document.getElementById('profile-form');
  if (profileForm) {
    var profileError = document.getElementById('profile-error');
    api('/api/profile').then(function (result) {
      profileForm.elements.email.value = result.profile.email || '';
      profileForm.elements.full_name.value = result.profile.full_name || '';
      profileForm.elements.mobile.value = result.profile.mobile || '';
      document.getElementById('profile-fields').disabled = false;
      document.getElementById('profile-intro').textContent = result.profile.full_name
        ? 'Review or update your customer details.'
        : 'Complete your profile to keep your purchases linked to you.';
    }).catch(function (error) { showError(profileError, error.message); });

    profileForm.addEventListener('submit', async function (event) {
      event.preventDefault();
      if (!profileForm.reportValidity()) return;
      setLoading(profileForm, true);
      showError(profileError, '');
      try {
        await api('/api/profile', {
          method: 'POST',
          body: JSON.stringify({
            full_name: profileForm.elements.full_name.value.trim(),
            mobile: profileForm.elements.mobile.value.trim()
          })
        });
        document.getElementById('profile-intro').textContent = 'Your profile has been saved.';
        showToast('Your profile has been saved.');
      } catch (error) {
        showError(profileError, error.message);
      } finally {
        setLoading(profileForm, false);
      }
    });
  }

  var library = document.getElementById('customer-library');
  if (library) {
    api('/api/library').then(function (result) {
      var empty = document.getElementById('library-empty');
      document.getElementById('library-status').textContent = '';
      renderHistory(result.orders || []);
      if (!result.books.length) {
        empty.hidden = false;
        return;
      }
      result.books.forEach(function (book) {
        var card = document.createElement('div');
        card.className = 'card p-6';
        var title = document.createElement('h3');
        title.className = 'font-semibold';
        title.textContent = book.title;
        var author = document.createElement('p');
        author.className = 'text-sm muted mt-1';
        author.textContent = book.author;
        var actions = document.createElement('div');
        actions.className = 'mt-4 flex gap-2';
        if (book.pdf_path) actions.appendChild(downloadLink(book.pdf_path, 'PDF', 'btn btn-primary flex-1'));
        if (book.epub_path) actions.appendChild(downloadLink(book.epub_path, 'EPUB', 'btn btn-ghost flex-1'));
        card.appendChild(title);
        card.appendChild(author);
        card.appendChild(actions);
        library.appendChild(card);
      });
    }).catch(function (error) { document.getElementById('library-status').textContent = error.message; });
  }

  function renderHistory(orders) {
    var root = document.getElementById('purchase-history');
    if (!orders.length) { root.textContent='You have no previous orders yet.'; return; }
    orders.forEach(function(order) {
      var row=document.createElement('article'); row.className='card p-5';
      var title=document.createElement('h3'); title.className='font-semibold'; title.textContent=order.title;
      var details=document.createElement('p'); details.className='text-sm muted mt-2';
      details.textContent='Order #'+order.id+' | '+new Date(order.created_at).toLocaleDateString('en-IN')+' | INR '+(order.amount_paise/100).toLocaleString('en-IN')+' | '+order.status+(order.payment_method==='test'?' (test payment)':'');
      row.append(title,details);
      if(order.payment_method==='test') row.appendChild(downloadLink('/thank-you/?order='+encodeURIComponent(order.id),'View order','nav-link mt-3'));
      root.appendChild(row);
    });
  }

  function downloadLink(path, label, className) {
    var link = document.createElement('a');
    link.href = path;
    link.className = className;
    link.textContent = label;
    return link;
  }
})();
