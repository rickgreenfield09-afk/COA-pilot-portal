/* COA Employee Portal — screen-auth.js
   Login screen only. Session storage, logout, and the low-level auth REST/
   MSAL calls (authRequest, aerisLogin) live in app-core.js since logout/
   session are shared shell concerns, not login-screen-specific.

   handleLogin() branches on isAerisEnv() (app-core.js): the Azure Static
   Web App / aeris.cyberoffset.com deploy uses MSAL (handleAerisLogin), the
   Vercel demo keeps using Supabase email/password unchanged. Both deploy
   from this same main branch, so this has to be a runtime check, not a
   build-time one. */

  async function handleLogin(){
    if(isAerisEnv()){ return handleAerisLogin(); }

    var email = document.getElementById('login-email').value.trim();
    var password = document.getElementById('login-password').value;
    var errorEl = document.getElementById('login-error');
    var btn = document.getElementById('login-btn');
    errorEl.textContent = '';

    if(!email || !password){
      errorEl.textContent = 'Enter your email and password.';
      return;
    }

    btn.disabled = true;
    btn.textContent = 'Signing in...';

    try{
      var data = await authRequest('token?grant_type=password', { email: email, password: password });
      saveSession(data);
      recordActivity();
      resetIdleLogoutTimer();
      showApp(data.user.email);
    }catch(e){
      errorEl.textContent = 'Incorrect email or password.';
    }finally{
      btn.disabled = false;
      btn.textContent = 'Sign In';
    }
  }

  // Entra/MSAL login for the Aeris track. Note the email/password fields on
  // the login card are ignored here — MSAL drives its own full-page
  // redirect instead. Leaving those fields visible-but-unused on this
  // deploy is a known cosmetic gap, not fixed in this pass since it's a
  // login-form UX question, not part of finishing the auth wiring itself
  // (see ssp-log.md).
  async function handleAerisLogin(){
    var errorEl = document.getElementById('login-error');
    var btn = document.getElementById('login-btn');
    errorEl.textContent = '';
    btn.disabled = true;
    btn.textContent = 'Signing in...';

    try{
      await aerisLoginRedirect();
      // The tab navigates away here on success — nothing below normally
      // runs. The return trip is handled by aerisTryRestoreSession() on
      // the next page load (app-core.js), not here.
    }catch(e){
      // Logged verbosely (not just the bare Error object) since MSAL's
      // BrowserAuthError carries diagnostic detail (errorCode, subError,
      // correlationId) that the console's default Error rendering doesn't
      // always surface without manually expanding the stack trace.
      console.error('Aeris login failed:', {
        name: e && e.name,
        errorCode: e && e.errorCode,
        errorMessage: e && e.errorMessage,
        subError: e && e.subError,
        correlationId: e && e.correlationId,
        message: e && e.message,
        raw: e
      });
      errorEl.textContent = 'Sign-in failed. Please try again.';
    }finally{
      btn.disabled = false;
      btn.textContent = 'Sign In';
    }
  }


