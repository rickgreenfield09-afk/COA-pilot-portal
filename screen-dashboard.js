/* COA Employee Portal — screen-dashboard.js
   Home screen (screen-home): greeting header, news, quick time entry,
   shortcut tiles, and the "coming soon" summary cards.
   Depends on app-core.js (getSession, dbRequest, dbWrite, getInitials) and
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
        + '<div class="profile-photo-initials">' + getInitials(p.full_name) + '</div>'
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
        + '<div class="warning-box">'
        + '<div class="warning-box-icon">&#9888;</div>'
        + '<div><div class="warning-box-title">Action Needed: Training Survey</div>'
        + '<div class="warning-box-text">Completed training is awaiting your feedback. <a href="#">Fill out survey</a><span class="demo-tag">Example — not live</span></div></div>'
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
        + '<div class="dash-card"><div class="dash-card-title">Action Needed<span class="dash-card-badge soon">Soon</span></div><div class="dash-card-empty">No surveys pending yet.</div></div>'
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

    tbody.dataset.date = todayISO;
    tbody.dataset.dateLabel = todayLabel;
    tbody.dataset.timeCodes = JSON.stringify(timeCodes.map(function(c){ return { id: c.id, label: c.label }; }));
    tbody.innerHTML = '';
    qteRowSeq = 0;

    var entries = [];
    try{ entries = await dbRequest('time_entries?employee_id=eq.' + session.user.id + '&work_date=eq.' + todayISO + '&select=id,time_code_id,hours'); }catch(e){ console.error(e); }

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
    var dateLabel = tbody.dataset.dateLabel || '';
    var codeVal = existing ? existing.time_code_id : '';
    var hoursVal = existing && existing.hours != null ? existing.hours : '';
    var hasSaved = !!(existing && existing.id);

    var codeOptions = '<option value="">Select time code…</option>'
      + timeCodes.map(function(c){ return '<option value="' + c.id + '"' + (c.id === codeVal ? ' selected' : '') + '>' + c.label + '</option>'; }).join('');

    var rowHtml = '<tr data-rowid="' + rowId + '">'
      + '<td><select class="tk-grid-input" id="' + rowId + '-code" ' + (hasSaved ? 'disabled' : '') + '>' + codeOptions + '</select></td>'
      + '<td>' + dateLabel + '</td>'
      + '<td><div class="tk-pto-hours-cell"><select class="tk-grid-input" id="' + rowId + '-hours" style="width:80px;">' + tkHoursOptionsHtml(hoursVal) + '</select>'
        + (isFirst ? '' : '<button class="tk-now-btn tk-remove-btn" type="button" onclick="removeQteRow(\'' + rowId + '\')">&minus;</button>')
        + '</div></td>'
      + '</tr>';
    tbody.insertAdjacentHTML('beforeend', rowHtml);
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
    errorEl.textContent = '';

    var rowEls = document.querySelectorAll('#qte-rows tr[data-rowid]');
    var writes = [];
    var hasInvalid = false;
    rowEls.forEach(function(tr){
      var rowId = tr.dataset.rowid;
      var codeSel = document.getElementById(rowId + '-code');
      var hoursSel = document.getElementById(rowId + '-hours');
      if(!codeSel || !hoursSel){ return; }
      var codeVal = codeSel.value;
      var hoursVal = hoursSel.value;
      if(!codeVal && !hoursVal){ return; } // fully blank row, skip
      if(!codeVal || !hoursVal || parseFloat(hoursVal) <= 0){ hasInvalid = true; return; }
      writes.push({ time_code_id: codeVal, hours: parseFloat(hoursVal) });
    });

    if(hasInvalid){
      errorEl.textContent = 'Select a time code and valid hours for every line.';
      return;
    }
    if(!writes.length){
      errorEl.textContent = 'Add at least one time code and hours.';
      return;
    }

    try{
      for(var i=0;i<writes.length;i++){
        var w = writes[i];
        var existing = await dbRequest('time_entries?employee_id=eq.' + session.user.id + '&work_date=eq.' + todayISO + '&time_code_id=eq.' + w.time_code_id + '&select=id');
        if(existing.length){
          await dbWrite('time_entries?id=eq.' + existing[0].id, 'PATCH', { hours: w.hours, status: 'submitted' });
        } else {
          await dbWrite('time_entries', 'POST', {
            employee_id: session.user.id,
            work_date: todayISO,
            time_code_id: w.time_code_id,
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
