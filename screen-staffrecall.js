/* COA Employee Portal — screen-staffrecall.js
   Directory > Staff Recall (admin-only; the subtab button is hidden/shown
   by app-core.js's checkAdminNavVisibility(), which also gates the Admin
   nav tab off the same role check). Broadcasts an email — work + home
   address — to all or a location-filtered subset of employees via the
   staff-recall Supabase Edge Function. That function is the real
   authorization boundary (it re-checks the caller's role server-side);
   this screen's admin-only visibility is UI convenience, not the security
   control. Logs every broadcast + recipient + confirm-receipt click to
   staff_recall_broadcasts / staff_recall_recipients.
   Depends on app-core.js: getSession, dbRequest, dbFunction, escAttr,
   formatDate. */

  var staffRecallDetailLoaded = {};

  async function loadStaffRecallScreen(){
    var container = document.getElementById('staffrecall-content');
    container.innerHTML =
      '<div class="tk-entry-card">'
      + '<div class="tk-section-title">Send Staff Recall</div>'
      + '<div class="placeholder-sub" style="margin-bottom:12px;">Broadcasts an email to every matching employee\'s work and home address, with a link they can click to confirm receipt. Best-effort — there is no guaranteed delivery, especially for staff traveling or without reliable connectivity.</div>'
      + '<label class="field-label" for="sr-subject">Subject</label>'
      + '<input class="field-input" id="sr-subject" placeholder="e.g. Hurricane Recall — Report Status">'
      + '<label class="field-label" for="sr-message" style="margin-top:10px;">Message</label>'
      + '<textarea class="field-input" id="sr-message" rows="5" placeholder="What employees need to know and do."></textarea>'
      + '<label class="field-label" for="sr-location" style="margin-top:10px;">Location filter (optional)</label>'
      + '<input class="field-input" id="sr-location" placeholder="e.g. Charleston — leave blank to include everyone">'
      + '<div style="display:flex;gap:10px;margin-top:14px;">'
      + '<button type="button" class="btn-edit" onclick="previewStaffRecallRecipients()">Preview Recipients</button>'
      + '<button type="button" class="btn btn-primary" id="sr-send-btn" style="width:auto;padding:11px 20px;" onclick="sendStaffRecall()">Send Recall</button>'
      + '</div>'
      + '<div id="sr-preview" style="margin-top:14px;"></div>'
      + '<div class="login-error" id="sr-error"></div>'
      + '</div>'
      + '<div class="tk-entry-card">'
      + '<div class="tk-section-title">Broadcast History</div>'
      + '<div id="sr-history"><div class="tk-empty">Loading...</div></div>'
      + '</div>';
    loadStaffRecallHistory();
  }

  // Client-side substring match against profiles.location — mirrors the
  // matching the Edge Function does server-side, so the preview count is
  // an accurate preview of who actually gets emailed.
  async function previewStaffRecallRecipients(){
    var previewEl = document.getElementById('sr-preview');
    var locationFilter = document.getElementById('sr-location').value.trim().toLowerCase();
    previewEl.innerHTML = '<div class="tk-empty">Loading...</div>';
    try{
      var rows = await dbRequest('profiles?select=id,full_name,location&order=full_name.asc');
      var matches = locationFilter
        ? rows.filter(function(r){ return (r.location || '').toLowerCase().indexOf(locationFilter) !== -1; })
        : rows;
      if(!matches.length){
        previewEl.innerHTML = '<div class="tk-empty">No employees match that filter.</div>';
        return;
      }
      previewEl.innerHTML = '<div class="info-val" style="margin-bottom:6px;">' + matches.length + ' employee' + (matches.length === 1 ? '' : 's') + ' will be contacted:</div>'
        + '<div class="tk-empty" style="white-space:normal;">' + matches.map(function(r){ return escAttr(r.full_name || 'Unknown'); }).join(', ') + '</div>';
    }catch(e){
      previewEl.innerHTML = '<div class="info-val" style="color:var(--red);">Couldn\'t load preview.</div>';
      console.error(e);
    }
  }

  async function sendStaffRecall(){
    var errorEl = document.getElementById('sr-error');
    errorEl.style.color = 'var(--red)';
    errorEl.textContent = '';
    var subject = document.getElementById('sr-subject').value.trim();
    var message = document.getElementById('sr-message').value.trim();
    var locationFilter = document.getElementById('sr-location').value.trim();

    if(!subject || !message){
      errorEl.textContent = 'Subject and message are required.';
      return;
    }

    var scopeLabel = locationFilter ? ('employees matching "' + locationFilter + '"') : 'ALL employees';
    if(!confirm('Send this recall to ' + scopeLabel + '? This emails everyone\'s work and home address on file.')){
      return;
    }

    var btn = document.getElementById('sr-send-btn');
    btn.disabled = true;
    btn.textContent = 'Sending...';

    try{
      var result = await dbFunction('staff-recall', { subject: subject, message: message, locationFilter: locationFilter });
      document.getElementById('sr-subject').value = '';
      document.getElementById('sr-message').value = '';
      document.getElementById('sr-location').value = '';
      document.getElementById('sr-preview').innerHTML = '';
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
      var rows = await dbRequest('staff_recall_broadcasts?order=sent_at.desc&select=id,sent_at,subject,message,location_filter,recipient_count,profiles(full_name)');
      if(!rows.length){
        el.innerHTML = '<div class="tk-empty">No recall broadcasts sent yet.</div>';
        return;
      }
      el.innerHTML = rows.map(function(b){
        var scopeLabel = b.location_filter ? ('filtered: "' + escAttr(b.location_filter) + '"') : 'all employees';
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
