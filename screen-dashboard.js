/* COA Employee Portal — screen-dashboard.js
   Home screen (screen-home): greeting header, news, quick time entry,
   shortcut tiles, and the "coming soon" summary cards.
   Depends on app-core.js (getSession, dbRequest, dbWrite, getInitials) and
   on TK_SELECTABLE_TYPES / TK_TYPE_LABELS from screen-timekeeping.js — load
   order in index.html keeps this file after screen-timekeeping.js. */

  // ---------- Dashboard ----------
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

      var projectRows = [];
      try{ projectRows = await dbRequest('projects?active=eq.true&select=id,name&order=name.asc'); }catch(e){ console.error(e); }
      var projectOptions = projectRows.map(function(pr){ return '<option value="' + pr.id + '">' + pr.name + '</option>'; }).join('');

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
        + '<div class="quick-entry-row">'
        + '<div><label class="field-label" for="qte-hours">Hours</label><input type="text" inputmode="decimal" id="qte-hours" class="field-input qte-hours-input" maxlength="2" placeholder="8"></div>'
        + '<div><label class="field-label" for="qte-status">Status</label><select id="qte-status" class="field-input">'
        + TK_SELECTABLE_TYPES.map(function(t){ return '<option value="' + t + '">' + TK_TYPE_LABELS[t] + '</option>'; }).join('')
        + '</select></div>'
        + '<div><label class="field-label" for="qte-project">Project</label><select id="qte-project" class="field-input">'
        + projectOptions
        + '</select></div>'
        + '<button class="btn btn-primary" onclick="submitQuickTimeEntry()">Log Today</button>'
        + '</div>'
        + '<div class="login-error" id="qte-error"></div>'
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
    }catch(e){
      container.innerHTML = '<div class="placeholder-card"><div class="placeholder-title">Couldn\'t load dashboard</div><div class="placeholder-sub">Try refreshing the page.</div></div>';
      console.error(e);
    }
  }

  async function submitQuickTimeEntry(){
    var errorEl = document.getElementById('qte-error');
    var session = getSession();
    var hoursVal = document.getElementById('qte-hours').value;
    var statusVal = document.getElementById('qte-status').value;
    var projectVal = document.getElementById('qte-project').value;
    errorEl.textContent = '';

    if(!hoursVal || isNaN(parseFloat(hoursVal)) || parseFloat(hoursVal) <= 0){
      errorEl.textContent = 'Enter a valid number of hours.';
      return;
    }

    try{
      await dbWrite('time_entries', 'POST', {
        employee_id: session.user.id,
        work_date: new Date().toISOString().slice(0,10),
        hours: parseFloat(hoursVal),
        earning_type: statusVal,
        project_id: projectVal || null,
        status: 'submitted'
      });
      document.getElementById('qte-hours').value = '';
      loadDashboard();
    }catch(e){
      errorEl.textContent = 'Could not submit entry — try again.';
      console.error(e);
    }
  }
