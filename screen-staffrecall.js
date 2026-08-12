/* COA Employee Portal — screen-staffrecall.js
   Directory > Staff Recall (admin-only; the subtab button is hidden/shown
   by app-core.js's checkAdminNavVisibility(), which also gates the Admin
   nav tab off the same role check). Broadcasts an email — work + home
   address — to employees chosen one of three ways: everyone, an exact-match
   region/location gallery, or a hand-picked employee list (kept distinct
   from "region" specifically so the audit trail can show a broadcast was a
   deliberate, individually-logged send rather than a filtered blast).
   Recipient selection happens client-side against a cached profiles list so
   the "who's included" box can update live; the staff-recall Edge Function
   re-derives the same recipient set server-side rather than trusting a list
   from the client, and is the real authorization boundary (admin-only is
   enforced there, not just by this screen being hidden from non-admins).
   Depends on app-core.js: getSession, dbRequest, dbFunction, escAttr,
   formatDate. */

  var staffRecallProfiles = [];
  var staffRecallMode = 'all';
  var staffRecallSelectedLocations = {};
  var staffRecallSelectedEmployeeIds = {};
  var staffRecallDetailLoaded = {};

  async function loadStaffRecallScreen(){
    var container = document.getElementById('staffrecall-content');
    container.innerHTML =
      '<div class="tk-entry-card">'
      + '<div class="tk-section-title">Send Staff Recall</div>'
      + '<div class="placeholder-sub" style="margin-bottom:12px;">Broadcasts an email to every matching employee\'s work and home address, with a link they can click to confirm receipt. Best-effort — there is no guaranteed delivery, especially for staff traveling or without reliable connectivity.</div>'
      + '<div class="subtab-bar" id="sr-mode-bar">'
      + '<button type="button" class="subtab-btn active" data-srmode="all" onclick="setStaffRecallMode(\'all\')">Email All</button>'
      + '<button type="button" class="subtab-btn" data-srmode="region" onclick="setStaffRecallMode(\'region\')">Select Region</button>'
      + '<button type="button" class="subtab-btn" data-srmode="handpick" onclick="setStaffRecallMode(\'handpick\')">Hand-Pick Staff</button>'
      + '</div>'
      + '<div id="sr-mode-ui"></div>'
      + '<div class="sr-recipient-box" id="sr-recipient-box"></div>'
      + '<label class="field-label" for="sr-subject">Subject</label>'
      + '<input class="field-input" id="sr-subject" placeholder="e.g. Hurricane Recall — Report Status">'
      + '<label class="field-label" for="sr-message" style="margin-top:10px;">Message</label>'
      + '<textarea class="field-input" id="sr-message" rows="5" placeholder="What employees need to know and do."></textarea>'
      + '<div style="margin-top:14px;">'
      + '<button type="button" class="btn btn-primary" id="sr-send-btn" style="width:auto;padding:11px 20px;" onclick="sendStaffRecall()">Send Recall</button>'
      + '</div>'
      + '<div class="login-error" id="sr-error"></div>'
      + '</div>'
      + '<div class="tk-entry-card">'
      + '<div class="tk-section-title">Broadcast History</div>'
      + '<div id="sr-history"><div class="tk-empty">Loading...</div></div>'
      + '</div>';

    staffRecallMode = 'all';
    staffRecallSelectedLocations = {};
    staffRecallSelectedEmployeeIds = {};

    try{
      staffRecallProfiles = await dbRequest('profiles?select=id,full_name,location,email,home_email&order=full_name.asc');
    }catch(e){
      console.error(e);
      staffRecallProfiles = [];
    }

    renderStaffRecallModeUI();
    renderStaffRecallRecipientBox();
    loadStaffRecallHistory();
  }

  function setStaffRecallMode(mode){
    staffRecallMode = mode;
    document.querySelectorAll('#sr-mode-bar .subtab-btn').forEach(function(b){
      b.classList.toggle('active', b.dataset.srmode === mode);
    });
    renderStaffRecallModeUI();
    renderStaffRecallRecipientBox();
  }

  function renderStaffRecallModeUI(){
    var el = document.getElementById('sr-mode-ui');
    if(staffRecallMode === 'all'){
      el.innerHTML = '<div class="placeholder-sub" style="margin:10px 0;">Every employee with a work or home email on file will be contacted.</div>';
      return;
    }
    if(staffRecallMode === 'region'){
      var locations = Array.from(new Set(
        staffRecallProfiles.map(function(p){ return (p.location || '').trim(); }).filter(Boolean)
      )).sort();
      el.innerHTML = locations.length
        ? '<div class="sr-chip-gallery">' + locations.map(function(loc){
            var selected = !!staffRecallSelectedLocations[loc];
            var safeLoc = escAttr(loc).replace(/'/g, "\\'");
            return '<button type="button" class="sr-chip' + (selected ? ' selected' : '') + '" aria-pressed="' + selected + '" onclick="toggleStaffRecallLocation(\'' + safeLoc + '\')">' + escAttr(loc) + '</button>';
          }).join('') + '</div>'
        : '<div class="tk-empty">No employees have a location on file yet.</div>';
      return;
    }
    if(staffRecallMode === 'handpick'){
      el.innerHTML =
        '<input type="text" class="field-input" id="sr-employee-filter" placeholder="Filter by name..." oninput="renderStaffRecallEmployeeGallery()" style="margin:10px 0;">'
        + '<div class="sr-employee-gallery" id="sr-employee-gallery"></div>';
      renderStaffRecallEmployeeGallery();
    }
  }

  function renderStaffRecallEmployeeGallery(){
    var galleryEl = document.getElementById('sr-employee-gallery');
    if(!galleryEl){ return; }
    var filterInput = document.getElementById('sr-employee-filter');
    var term = filterInput ? filterInput.value.trim().toLowerCase() : '';
    var matches = term
      ? staffRecallProfiles.filter(function(p){ return (p.full_name || '').toLowerCase().indexOf(term) !== -1; })
      : staffRecallProfiles;
    galleryEl.innerHTML = matches.length
      ? matches.map(function(p){
          var checked = !!staffRecallSelectedEmployeeIds[p.id];
          return '<label class="sr-employee-row' + (checked ? ' selected' : '') + '" for="sr-emp-' + p.id + '">'
            + '<input type="checkbox" id="sr-emp-' + p.id + '" onchange="toggleStaffRecallEmployee(\'' + p.id + '\')" ' + (checked ? 'checked' : '') + '>'
            + '<span>' + escAttr(p.full_name || 'Unknown') + (p.location ? ' &middot; ' + escAttr(p.location) : '') + '</span>'
            + '</label>';
        }).join('')
      : '<div class="tk-empty">No employees match.</div>';
  }

  function toggleStaffRecallLocation(loc){
    if(staffRecallSelectedLocations[loc]){ delete staffRecallSelectedLocations[loc]; }
    else{ staffRecallSelectedLocations[loc] = true; }
    renderStaffRecallModeUI();
    renderStaffRecallRecipientBox();
  }

  // Toggles the row's highlight directly rather than re-rendering the whole
  // gallery, so the name filter's scroll position/focus survive a click.
  function toggleStaffRecallEmployee(id){
    if(staffRecallSelectedEmployeeIds[id]){ delete staffRecallSelectedEmployeeIds[id]; }
    else{ staffRecallSelectedEmployeeIds[id] = true; }
    var checkbox = document.getElementById('sr-emp-' + id);
    var row = checkbox ? checkbox.closest('.sr-employee-row') : null;
    if(row){ row.classList.toggle('selected', !!staffRecallSelectedEmployeeIds[id]); }
    renderStaffRecallRecipientBox();
  }

  function computeStaffRecallRecipients(){
    if(staffRecallMode === 'region'){
      var locCount = Object.keys(staffRecallSelectedLocations).length;
      if(!locCount){ return []; }
      return staffRecallProfiles.filter(function(p){
        return (p.email || p.home_email) && staffRecallSelectedLocations[(p.location || '').trim()];
      });
    }
    if(staffRecallMode === 'handpick'){
      return staffRecallProfiles.filter(function(p){
        return (p.email || p.home_email) && staffRecallSelectedEmployeeIds[p.id];
      });
    }
    return staffRecallProfiles.filter(function(p){ return p.email || p.home_email; });
  }

  function renderStaffRecallRecipientBox(){
    var box = document.getElementById('sr-recipient-box');
    if(!box){ return; }
    var recipients = computeStaffRecallRecipients();
    if(!recipients.length){
      box.innerHTML = '<span class="sr-recipient-count">0 employees</span> will be contacted.';
      return;
    }
    box.innerHTML = '<span class="sr-recipient-count">' + recipients.length + ' employee' + (recipients.length === 1 ? '' : 's') + '</span> will be contacted: '
      + recipients.map(function(r){ return escAttr(r.full_name || 'Unknown'); }).join(', ');
  }

  async function sendStaffRecall(){
    var errorEl = document.getElementById('sr-error');
    errorEl.style.color = 'var(--red)';
    errorEl.textContent = '';
    var subject = document.getElementById('sr-subject').value.trim();
    var message = document.getElementById('sr-message').value.trim();

    if(!subject || !message){
      errorEl.textContent = 'Subject and message are required.';
      return;
    }

    var recipients = computeStaffRecallRecipients();
    if(!recipients.length){
      errorEl.textContent = staffRecallMode === 'all'
        ? 'No employees have an email on file.'
        : 'Select at least one ' + (staffRecallMode === 'region' ? 'region' : 'employee') + ' first.';
      return;
    }

    var scopeLabel = staffRecallMode === 'all'
      ? ('ALL employees (' + recipients.length + ')')
      : (recipients.length + ' selected employee' + (recipients.length === 1 ? '' : 's'));
    if(!confirm('Send this recall to ' + scopeLabel + '? This emails everyone\'s work and home address on file.')){
      return;
    }

    var btn = document.getElementById('sr-send-btn');
    btn.disabled = true;
    btn.textContent = 'Sending...';

    var payload = { subject: subject, message: message, recipientMode: staffRecallMode };
    if(staffRecallMode === 'region'){ payload.locations = Object.keys(staffRecallSelectedLocations); }
    if(staffRecallMode === 'handpick'){ payload.employeeIds = Object.keys(staffRecallSelectedEmployeeIds); }

    try{
      var result = await dbFunction('staff-recall', payload);
      document.getElementById('sr-subject').value = '';
      document.getElementById('sr-message').value = '';
      setStaffRecallMode('all');
      errorEl.style.color = 'var(--teal)';
      errorEl.textContent = 'Sent to ' + (result ? result.recipientCount : 0) + ' recipient(s).';
      loadStaffRecallHistory();
    }catch(e){
      errorEl.style.color = 'var(--red)';
      errorEl.textContent = e.message || 'Couldn\'t send recall. Try again.';
      console.error(e);
    }finally{
      btn.disabled = false;
      btn.textContent = 'Send Recall';
    }
  }

  async function loadStaffRecallHistory(){
    var el = document.getElementById('sr-history');
    try{
      var rows = await dbRequest('staff_recall_broadcasts?order=sent_at.desc&select=id,sent_at,subject,message,recipient_mode,filter_summary,recipient_count,profiles(full_name)');
      if(!rows.length){
        el.innerHTML = '<div class="tk-empty">No recall broadcasts sent yet.</div>';
        return;
      }
      el.innerHTML = rows.map(function(b){
        var scopeLabel = b.recipient_mode === 'region'
          ? ('region: ' + escAttr(b.filter_summary || ''))
          : (b.recipient_mode === 'handpick' ? 'hand-picked' : 'all employees');
        return '<div class="tk-entry-card" style="margin-bottom:10px;">'
          + '<div style="display:flex;justify-content:space-between;align-items:flex-start;gap:12px;flex-wrap:wrap;">'
          + '<div>'
          + '<div class="resume-view-row-title">' + escAttr(b.subject) + '</div>'
          + '<div class="resume-view-row-dates">' + formatDate(b.sent_at) + ' by ' + escAttr((b.profiles && b.profiles.full_name) || 'Unknown') + ' &middot; ' + scopeLabel + '</div>'
          + '</div>'
          + '<button type="button" class="btn-edit" onclick="toggleStaffRecallDetail(\'' + b.id + '\')">' + b.recipient_count + ' contacted</button>'
          + '</div>'
          + '<div class="info-val" style="margin-top:8px;white-space:pre-wrap;">' + escAttr(b.message) + '</div>'
          + '<div id="sr-detail-' + b.id + '" style="margin-top:10px;display:none;"></div>'
          + '</div>';
      }).join('');
    }catch(e){
      el.innerHTML = '<div class="placeholder-card"><div class="placeholder-title">Couldn\'t load broadcast history</div><div class="placeholder-sub">Try refreshing the page.</div></div>';
      console.error(e);
    }
  }

  function staffRecallAckPill(acknowledgedAt){
    return acknowledgedAt
      ? '<span class="tk-status-pill approved">Confirmed</span>'
      : '<span class="tk-status-pill pending">Awaiting</span>';
  }

  async function toggleStaffRecallDetail(broadcastId){
    var detailEl = document.getElementById('sr-detail-' + broadcastId);
    if(!detailEl){ return; }
    var isHidden = detailEl.style.display === 'none' || !detailEl.style.display;
    if(!isHidden){
      detailEl.style.display = 'none';
      return;
    }
    detailEl.style.display = '';
    if(staffRecallDetailLoaded[broadcastId]){ return; }
    detailEl.innerHTML = '<div class="tk-empty">Loading...</div>';
    try{
      var rows = await dbRequest('staff_recall_recipients?broadcast_id=eq.' + broadcastId + '&select=acknowledged_at,profiles(full_name)&order=created_at.asc');
      detailEl.innerHTML = rows.length
        ? '<table class="tk-grid-table"><thead><tr><th>Employee</th><th>Receipt</th></tr></thead><tbody>'
          + rows.map(function(r){
              return '<tr><td>' + escAttr((r.profiles && r.profiles.full_name) || 'Unknown') + '</td><td>' + staffRecallAckPill(r.acknowledged_at) + '</td></tr>';
            }).join('')
          + '</tbody></table>'
        : '<div class="tk-empty">No recipients recorded.</div>';
      staffRecallDetailLoaded[broadcastId] = true;
    }catch(e){
      detailEl.innerHTML = '<div class="info-val" style="color:var(--red);">Couldn\'t load recipients.</div>';
      console.error(e);
    }
  }
