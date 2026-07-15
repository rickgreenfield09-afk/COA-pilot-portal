/* COA Employee Portal — screen-auth.js
   Login screen only. Session storage, logout, and the low-level Entra ID
   Gov auth REST call (authRequest) live in app-core.js since logout/session
   are shared shell concerns, not login-screen-specific. */

  async function handleLogin(){
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
      showApp(data.user.email);
    }catch(e){
      errorEl.textContent = 'Incorrect email or password.';
    }finally{
      btn.disabled = false;
      btn.textContent = 'Sign In';
    }
  }


