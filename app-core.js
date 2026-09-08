/* COA Employee Portal — app-core.js
   Session/auth REST calls, shared data REST calls, session storage, logout,
   isAdmin, shared utils, and the screen router. Loaded first, before any
   screen-*.js file. Screen files depend on globals defined here
   (getSession, dbRequest, dbWrite, dbRpc, isAdmin, formatDate, getInitials,
   getRecursiveReportIds*, switchScreen). */

  var SUPABASE_URL = 'https://llkatqqkzjzqfaosmrjl.supabase.co';
  var SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imxsa2F0cXFremp6cWZhb3NtcmpsIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODIyNDQ4MzQsImV4cCI6MjA5NzgyMDgzNH0.PA0uYmHZrfQB399jXr7LEUH0aU2CniFSkmFfZPy-dTs';

  // ---------- Low-level auth REST calls (no SDK, matches no-framework stack rule) ----------
  async function authRequest(path, body){
    var res = await fetch(SUPABASE_URL + '/auth/v1/' + path, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'apikey': SUPABASE_ANON_KEY
      },
      body: JSON.stringify(body)
    });
    var data = await res.json();
    if(!res.ok){
      throw new Error(data.error_description || data.msg || 'Authentication failed');
    }
    return data;
  }

  // Session persistence + 15-minute idle auto-logout for the Supabase POC.
  // Demo-only stand-in — Entra ID Gov will replace this whole auth flow, so
  // this deliberately doesn't implement refresh-token rotation, just enough
  // to (a) survive a page refresh without re-login as long as the existing
  // token is still good and the user hasn't been idle too long, and (b) log
  // out automatically after 15 minutes of no activity.
  var IDLE_TIMEOUT_MS = 15 * 60 * 1000;
  var idleLogoutTimer = null;
  var lastActivityPersistedAt = 0;

  function saveSession(session){
    session._savedAt = Date.now();
    sessionStorage.setItem('coa_session', JSON.stringify(session));
  }
  function getSession(){
    var raw = sessionStorage.getItem('coa_session');
    return raw ? JSON.parse(raw) : null;
  }
  // Broadened from two removeItem calls to a full clear so this also wipes
  // MSAL's own cached account/tokens on the Aeris track (its cacheLocation
  // is sessionStorage too, per the locked auth decision — see
  // AERIS_MSAL_CONFIG below). Without this, logging out (including the
  // 15-minute idle auto-logout) would leave MSAL's cache intact and
  // aerisTryRestoreSession() would silently sign the user back in on the
  // next page load. Confirmed nothing else in the app reads/writes
  // sessionStorage (grepped every screen-*.js file), so this is safe to
  // broaden for the Supabase demo too — behavior there is unchanged since
  // 'coa_session'/'coa_last_activity' were the only keys it ever used.
  function clearSession(){
    sessionStorage.clear();
  }

  // The token response's own expires_in is trusted over any absolute
  // expires_at field, since _savedAt is our own clock and avoids any
  // ambiguity about what timezone/units the API's expires_at is in.
  function sessionTokenExpired(session){
    if(!session){ return true; }
    var expiresAt = (session._savedAt || 0) + ((session.expires_in || 3600) * 1000);
    return Date.now() >= expiresAt;
  }

  function sessionIdleExpired(){
    var last = Number(sessionStorage.getItem('coa_last_activity') || 0);
    if(!last){ return false; } // no activity recorded yet — freshly logged in
    return (Date.now() - last) > IDLE_TIMEOUT_MS;
  }

  function recordActivity(){
    var now = Date.now();
    lastActivityPersistedAt = now;
    sessionStorage.setItem('coa_last_activity', String(now));
  }

  function resetIdleLogoutTimer(){
    clearTimeout(idleLogoutTimer);
    idleLogoutTimer = setTimeout(function(){ handleLogout('idle'); }, IDLE_TIMEOUT_MS);
  }

  // Throttled so mousemove/scroll don't hammer sessionStorage — the timer
  // itself still resets on every event, only the persisted timestamp (used
  // to survive a refresh) is capped to once per 5s.
  function handleUserActivity(){
    if(!getSession()){ return; }
    resetIdleLogoutTimer();
    if(Date.now() - lastActivityPersistedAt > 5000){ recordActivity(); }
  }

  ['click', 'keydown', 'mousemove', 'scroll', 'touchstart'].forEach(function(evt){
    window.addEventListener(evt, handleUserActivity, { passive: true });
  });

  // Runs on every page load. Restores the signed-in view without a fresh
  // login only if there's a session, its token hasn't expired, and the user
  // wasn't idle past the timeout when the page was last open.
  function tryRestoreSession(){
    if(isAerisEnv()){ aerisTryRestoreSession(); return; }
    var session = getSession();
    if(!session || !session.user){ return; }
    if(sessionTokenExpired(session) || sessionIdleExpired()){
      clearSession();
      return;
    }
    recordActivity();
    resetIdleLogoutTimer();
    showApp(session.user.email);
  }

  function handleLogout(reason){
    clearTimeout(idleLogoutTimer);
    clearSession();
    document.getElementById('app-shell').classList.remove('active');
    document.getElementById('login-wrap').style.display = 'flex';
    document.getElementById('login-email').value = '';
    document.getElementById('login-password').value = '';
    var errorEl = document.getElementById('login-error');
    if(errorEl){ errorEl.textContent = reason === 'idle' ? 'Signed out after 15 minutes of inactivity.' : ''; }
  }

  // ---------- Data REST calls (read-only, table access via PostgREST) ----------
  async function dbRequest(path){
    var session = getSession();
    var res = await fetch(SUPABASE_URL + '/rest/v1/' + path, {
      headers: {
        'apikey': SUPABASE_ANON_KEY,
        'Authorization': 'Bearer ' + (session ? session.access_token : SUPABASE_ANON_KEY)
      }
    });
    if(!res.ok){
      throw new Error('Request failed: ' + res.status);
    }
    return res.json();
  }

  function getInitials(name){
    if(!name) return '?';
    var parts = name.trim().split(' ');
    return (parts[0][0] + (parts.length > 1 ? parts[parts.length - 1][0] : '')).toUpperCase();
  }

  // Shared avatar renderer — img when a profile has photo_url, initials
  // circle fallback otherwise. Used anywhere an employee's photo appears
  // (dashboard, directory roster, org chart, profile overview) so photo_url
  // support doesn't have to be reimplemented per screen.
  function avatarHtml(photoUrl, name, initialsClass, imgClass){
    if(photoUrl){
      return '<img src="' + escAttr(photoUrl) + '" class="' + imgClass + '" alt="">';
    }
    return '<div class="' + initialsClass + '">' + getInitials(name) + '</div>';
  }

  // Plain YYYY-MM-DD strings (every date-only column in this app) must be
  // parsed as local calendar components, not UTC midnight — `new Date(d)`
  // on a date-only string parses as UTC, so anyone west of UTC sees every
  // date rendered one day early once .toLocaleDateString() converts back
  // to local time. Timestamps (with a time component) fall through to the
  // original parsing, which is correct for those.
  function formatDate(d){
    if(!d) return '—';
    var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(d));
    var dt = m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : new Date(d);
    return dt.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  }

  // Shared HTML-attribute escaper — used by screen-profile.js (resume fields)
  // and screen-travel.js (flight/hotel/car form fields). Kept here since it's
  // a generic util, not owned by any one screen.
  function escAttr(v){
    return (v == null ? '' : String(v)).replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  }

  // Applies the Dark/Light Appearance preference (profiles.theme_preference)
  // by toggling data-theme on <html> — styles.css keys its [data-theme="light"]
  // token overrides off this attribute. Also caches the choice in localStorage
  // so index.html's inline head script can apply it before first paint on the
  // next load, avoiding a flash of the wrong theme. Called from
  // screen-profile.js: loadProfile() (on login/profile load) and
  // setThemePreference() (on toggle click).
  function applyTheme(pref){
    var isLight = pref === 'light';
    document.documentElement.setAttribute('data-theme', isLight ? 'light' : 'dark');
    try{ localStorage.setItem('coa_theme', isLight ? 'light' : 'dark'); }catch(e){ /* private mode, etc. */ }
  }

  var pendingNavTarget = null; // used by the unsaved-changes guard below

  // NOTE: isAdmin() reads currentProfile, which is declared and populated in
  // screen-profile.js (loadProfile()). This is safe at call time because all
  // screen scripts finish loading before any user interaction fires, but
  // currentProfile is null until loadProfile() has run at least once. Do not
  // gate access-control decisions on isAdmin() before login-time profile load
  // is guaranteed to have completed (see risk flag in patch notes).
  function isAdmin(){
    return currentProfile && currentProfile.role === 'admin';
  }

  // Profile field edit gates — used by renderProfile()/saveProfile() and the
  // Travel Info card in screen-profile.js. This screen is self-edit only
  // (My Profile) — there is no separate "admin edits another employee"
  // screen yet. Job title, start date, employment status, and clearance
  // data are HR/security-managed fields and must stay display-only here
  // even for admins, since editing them here would mean an admin editing
  // their own HR record with no separation of duties (confirmed with user
  // 2026-08-07, see ssp-log.md AC-3 entry). Only re-add them once a
  // proper admin-edits-other-employee screen exists.
  var employeeEditableFields = ['preferred_name', 'phone', 'home_email', 'home_phone', 'known_traveler_number', 'bio'];
  // 'department' is intentionally excluded here — profiles has no such
  // column (only department_id, a departments FK, and a deprecated
  // department_legacy_text). Including it made saveProfile()'s PATCH fail
  // for every field whenever an admin edited a profile, since PostgREST
  // rejects the whole request for one unknown column. Department is
  // display-only on this card until a proper department_id picker exists.
  var adminEditableFields = employeeEditableFields.concat(['full_name', 'location']);

  // Returns all direct + indirect report IDs for userId, regardless of role.
  // Manager-ness is derived from manager_id chains, not from the role column.
  // Pulls id+manager_id for the whole org once (cheap at this headcount) and
  // walks the tree in JS rather than issuing a recursive SQL CTE.
  var allProfilesCache = null;
  async function getRecursiveReportIds(userId){
    if(!allProfilesCache){
      allProfilesCache = await dbRequest('profiles?select=id,manager_id');
    }
    var byManager = {};
    allProfilesCache.forEach(function(p){
      if(!p.manager_id){ return; }
      if(!byManager[p.manager_id]){ byManager[p.manager_id] = []; }
      byManager[p.manager_id].push(p.id);
    });
    var result = [];
    var queue = (byManager[userId] || []).slice();
    while(queue.length){
      var id = queue.shift();
      if(result.indexOf(id) !== -1){ continue; }
      result.push(id);
      if(byManager[id]){ queue = queue.concat(byManager[id]); }
    }
    return result;
  }

  // Same traversal as getRecursiveReportIds, but returns full profile rows
  // (id, full_name, department_id) for call sites that render employee info,
  // not just ids.
  async function getRecursiveReportIdsAsRows(userId){
    var ids = await getRecursiveReportIds(userId);
    if(!ids.length){ return []; }
    return dbRequest('profiles?id=in.(' + ids.join(',') + ')&select=id,full_name,department_id');
  }

  // ---------- Generic data write / RPC calls (shared by every screen) ----------
  async function dbWrite(path, method, body){
    var session = getSession();
    var res = await fetch(SUPABASE_URL + '/rest/v1/' + path, {
      method: method,
      headers: {
        'apikey': SUPABASE_ANON_KEY,
        'Authorization': 'Bearer ' + (session ? session.access_token : SUPABASE_ANON_KEY),
        'Content-Type': 'application/json',
        'Prefer': 'return=minimal'
      },
      body: JSON.stringify(body)
    });
    if(!res.ok){
      throw new Error('Request failed: ' + res.status);
    }
  }

  async function dbRpc(fnName, params){
    var session = getSession();
    var res = await fetch(SUPABASE_URL + '/rest/v1/rpc/' + fnName, {
      method: 'POST',
      headers: {
        'apikey': SUPABASE_ANON_KEY,
        'Authorization': 'Bearer ' + (session ? session.access_token : SUPABASE_ANON_KEY),
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(params)
    });
    if(!res.ok){
      var data = null;
      try{ data = await res.json(); }catch(e){}
      throw new Error((data && data.message) || ('RPC failed: ' + res.status));
    }
  }

  // Calls a Supabase Edge Function (as opposed to a PostgREST table/rpc
  // route) — used by screen-staffrecall.js. The function itself is the
  // real authorization boundary (checks the caller's role server-side);
  // this just forwards the caller's token the same way dbRequest/dbWrite do.
  async function dbFunction(name, body){
    var session = getSession();
    var res = await fetch(SUPABASE_URL + '/functions/v1/' + name, {
      method: 'POST',
      headers: {
        'apikey': SUPABASE_ANON_KEY,
        'Authorization': 'Bearer ' + (session ? session.access_token : SUPABASE_ANON_KEY),
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(body)
    });
    var data = null;
    try{ data = await res.json(); }catch(e){ /* non-JSON response */ }
    if(!res.ok){
      throw new Error((data && data.error) || ('Request failed: ' + res.status));
    }
    return data;
  }

  // ---------- Unsaved changes guard ----------
  function requestSwitchScreen(name){
    if(isEditingProfile || isEditingResume){
      pendingNavTarget = name;
      document.getElementById('unsaved-modal').classList.add('active');
      return;
    }
    switchScreen(name);
  }

  function closeUnsavedModal(){
    document.getElementById('unsaved-modal').classList.remove('active');
    pendingNavTarget = null;
  }

  function confirmDiscard(){
    var wasEditingProfile = isEditingProfile;
    var wasEditingResume = isEditingResume;
    isEditingProfile = false;
    isEditingResume = false;
    document.getElementById('unsaved-modal').classList.remove('active');
    var target = pendingNavTarget;
    pendingNavTarget = null;
    if(!target){ return; }
    if(typeof target === 'function'){ target(); return; }
    switchScreen(target);
    if(target === 'profile'){ loadProfile(); }
    else if(wasEditingProfile){ renderProfile(currentProfile, currentSupervisorName, false); }
    if(target !== 'resume' && wasEditingResume){ renderResume(currentResume, currentResumeOwner, false); }
  }

  window.addEventListener('beforeunload', function(e){
    if(isEditingProfile || isEditingResume){
      e.preventDefault();
      e.returnValue = '';
    }
  });

  // ---------- Generic dynamic modal (content injected per use — see
  //            #dynamic-modal in index.html) ----------
  function showDynamicModal(innerHtml){
    var el = document.getElementById('dynamic-modal');
    el.innerHTML = '<div class="modal-box">' + innerHtml + '</div>';
    el.classList.add('active');
  }

  function closeDynamicModal(){
    var el = document.getElementById('dynamic-modal');
    el.classList.remove('active');
    el.innerHTML = '';
  }

  function showApp(email){
    document.getElementById('login-wrap').style.display = 'none';
    document.getElementById('app-shell').classList.add('active');
    document.getElementById('user-email-display').textContent = email;
    loadProfile();
    loadDashboard();
    checkMyTeamNavVisibility();
    checkAdminNavVisibility();
  }

  async function checkMyTeamNavVisibility(){
    var session = getSession();
    if(!session || !session.user){ return; }
    var btn = document.getElementById('nav-btn-myteam');
    try{
      var ids = await getRecursiveReportIds(session.user.id);
      btn.style.display = ids.length ? '' : 'none';
    }catch(e){
      console.error(e);
      btn.style.display = 'none';
    }
  }

  // Gates the Admin nav tab (and the Directory > Staff Recall subtab, same
  // role check, same round trip). Queries role directly rather than relying
  // on currentProfile/isAdmin(), because currentProfile isn't populated
  // until loadProfile() (screen-profile.js) runs, which only happens if/when
  // the user visits the Profile screen — not guaranteed at login time. Fixes
  // a prior gap where the Admin tab was visible to every signed-in user
  // regardless of role.
  async function checkAdminNavVisibility(){
    var session = getSession();
    if(!session || !session.user){ return; }
    var btn = document.getElementById('nav-btn-admin');
    var staffRecallBtn = document.getElementById('dir-staffrecall-btn');
    var burndownBtn = document.getElementById('nav-btn-burndown');
    try{
      var rows = await dbRequest('profiles?id=eq.' + session.user.id + '&select=role');
      var isAdminRole = rows.length && rows[0].role === 'admin';
      btn.style.display = isAdminRole ? '' : 'none';
      if(staffRecallBtn){ staffRecallBtn.style.display = isAdminRole ? '' : 'none'; }
      if(burndownBtn){ burndownBtn.style.display = isAdminRole ? '' : 'none'; }
    }catch(e){
      console.error(e);
      btn.style.display = 'none';
      if(staffRecallBtn){ staffRecallBtn.style.display = 'none'; }
      if(burndownBtn){ burndownBtn.style.display = 'none'; }
    }
  }

  function switchScreen(name){
    document.querySelectorAll('.nav-btn').forEach(function(b){ b.classList.toggle('active', b.dataset.screen === name); });
    document.querySelectorAll('.screen').forEach(function(s){ s.classList.remove('active'); });
    document.getElementById('screen-' + name).classList.add('active');
    if(name === 'home'){
      loadDashboard();
    }
    if(name === 'profile'){
      switchProfileSubtab('overview');
    }
    if(name === 'timekeeping'){
      switchTkSubtab('current');
    }
    if(name === 'directory'){
      switchDirectorySubtab('roster');
    }
    if(name === 'admin'){
      switchAdminSubtab('dashboard');
    }
    if(name === 'myteam'){
      switchMyTeamSubtab('dashboard');
    }
    if(name === 'travel'){
      switchTravelSubtab('estimate');
    }
    if(name === 'burndown'){
      switchBurndownSubtab('customers');
    }
    // Timekeeping Simulation Mode's banner/wizard only show on
    // Timekeeping-related screens — re-evaluate visibility on every
    // screen switch (screen-timekeeping.js; no-op when sim mode is off).
    if(typeof tkRenderSimBanner === 'function'){ tkRenderSimBanner(); }
    if(typeof tkRenderSimWizard === 'function'){ tkRenderSimWizard(); }
  }

  // ---------- Aeris/Entra ID auth (MSAL.js) ----------
  // Wired login/session/logout for the parallel Azure migration track
  // ("Aeris"). Gated entirely behind isAerisEnv() so the live Supabase demo
  // on Vercel is untouched — both deploy from this same main branch, so the
  // app has to pick its auth flow at runtime rather than at deploy time.
  //
  // MSAL.js is NOT loaded via a <script> tag in index.html (would add an
  // external network request to every page load, including the Supabase
  // demo, for a library it never uses). Instead loadMsalScript() injects it
  // dynamically, only when isAerisEnv() is true. Microsoft deprecated its
  // own CDN for msal-browser v3+ (confirmed 2026-09-08 — recommends
  // npm/bundler only), so this loads the same published package from
  // jsDelivr instead; the version is pinned and should be bumped
  // deliberately, not silently, since an auth library is not a safe place
  // for an unpinned "latest" import.
  //
  // Auth implementation decisions locked 2026-08-28 (see memory:
  // coa_aeris_migration_track.md):
  //   - Role claim: Entra App Roles, claim name "roles"
  //   - Token storage: sessionStorage (MSAL's cacheLocation option, same
  //     pattern as the Supabase session above — see clearSession()'s
  //     comment for why logout now clears all of sessionStorage)
  //   - Silent renewal: MSAL's built-in acquireTokenSilent
  //
  // Deliberately NOT done in this pass (needs the Functions/Postgres data
  // layer from Step 15+, not just auth): dbRequest/dbWrite/dbRpc/dbFunction
  // still point at Supabase regardless of environment, and isAdmin()/
  // checkAdminNavVisibility() still read currentProfile from a Supabase
  // fetch. So on Aeris today, login/logout/session-restore work end to end,
  // but every data screen will fail to load until the Functions API exists.
  // That's expected at this stage, not a bug — see ssp-log.md.
  function isAerisEnv(){
    var h = window.location.hostname;
    return h.indexOf('azurestaticapps.net') !== -1 || h.indexOf('cyberoffset.com') !== -1;
  }

  // redirectUri points at a dedicated static page (auth-popup.html), NOT
  // this app's own root — found live 2026-09-08 that using the app's own
  // URL made the popup re-render the full login screen instead of
  // self-closing, since it had to dynamically fetch MSAL.js itself before
  // MSAL's popup-completion handshake could run, racing against the
  // opener's detection. See auth-popup.html's own comment and ssp-log.md
  // for the full symptom/fix. This exact URL must be registered as a
  // Redirect URI under the SPA platform in the App Registration.
  //
  // popupRelayUri is a SEPARATE required option from redirectUri for
  // msal-browser's BroadcastChannel-based popup relay (v3+) — without it,
  // loginPopup() doesn't know auth-popup.html is a valid relay page and
  // the relay script itself rejects with popup_relay_unsupported_flow.
  // Same URL as redirectUri here since we only have the one dedicated page.
  var AERIS_AUTH_POPUP_URI = window.location.origin + '/auth-popup.html';
  var AERIS_MSAL_CONFIG = {
    auth: {
      clientId: '7de6fb71-68ef-410a-84e0-6847fd06cd47',
      authority: 'https://login.microsoftonline.com/a33e7419-7258-4616-a95a-ad8450531e8f',
      redirectUri: AERIS_AUTH_POPUP_URI,
      popupRelayUri: AERIS_AUTH_POPUP_URI
    },
    cache: {
      cacheLocation: 'sessionStorage',
      storeAuthStateInCookie: false
    }
  };
  var AERIS_MSAL_CDN_URL = 'https://cdn.jsdelivr.net/npm/@azure/msal-browser@5.21.0/lib/msal-browser.min.js';

  // Scope for OUR OWN Functions API, not Microsoft Graph — 'User.Read'
  // (what the earlier scaffold requested) gets a token audienced for Graph,
  // which the Functions API would always reject as a wrong audience. This
  // requires the "COA - Aeris" App Registration to expose an API with a
  // scope named access_as_user (Expose an API blade — Azure default App ID
  // URI is api://<client-id> unless a custom one was set) — Azure-side
  // config Sly Penguin/Ricky need to do; not something settable from code.
  // functions/Program.cs's EntraAuthMiddleware validates tokens against
  // this same scope's audience — keep both sides in sync if this changes.
  var AERIS_API_SCOPE = 'api://7de6fb71-68ef-410a-84e0-6847fd06cd47/access_as_user';

  var aerisMsalClient = null;
  var aerisMsalScriptPromise = null;
  var aerisMsalInitPromise = null;

  function loadMsalScript(){
    if(typeof msal !== 'undefined'){ return Promise.resolve(); }
    if(aerisMsalScriptPromise){ return aerisMsalScriptPromise; }
    aerisMsalScriptPromise = new Promise(function(resolve, reject){
      var s = document.createElement('script');
      s.src = AERIS_MSAL_CDN_URL;
      s.onload = function(){ resolve(); };
      s.onerror = function(){ reject(new Error('Failed to load MSAL.js from CDN')); };
      document.head.appendChild(s);
    });
    return aerisMsalScriptPromise;
  }

  // MSAL browser v3+ requires an async initialize() call before any other
  // API is used (this was a breaking change from the v2 line, where the
  // constructor alone was enough) — cached behind a promise so concurrent
  // callers (e.g. a login click racing the page-load silent-restore check)
  // share one client/init instead of racing two.
  function getMsalClient(){
    if(aerisMsalClient){ return Promise.resolve(aerisMsalClient); }
    if(!aerisMsalInitPromise){
      aerisMsalInitPromise = loadMsalScript().then(function(){
        var client = new msal.PublicClientApplication(AERIS_MSAL_CONFIG);
        return client.initialize().then(function(){
          aerisMsalClient = client;
          return client;
        });
      });
    }
    return aerisMsalInitPromise;
  }

  function normalizeAerisSession(result){
    var account = result.account;
    var expiresInSec = Math.max(0, Math.round((result.expiresOn.getTime() - Date.now()) / 1000));
    return {
      user: { id: account.homeAccountId, email: account.username },
      access_token: result.accessToken,
      expires_in: expiresInSec,
      _aerisAccount: account
    };
  }

  // Interactive login — popup flow. Returns a session object already in the
  // same shape saveSession()/getSession() use for the Supabase path, so the
  // caller (screen-auth.js handleAerisLogin()) can reuse saveSession()/
  // showApp() unchanged.
  async function aerisLogin(){
    var client = await getMsalClient();
    var result = await client.loginPopup({ scopes: [AERIS_API_SCOPE] });
    return normalizeAerisSession(result);
  }

  // allowPopupFallback is false for the page-load silent-restore path
  // (aerisTryRestoreSession) — popping an interactive window without a user
  // gesture is bad UX and most browsers block it anyway. It's true only for
  // an explicit login click that hits an expired silent token.
  async function aerisAcquireTokenSilent(account, allowPopupFallback){
    var client = await getMsalClient();
    var request = { scopes: [AERIS_API_SCOPE], account: account };
    try{
      return await client.acquireTokenSilent(request);
    }catch(e){
      if(!allowPopupFallback){ throw e; }
      return client.acquireTokenPopup(request);
    }
  }

  // Aeris counterpart to tryRestoreSession() — checks MSAL's own cache
  // (getAllAccounts()) instead of the Supabase-shaped coa_session check,
  // since MSAL manages its own token expiry internally. Fails quietly to
  // the login screen on any error, matching tryRestoreSession()'s existing
  // behavior for an expired Supabase session.
  async function aerisTryRestoreSession(){
    try{
      var client = await getMsalClient();
      var accounts = client.getAllAccounts();
      if(!accounts.length){ return; }
      var result = await aerisAcquireTokenSilent(accounts[0], false);
      var session = normalizeAerisSession(result);
      saveSession(session);
      recordActivity();
      resetIdleLogoutTimer();
      showApp(session.user.email);
    }catch(e){
      console.error('Aeris silent session restore failed', e);
    }
  }

  // Reads the "roles" App Role claim off the MSAL account's ID token. Not
  // yet wired into isAdmin()/checkAdminNavVisibility() — those still read
  // currentProfile from a Supabase fetch, which won't work in the Aeris env
  // until the Functions/Postgres data layer exists (Step 15+). Kept here,
  // ready to be wired in at that point.
  function aerisIsAdmin(account){
    if(!account || !account.idTokenClaims || !account.idTokenClaims.roles){ return false; }
    return account.idTokenClaims.roles.indexOf('Admin') !== -1;
  }

  document.addEventListener('DOMContentLoaded', tryRestoreSession);
