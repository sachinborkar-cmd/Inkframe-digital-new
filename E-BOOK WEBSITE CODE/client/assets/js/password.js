(function(){
'use strict';
const message=document.getElementById('password-message');
const login=document.getElementById('password-login'),request=document.getElementById('reset-request'),verify=document.getElementById('reset-verify'),finish=document.getElementById('reset-finish');
let email='';
if(request&&new URLSearchParams(location.search).get('from')==='library'){const back=document.querySelector('a[href="/signin/"]');if(back){back.href='/library/#profile';back.textContent='Back to my profile';}}
function bind(form,path,payload,done){if(!form)return;form.addEventListener('submit',async e=>{e.preventDefault();if(!form.reportValidity())return;const button=form.querySelector('[type=submit]');if(button.disabled)return;button.disabled=true;message.textContent='Please wait...';try{const body=payload(form);const r=await fetch('/api/auth/'+path,{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});const data=await r.json();if(!r.ok)throw Error(data.error||'Please try again.');done(data);}catch(error){message.textContent=error.message;}finally{button.disabled=false;}});}
bind(login,'login',f=>({email:f.elements.email.value,password:f.elements.password.value}),()=>{const next=new URLSearchParams(location.search).get('next');const url=new URL(next||'/library/',location.origin);location.href=url.origin===location.origin?url.pathname+url.search:'/library/';});
bind(request,'forgot-password',f=>{email=f.elements.email.value.trim();return {email};},data=>{message.textContent=data.message;request.hidden=true;verify.hidden=false;verify.elements.otp.focus();});
bind(verify,'verify-reset-otp',f=>({email,otp:f.elements.otp.value}),data=>{message.textContent=data.message;verify.hidden=true;finish.hidden=false;finish.elements.password.focus();});
bind(finish,'reset-password',f=>{if(f.elements.password.value!==f.elements.confirmation.value)throw Error('Passwords do not match.');return {password:f.elements.password.value};},()=>{location.href='/signin/?password=reset';});
const resend=document.getElementById('reset-resend');if(resend)resend.onclick=()=>{verify.hidden=true;request.hidden=false;message.textContent='Wait at least 60 seconds before requesting another code.';};
if(login&&new URLSearchParams(location.search).get('password')==='reset'){message.textContent='Password saved. Sign in with your new password.';const panel=login.closest('details');if(panel)panel.open=true;}
})();
