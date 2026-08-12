/* COA Employee Portal — screen-dashboard.js
   Home screen (screen-home): greeting header, news, quick time entry,
   shortcut tiles, and the "coming soon" summary cards.
   Depends on app-core.js (getSession, dbRequest, dbWrite, avatarHtml) and
   on tkGetTimeCodes()/tkHoursOptionsHtml() from screen-timekeeping.js —
   load order in index.html keeps this file after screen-timekeeping.js. */

  // ---------- Dashboard ----------
  var qteRowSeq = 0; // client-side unique suffix for Quick Time Entry rows
  var DASH_NEWS_ITEMS = [
    {title:'Q3 Town Hall — Save the Date', date:'2026-07-15', body:'All-hands town hall scheduled for July 15th. Details to follow via email.'},
    {title:'New Benefits Enrollment Window', date:'2026-07-01', body:'Open enrollment opens July 1st and closes July 21st. Check your email for the portal link.'},
    {title:'Office Closed July 4th', date:'2026-07-04', body:'Office closed for the holiday. Normal hours resume July 6th.'}
  ];

  function toggleNewsItem(idx){
    var el = document.getElementById('news-item-' + idx);
    if(el){ el.classList.toggle('expanded'); }
  }

  function renderNewsItems(){
    return DASH_NEWS_ITEMS.map(function(n, idx){
      return '<div class="news-item" id="news-item-' + idx + '" onclick="toggleNewsItem(' + idx + ')">'
        + '<div class="news-item-title">' + n.title + '</div>'
        + '<div class="news-item-date">' + formatDate(n.date) + '</div>'
        + '<div class="news-item-body">' + n.body + '</div>'
        + '</div>';
    }).join('');
  }

  async function loadDashboard(){
    var container = document.getElementById('home-content');
    var session = getSession();
    if(!session || !session.user){ return; }

    try{
      var rows = await dbRequest('profiles?id=eq.' + session.user.id + '&select=*');
      var p = rows.length ? rows[0] : {};
      var greetName = p.preferred_name || (p.full_name ? p.full_name.split(' ')[0] : '');

      var timeCodes = [];
      try{ timeCodes = await tkGetTimeCodes(); }catch(e){ console.error(e); }

      var upcomingTravelHtml = '<div class="dash-card-empty">No travel data connected yet.</div>';
      try{ upcomingTravelHtml = await buildUpcomingTravelHtml([session.user.id]); }catch(e){ console.error(e); }

      container.innerHTML =
        '<div class="dash-header-strip">'
        + avatarHtml(p.photo_url, p.full_name, 'profile-photo-initials', 'profile-photo-img')
        + '<div><div class="profile-name">Welcome' + (greetName ? ', ' + greetName : '') + '</div><div class="profile-role">' + (p.job_title || '—') + '</div></div>'
        + '<div class="dash-header-meta">'
        + '<div class="dash-meta-item">Department<span>' + (p.department || '—') + '</span></div>'
        + '<div class="dash-meta-item">Location<span>' + (p.location || '—') + '</span></div>'
        + '<div class="dash-meta-item">Status<span>' + (p.employment_status || '—') + '</span></div>'
        + '</div>'
        + '</div>'

        + '<div class="danger-box">'
        + '<div class="danger-box-icon">&#9888;</div>'
        + '<div><div class="danger-box-title">Action needed within 30 days</div>'
        + '<div class="danger-box-text">Security clearance investigation renewal is due soon.<span class="demo-tag">Example — not live</span></div></div>'
        + '</div>'

        + '<div class="dash-top-row">'
        + '<div class="dash-card">'
        + '<div class="dash-card-title">News &amp; Notes</div>'
        + renderNewsItems()
        + '</div>'
        + '<div class="alert-stack">'
        + '<div class="dash-card">'
        + '<div class="dash-card-title">Quick Time Entry</div>'
        + '<table class="tk-grid-table"><thead><tr><th>Time Code</th><th>Date</th><th>Hours</th></tr></thead>'
        + '<tbody id="qte-rows"></tbody></table>'
        + '<button class="tk-now-btn" type="button" style="margin-top:10px;" onclick="addQteRow()">+ Add Line</button>'
        + '<div class="login-error" id="qte-error" style="margin-top:10px;"></div>'
        + '<div class="tk-grid-actions"><button class="btn btn-primary" style="width:auto;padding:11px 20px;" onclick="submitQuickTimeEntry()">Log Today</button></div>'
        + '</div>'
        + '</div>'
        + '</div>'

        + '<div class="shortcuts-label">Shortcuts</div>'
        + '<div class="shortcuts-grid">'
        + '<div class="shortcut-tile" onclick="requestSwitchScreen(\'profile\')"><span class="shortcut-tile-icon">&#9788;</span>My Profile</div>'
        + '<div class="shortcut-tile" onclick="requestSwitchScreen(\'directory\')"><span class="shortcut-tile-icon">&#9737;</span>Company Directory</div>'
        + '<div class="shortcut-tile" onclick="requestSwitchScreen(\'timekeeping\')"><span class="shortcut-tile-icon">&#128337;</span>Timekeeping</div>'
        + '<div class="shortcut-tile" onclick="requestSwitchScreen(\'resume\')"><span class="shortcut-tile-icon">&#9776;</span>My Resume</div>'
        + '<div class="shortcut-tile" onclick="requestSwitchScreen(\'travel\')"><span class="shortcut-tile-icon">&#9992;</span>Travel</div>'
        + '<div class="shortcut-tile" onclick="requestSwitchScreen(\'training\')"><span class="shortcut-tile-icon">&#127891;</span>Training</div>'
        + '<div class="shortcut-tile" onclick="requestSwitchScreen(\'profile\');setTimeout(function(){switchProfileSubtab(\'assets\');},0)"><span class="shortcut-tile-icon">&#128230;</span>Assets</div>'
        + ((document.getElementById('nav-btn-myteam') && document.getElementById('nav-btn-myteam').style.display !== 'none') ? '<div class="shortcut-tile" onclick="requestSwitchScreen(\'myteam\');setTimeout(function(){switchMyTeamSubtab(\'timekeeping\');},0)"><span class="shortcut-tile-icon">&#128101;</span>My Team</div>' : '')
        + '</div>'

        + '<div class="dash-grid">'
        + '<div class="dash-card"><div class="dash-card-title">Upcoming Training Deadlines<span class="dash-card-badge soon">Soon</span></div><div class="dash-card-empty">No training data connected yet.</div></div>'
        + '<div class="dash-card"><div class="dash-card-title">Upcoming Travel</div>' + upcomingTravelHtml + '</div>'
        + '<div class="dash-card"><div class="dash-card-title">Assets In Your Care<span class="dash-card-badge soon">Soon</span></div><div class="dash-card-empty">Asset tracker coming next session.</div></div>'
        + '</div>';

      await renderQteRows(timeCodes);
    }catch(e){
      container.innerHTML = '<div class="placeholder-card"><div class="placeholder-title">Couldn\'t load dashboard</div><div class="placeholder-sub">Try refreshing the page.</div></div>';
      console.error(e);
    }
  }

  // Mirrors the Current Week timesheet grid's row pattern (time code +
  // hours dropdown, add/remove rows) but collapsed to a single day —
  // today. Pre-populates from any entries already logged today so this
  // doesn't silently duplicate/orphan rows created from the main grid.
  async function renderQteRows(timeCodes){
    var tbody = document.getElementById('qte-rows');
    if(!tbody){ return; }
    var session = getSession();
    var todayISO = new Date().toISOString().slice(0,10);
    var todayLabel = new Date(todayISO + 'T00:00:00').toLocaleDateString('en-US', { weekday:'long', month:'short', day:'numeric' });

    var authorizedSlins = [];
    try{ authorizedSlins = await tkGetAuthorizedSlins(session.user.id); }catch(e){ console.error(e); }

    tbody.dataset.date = todayISO;
    tbody.dataset.dateLabel = todayLabel;
    tbody.dataset.timeCodes = JSON.stringify(timeCodes.map(function(c){ return { id: c.id, label: c.label, category: c.category }; }));
    tbody.dataset.slinOptions = JSON.stringify(authorizedSlins);
    tbody.innerHTML = '';
    qteRowSeq = 0;

    var entries = [];
    try{ entries = await dbRequest('time_entries?employee_id=eq.' + session.user.id + '&work_date=eq.' + todayISO + '&select=id,time_code_id,hours,slin_id'); }catch(e){ console.error(e); }

    if(entries.length){
      entries.forEach(function(e){ addQteRow(e); });
    } else {
      addQteRow();
    }
  }

  function addQteRow(existing){
    var tbody = document.getElementById('qte-rows');
    if(!tbody){ return; }
    qteRowSeq++;
    var rowId = 'qte-' + qteRowSeq;
    var isFirst = tbody.children.length === 0;
    var timeCodes = tbody.dataset.timeCodes ? JSON.parse(tbody.dataset.timeCodes) : [];
    var slinOptions = tbody.dataset.slinOptions ? JSON.parse(tbody.dataset.slinOptions) : [];
    var dateLabel = tbody.dataset.dateLabel || '';
    var codeVal = existing ? existing.time_code_id : '';
    var hoursVal = existing && existing.hours != null ? existing.hours : '';
    var slinVal = existing && existing.slin_id ? existing.slin_id : '';
    var hasSaved = !!(existing && existing.id);

    var codeInfo = timeCodes.find(function(c){ return c.id === codeVal; });
    var rowBillable = !!(codeInfo && (codeInfo.category === 'gov_contract' || codeInfo.category === 'commercial_customer'));

    var codeOptions = '<option value="">Select time code…</option>'
      + timeCodes.map(function(c){ return '<option value="' + c.id + '" data-category="' + (c.category || '') + '"' + (c.id === codeVal ? ' selected' : '') + '>' + c.label + '</option>'; }).join('');

    var slinOptionsList = slinOptions.slice();
    if(slinVal && !slinOptionsList.some(function(o){ return o.id === slinVal; })){
      slinOptionsList.push({ id: slinVal, label: 'SLIN' });
    }
    var slinOptionsHtml = slinOptionsList.length
      ? ('<option value="">Select SLIN…</option>' + slinOptionsList.map(function(o){ return '<option value="' + o.id + '"' + (o.id === slinVal ? ' selected' : '') + '>' + o.label + '</option>'; }).join(''))
      : '<option value="">No SLINs authorized — contact your admin</option>';

    var rowHtml = '<tr data-rowid="' + rowId + '">'
      + '<td><select class="tk-grid-input" id="' + rowId + '-code" ' + (hasSaved ? 'disabled' : '') + ' onchange="qteOnCodeChange(\'' + rowId + '\')">' + codeOptions + '</select>'
      + '<div id="' + rowId + '-slin-wrap" style="margin-top:6px;display:' + (rowBillable ? 'block' : 'none') + ';"><select class="tk-grid-input" id="' + rowId + '-slin" ' + (hasSaved ? 'disabled' : '') + '>' + slinOptionsHtml + '</select></div>'
      + '</td>'
      + '<td>' + dateLabel + '</td>'
      + '<td><div class="tk-pto-hours-cell"><select class="tk-grid-input" id="' + rowId + '-hours" style="width:80px;">' + tkHoursOptionsHtml(hoursVal) + '</select>'
        + (isFirst ? '' : '<button class="tk-now-btn tk-remove-btn" type="button" onclick="removeQteRow(\'' + rowId + '\')">&minus;</button>')
        + '</div></td>'
      + '</tr>';
    tbody.insertAdjacentHTML('beforeend', rowHtml);
  }

  function qteOnCodeChange(rowId){
    var codeSel = document.getElementById(rowId + '-code');
    var slinWrap = document.getElementById(rowId + '-slin-wrap');
    if(!codeSel || !slinWrap){ return; }
    var opt = codeSel.selectedOptions[0];
    var billable = !!(opt && (opt.dataset.category === 'gov_contract' || opt.dataset.category === 'commercial_customer'));
    slinWrap.style.display = billable ? 'block' : 'none';
    if(!billable){
      var slinSel = document.getElementById(rowId + '-slin');
      if(slinSel){ slinSel.value = ''; }
    }
  }

  function removeQteRow(rowId){
    var tr = document.querySelector('#qte-rows tr[data-rowid="' + rowId + '"]');
    if(tr){ tr.remove(); }
  }

  async function submitQuickTimeEntry(){
    var errorEl = document.getElementById('qte-error');
    var session = getSession();
    var tbody = document.getElementById('qte-rows');
    var todayISO = tbody && tbody.dataset.date ? tbody.dataset.date : new Date().toISOString().slice(0,10);
    var timeCodes = tbody && tbody.dataset.timeCodes ? JSON.parse(tbody.dataset.timeCodes) : [];
    var categoryById = {};
    timeCodes.forEach(function(c){ categoryById[c.id] = c.category; });
    errorEl.textContent = '';

    var rowEls = document.querySelectorAll('#qte-rows tr[data-rowid]');
    var writes = [];
    var hasInvalid = false;
    var missingSlin = false;
    rowEls.forEach(function(tr){
      var rowId = tr.dataset.rowid;
      var codeSel = document.getElementById(rowId + '-code');
      var hoursSel = document.getElementById(rowId + '-hours');
      var slinSel = document.getElementById(rowId + '-slin');
      if(!codeSel || !hoursSel){ return; }
      var codeVal = codeSel.value;
      var hoursVal = hoursSel.value;
      if(!codeVal && !hoursVal){ return; } // fully blank row, skip
      if(!codeVal || !hoursVal || parseFloat(hoursVal) <= 0){ hasInvalid = true; return; }
      var billable = categoryById[codeVal] === 'gov_contract' || categoryById[codeVal] === 'commercial_customer';
      var slinVal = (slinSel && slinSel.value) ? slinSel.value : null;
      if(billable && !slinVal){ missingSlin = true; return; }
      writes.push({ time_code_id: codeVal, hours: parseFloat(hoursVal), slin_id: slinVal });
    });

    if(hasInvalid){
      errorEl.textContent = 'Select a time code and valid hours for every line.';
      return;
    }
    if(missingSlin){
      errorEl.textContent = 'Select a SLIN for every line logging billable hours.';
      return;
    }
    if(!writes.length){
      errorEl.textContent = 'Add at least one time code and hours.';
      return;
    }

    try{
      for(var i=0;i<writes.length;i++){
        var w = writes[i];
        var lookup = 'time_entries?employee_id=eq.' + session.user.id + '&work_date=eq.' + todayISO + '&time_code_id=eq.' + w.time_code_id
          + (w.slin_id ? ('&slin_id=eq.' + w.slin_id) : '&slin_id=is.null');
        var existing = await dbRequest(lookup + '&select=id');
        if(existing.length){
          await dbWrite('time_entries?id=eq.' + existing[0].id, 'PATCH', { hours: w.hours, status: 'submitted' });
        } else {
          await dbWrite('time_entries', 'POST', {
            employee_id: session.user.id,
            work_date: todayISO,
            time_code_id: w.time_code_id,
            slin_id: w.slin_id,
            hours: w.hours,
            status: 'submitted'
          });
        }
      }
      loadDashboard();
    }catch(e){
      errorEl.textContent = 'Could not submit entry — try again.';
      console.error(e);
    }
  }
