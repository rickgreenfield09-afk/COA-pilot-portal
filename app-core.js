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

  function saveSession(session){
    sessionStorage.setItem('coa_session', JSON.stringify(session));
  }
  function getSession(){
    var raw = sessionStorage.getItem('coa_session');
    return raw ? JSON.parse(raw) : null;
  }
  function clearSession(){
    sessionStorage.removeItem('coa_session');
  }

  function handleLogout(){
    clearSession();
    document.getElementById('app-shell').classList.remove('active');
    document.getElementById('login-wrap').style.display = 'flex';
    document.getElementById('login-email').value = '';
    document.getElementById('login-password').value = '';
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
  // Travel Info card in screen-profile.js. Contact info is employee
  // self-service; org placement, HR status, and clearance data are
  // admin-only (confirmed with user 2026-07-16, see ssp-log.md AC-3 entry).
  var employeeEditableFields = ['preferred_name', 'phone', 'home_email', 'home_phone', 'known_traveler_number'];
  var adminEditableFields = employeeEditableFields.concat([
    'full_name', 'job_title', 'department', 'location',
    'start_date', 'employment_status',
    'clearance_level', 'clearance_investigation_type', 'clearance_granted_date', 'clearance_expiration_date'
  ]);

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
    if(!res.ok){ throw new Error('RPC failed: ' + res.status); }
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

  // Gates the Admin nav tab. Queries role directly rather than relying on
  // currentProfile/isAdmin(), because currentProfile isn't populated until
  // loadProfile() (screen-profile.js) runs, which only happens if/when the
  // user visits the Profile screen — not guaranteed at login time. Fixes a
  // prior gap where the Admin tab was visible to every signed-in user
  // regardless of role.
  async function checkAdminNavVisibility(){
    var session = getSession();
    if(!session || !session.user){ return; }
    var btn = document.getElementById('nav-btn-admin');
    try{
      var rows = await dbRequest('profiles?id=eq.' + session.user.id + '&select=role');
      btn.style.display = (rows.length && rows[0].role === 'admin') ? '' : 'none';
    }catch(e){
      console.error(e);
      btn.style.display = 'none';
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
      switchTravelSubtab('request');
    }
  }
