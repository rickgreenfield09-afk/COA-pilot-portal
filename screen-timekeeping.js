/* COA Employee Portal — screen-timekeeping.js
   Current period entry, history, PTO request/balance, and the My Team/Admin
   timekeeping review functions (scope param, reused by screen-myteam.js and
   screen-admin.js). TK_SELECTABLE_TYPES/TK_TYPE_LABELS are also read by
   screen-dashboard.js (quick time entry) — load order in index.html keeps
   this file before screen-dashboard.js.
   Depends on app-core.js: getSession, dbRequest, dbWrite, dbRpc, isAdmin,
   getRecursiveReportIds. */

  // ---------- Timekeeping ----------
  var TK_TYPES = ['regular', 'overtime', 'pto', 'training', 'travel', 'admin', 'award'];
  var TK_TYPE_LABELS = { regular:'Regular', overtime:'Overtime', pto:'PTO', training:'Training', travel:'Travel', admin:'Admin', award:'Award' };
  var TK_SELECTABLE_TYPES = ['regular', 'pto', 'training', 'travel', 'admin', 'award']; // overtime is system-assigned only, never user-selectable
  var TK_ANCHOR = new Date('2026-06-21T00:00:00');
  var TK_DAY_MS = 24 * 60 * 60 * 1000;
  var tkCurrentPeriodOffset = 0;   // 0 = period containing today, -1 = prior period, etc. (Current Period tab)
  var tkHistoryPeriodOffset = -1;  // History tab starts one period back
  var TK_PROJECTS_CACHE = null;


  function tkStatusPill(status){
    return '<span class="tk-status-pill ' + status + '">' + status + '</span>';
  }

  function switchTkSubtab(name){
    document.querySelectorAll('.tk-subscreen').forEach(function(s){ s.classList.remove('active'); });
    document.querySelectorAll('[data-tksubtab]').forEach(function(b){ b.classList.toggle('active', b.dataset.tksubtab === name); });
    document.getElementById('tk-' + name).classList.add('active');
    if(name === 'current'){ loadTkPeriod('tk-current', tkCurrentPeriodOffset, true); }
    if(name === 'history'){ initTkHistory(); }
    if(name === 'ptorequest'){ loadPtoRequest(); }
    if(name === 'ptobalance'){ loadPtoBalance(); }
  }

  // ---- Period math: TK_ANCHOR (6/21/2026) is offset 0; Period numbering
  //      starts from the first period fully inside January (1/4/2026 -
  //      1/17/2026 = Period 1), which sits 13 periods before TK_ANCHOR.
  function tkPeriodBounds(offset){
    var start = new Date(TK_ANCHOR.getTime() + offset * 14 * TK_DAY_MS);
    var end = new Date(start.getTime() + 13 * TK_DAY_MS);
    return { start: start, end: end };
  }

  function tkPeriodNumber(offset){
    return offset + 13; // offset 0 (6/21-7/4) = Period 13; offset -12 (1/4-1/17) = Period 1
  }

  function tkDateToISO(d){
    return d.getFullYear() + '-' + String(d.getMonth()+1).padStart(2,'0') + '-' + String(d.getDate()).padStart(2,'0');
  }

  function tkOffsetForToday(){
    var todayUTC = new Date(new Date().toISOString().slice(0,10) + 'T00:00:00');
    var diffDays = Math.round((todayUTC - TK_ANCHOR) / TK_DAY_MS);
    return Math.floor(diffDays / 14);
  }

  // Prints every pay period from Period 1 (1/4/2026) through the period
  // containing today, to the browser console. Run printTkPeriods() from
  // devtools console to verify the calendar.
  function printTkPeriods(){
    var todayOffset = tkOffsetForToday();
    var startOffset = -12; // Period 1
    var rows = [];
    for(var o = startOffset; o <= todayOffset; o++){
      var b = tkPeriodBounds(o);
      rows.push({ period: tkPeriodNumber(o), start: tkDateToISO(b.start), end: tkDateToISO(b.end) });
    }
    console.table(rows);
    return rows;
  }

  // ---------- My Team (manager/admin review) ----------
  var myTeamFlagged = {}; // { employeeId: Set of dates flagged for return } — keyed by employee id only; ids are unique company-wide so no scope collision risk

  var teamTkReports = { myteam: [], admin: [] };
  var teamTkIndex = { myteam: 0, admin: 0 };
  var teamTkStartISO = { myteam: '', admin: '' };
  var teamTkEndISO = { myteam: '', admin: '' };

  function teamTkContentId(scope){
    return scope + '-timekeeping-content';
  }

  async function loadTeamTimekeeping(scope){
    var container = document.getElementById(teamTkContentId(scope));
    var session = getSession();
    if(!session || !session.user){ return; }

    try{
      var ids;
      if(scope === 'admin'){
        ids = (await dbRequest('profiles?id=neq.' + session.user.id + '&select=id')).map(function(r){ return r.id; });
      } else {
        ids = await getRecursiveReportIds(session.user.id);
      }
      teamTkReports[scope] = ids.length
        ? await dbRequest('profiles?id=in.(' + ids.join(',') + ')&select=id,full_name,job_title&order=full_name.asc')
        : [];

      if(!teamTkReports[scope].length){
        container.innerHTML = '<div class="placeholder-card"><div class="placeholder-title">No employees found</div><div class="placeholder-sub">' + (scope === 'admin' ? 'No other employees on file.' : 'Nobody is currently assigned to you for review.') + '</div></div>';
        return;
      }

      var todayOffset = tkOffsetForToday();
      var bounds = tkPeriodBounds(todayOffset);
      teamTkStartISO[scope] = tkDateToISO(bounds.start);
      teamTkEndISO[scope] = tkDateToISO(bounds.end);
      if(teamTkIndex[scope] >= teamTkReports[scope].length){ teamTkIndex[scope] = 0; }

      await teamTkRenderCurrentCard(scope);
    }catch(e){
      container.innerHTML = '<div class="placeholder-card"><div class="placeholder-title">Couldn\'t load timekeeping</div><div class="placeholder-sub">Try refreshing the page.</div></div>';
      console.error(e);
    }
  }

  async function teamTkRenderCurrentCard(scope){
    var container = document.getElementById(teamTkContentId(scope));
    var employee = teamTkReports[scope][teamTkIndex[scope]];
    var startISO = teamTkStartISO[scope];
    var endISO = teamTkEndISO[scope];

    var navHtml = '<div class="myteam-tk-header-row">'
      + '<div class="tk-period-label">Pay Period ' + tkPeriodNumber(tkOffsetForToday()) + '</div>'
      + '<div class="tk-period-dates">' + formatDate(startISO) + ' – ' + formatDate(endISO) + '</div>'
      + '<button class="tk-period-nav-btn" ' + (teamTkIndex[scope] === 0 ? 'disabled' : '') + ' onclick="teamTkNavEmployee(\'' + scope + '\',-1)">&larr; Prev</button>'
      + '<div class="myteam-nav-count">Employee ' + (teamTkIndex[scope]+1) + ' of ' + teamTkReports[scope].length + '</div>'
      + '<button class="tk-period-nav-btn" ' + (teamTkIndex[scope] === teamTkReports[scope].length-1 ? 'disabled' : '') + ' onclick="teamTkNavEmployee(\'' + scope + '\',1)">Next &rarr;</button>'
      + '</div>';

    container.innerHTML = navHtml + '<div class="placeholder-card"><div class="placeholder-sub">Loading...</div></div>';
    var cardHtml = await teamTkRenderCard(employee, startISO, endISO, scope);
    container.innerHTML = navHtml + cardHtml;
  }

  function teamTkNavEmployee(scope, dir){
    teamTkIndex[scope] += dir;
    if(teamTkIndex[scope] < 0){ teamTkIndex[scope] = 0; }
    if(teamTkIndex[scope] >= teamTkReports[scope].length){ teamTkIndex[scope] = teamTkReports[scope].length - 1; }
    teamTkRenderCurrentCard(scope);
  }

  async function teamTkRenderCard(employee, startISO, endISO, scope){
    var projects = await tkGetProjects();
    var rows = await dbRequest('time_entries?employee_id=eq.' + employee.id + '&work_date=gte.' + startISO + '&work_date=lte.' + endISO + '&select=*');
    var byDate = {};
    rows.forEach(function(r){ byDate[r.work_date] = r; });

    var days = [];
    var startDate = new Date(startISO + 'T00:00:00');
    for(var i=0;i<14;i++){
      days.push(new Date(startDate.getTime() + i*TK_DAY_MS));
    }

    if(!myTeamFlagged[employee.id]){ myTeamFlagged[employee.id] = {}; }
    var flaggedForThis = myTeamFlagged[employee.id];

    var weekTotals = [0,0];
    var rowsHtml = '';
    days.forEach(function(d, idx){
      var iso = tkDateToISO(d);
      var row = byDate[iso];
      var weekIdx = idx < 7 ? 0 : 1;
      var dayLabel = d.toLocaleDateString('en-US', { weekday:'long' }) + ', ' + formatDate(iso);
      var earningType = row && row.earning_type ? row.earning_type : null;
      var hours = row && row.hours != null ? row.hours : 0;
      weekTotals[weekIdx] += hours;
      var isFlagged = !!flaggedForThis[iso];
      var rowClass = (idx === 6) ? 'tk-week-divider' : '';
      if(isFlagged){ rowClass += ' tk-day-flagged'; }
      var hasEntry = !!row;

      rowsHtml += '<tr class="' + rowClass + '" data-date="' + iso + '" data-emp="' + employee.id + '">'
        + '<td>' + dayLabel + '</td>'
        + '<td>' + (row && row.day_start ? row.day_start.slice(0,5) : '—') + '</td>'
        + '<td>' + (row && row.day_end ? row.day_end.slice(0,5) : '—') + '</td>'
        + '<td>' + (row && row.project_id ? (projects.find(function(p){ return p.id === row.project_id; }) || {}).name || '—' : '—') + '</td>'
        + '<td>' + (earningType ? TK_TYPE_LABELS[earningType] : '—') + '</td>'
        + '<td>' + (hours || '—') + '</td>'
        + '<td>' + (hasEntry ? '<button class="tk-now-btn" type="button" onclick="teamTkToggleFlag(\'' + scope + '\',\'' + employee.id + '\',\'' + iso + '\')">' + (isFlagged ? 'Unflag' : 'Flag') + '</button>' : '—') + '</td>'
        + '</tr>';
    });

    var anyFlagged = Object.keys(flaggedForThis).some(function(k){ return flaggedForThis[k]; });
    var cardId = 'myteam-card-' + employee.id;

    return '<div class="tk-entry-card" id="' + cardId + '">'
      + '<div class="myteam-employee-header">'
      + '<div class="myteam-employee-name">' + (employee.full_name || 'Unknown') + '</div>'
      + '<div class="myteam-employee-title">' + (employee.job_title || '—') + '</div>'
      + '</div>'
      + '<table class="tk-grid-table"><thead><tr>'
      + '<th>Day / Date</th><th>Start</th><th>Stop</th><th>Project</th><th>Status</th><th>Hours</th><th>Flag</th>'
      + '</tr></thead><tbody>' + rowsHtml + '</tbody></table>'
      + '<div class="tk-grid-footer">'
      + '<div class="tk-grid-footer-item">Week 1: <span>' + weekTotals[0].toFixed(2) + ' hrs</span></div>'
      + '<div class="tk-grid-footer-item">Week 2: <span>' + weekTotals[1].toFixed(2) + ' hrs</span></div>'
      + '<div class="tk-grid-footer-item">Total: <span>' + (weekTotals[0]+weekTotals[1]).toFixed(2) + ' hrs</span></div>'
      + '</div>'
      + '<div id="myteam-return-panel-' + employee.id + '"></div>'
      + '<div class="tk-grid-actions">'
      + '<div class="login-error" id="myteam-error-' + employee.id + '" style="margin-top:0;flex:1;"></div>'
      + '<button class="btn-logout" style="width:auto;" onclick="teamTkOpenReturnPanel(\'' + scope + '\',\'' + employee.id + '\',\'' + startISO + '\',\'' + endISO + '\')">Return</button>'
      + '<button class="btn btn-primary" style="width:auto;padding:11px 20px;" ' + (anyFlagged ? 'disabled' : '') + ' onclick="teamTkApproveAll(\'' + scope + '\',\'' + employee.id + '\',\'' + startISO + '\',\'' + endISO + '\')">Approve All</button>'
      + '</div>'
      + '</div>';
  }

  function teamTkToggleFlag(scope, employeeId, iso){
    if(!myTeamFlagged[employeeId]){ myTeamFlagged[employeeId] = {}; }
    myTeamFlagged[employeeId][iso] = !myTeamFlagged[employeeId][iso];
    teamTkRenderCurrentCard(scope);
  }

  async function teamTkApproveAll(scope, employeeId, startISO, endISO){
    var errorEl = document.getElementById('myteam-error-' + employeeId);
    errorEl.textContent = '';
    try{
      var rows = await dbRequest('time_entries?employee_id=eq.' + employeeId + '&work_date=gte.' + startISO + '&work_date=lte.' + endISO + '&select=id,earning_type');
      var session = getSession();
      for(var i=0;i<rows.length;i++){
        await dbWrite('time_entries?id=eq.' + rows[i].id, 'PATCH', {
          status: 'approved',
          approved_by: session.user.id,
          approved_at: new Date().toISOString()
        });
      }
      // Accrue PTO once per employee per approved period, not per-row
      try{ await dbRpc('accrue_pto', { p_employee_id: employeeId }); }catch(e){ console.error(e); }
      delete myTeamFlagged[employeeId];
      teamTkRenderCurrentCard(scope);
    }catch(e){
      errorEl.textContent = 'Could not approve — try again.';
      console.error(e);
    }
  }

  function teamTkOpenReturnPanel(scope, employeeId, startISO, endISO){
    var panel = document.getElementById('myteam-return-panel-' + employeeId);
    var flaggedDates = Object.keys(myTeamFlagged[employeeId] || {}).filter(function(k){ return myTeamFlagged[employeeId][k]; });

    var fieldsHtml;
    if(flaggedDates.length){
      fieldsHtml = flaggedDates.map(function(iso){
        return '<div style="margin-bottom:10px;"><label class="field-label">' + formatDate(iso) + '</label>'
          + '<input type="text" class="field-input" id="myteam-note-' + employeeId + '-' + iso + '" placeholder="Reason for returning this entry"></div>';
      }).join('');
    } else {
      fieldsHtml = '<div style="margin-bottom:10px;"><label class="field-label">Note for this submission</label>'
        + '<input type="text" class="field-input" id="myteam-note-' + employeeId + '-general" placeholder="Reason for returning this period"></div>';
    }

    panel.innerHTML = '<div class="myteam-return-box">'
      + '<div class="tk-section-title">Return Reason</div>'
      + fieldsHtml
      + '<button class="btn btn-primary" style="width:auto;padding:9px 16px;" onclick="teamTkSubmitReturn(\'' + scope + '\',\'' + employeeId + '\',\'' + startISO + '\',\'' + endISO + '\')">Submit Return</button>'
      + '</div>';
  }

  async function teamTkSubmitReturn(scope, employeeId, startISO, endISO){
    var errorEl = document.getElementById('myteam-error-' + employeeId);
    errorEl.textContent = '';
    var session = getSession();
    var flaggedDates = Object.keys(myTeamFlagged[employeeId] || {}).filter(function(k){ return myTeamFlagged[employeeId][k]; });

    try{
      if(flaggedDates.length){
        for(var i=0;i<flaggedDates.length;i++){
          var iso = flaggedDates[i];
          var noteEl = document.getElementById('myteam-note-' + employeeId + '-' + iso);
          var note = noteEl ? noteEl.value : '';
          var existing = await dbRequest('time_entries?employee_id=eq.' + employeeId + '&work_date=eq.' + iso + '&select=id');
          if(existing.length){
            await dbWrite('time_entries?id=eq.' + existing[0].id, 'PATCH', {
              status: 'rejected',
              notes: formatDate(iso) + ': ' + note,
              approved_by: session.user.id,
              approved_at: new Date().toISOString()
            });
          }
        }
      } else {
        var noteEl2 = document.getElementById('myteam-note-' + employeeId + '-general');
        var note2 = noteEl2 ? noteEl2.value : '';
        var rows = await dbRequest('time_entries?employee_id=eq.' + employeeId + '&work_date=gte.' + startISO + '&work_date=lte.' + endISO + '&select=id');
        for(var j=0;j<rows.length;j++){
          await dbWrite('time_entries?id=eq.' + rows[j].id, 'PATCH', {
            status: 'rejected',
            notes: note2,
            approved_by: session.user.id,
            approved_at: new Date().toISOString()
          });
        }
      }
      delete myTeamFlagged[employeeId];
      teamTkRenderCurrentCard(scope);
    }catch(e){
      errorEl.textContent = 'Could not submit return — try again.';
      console.error(e);
    }
  }


  async function tkGetProjects(){
    if(TK_PROJECTS_CACHE){ return TK_PROJECTS_CACHE; }
    try{
      TK_PROJECTS_CACHE = await dbRequest('projects?active=eq.true&select=id,name&order=name.asc');
    }catch(e){ TK_PROJECTS_CACHE = []; console.error(e); }
    return TK_PROJECTS_CACHE;
  }

  function tkHoursFromTimes(startVal, endVal){
    if(!startVal || !endVal){ return null; }
    var sParts = startVal.split(':'); var eParts = endVal.split(':');
    var sMin = parseInt(sParts[0],10)*60 + parseInt(sParts[1],10);
    var eMin = parseInt(eParts[0],10)*60 + parseInt(eParts[1],10);
    if(eMin <= sMin){ return 'error'; }
    var rawHours = Math.round(((eMin - sMin) / 60) * 100) / 100;
    // Demo placeholder: flat 30-min lunch deduction on exactly an 8hr shift.
    // Real lunch/break rules are unknown until client scope is confirmed —
    // this is a stand-in, not a policy.
    if(rawHours === 8){ return 7.5; }
    return rawHours;
  }

  // ---- Shared period loader: editable=true for Current Period, false for History.
  //      showNav=true shows Prev/Next arrows (Current Period); false hides them
  //      because History is driven by year/period dropdowns instead.
  async function loadTkPeriod(containerId, offset, editable, showNav){
    if(showNav === undefined){ showNav = editable; }
    var container = document.getElementById(containerId);
    var session = getSession();
    if(!session || !session.user){ return; }
    var bounds = tkPeriodBounds(offset);
    var startISO = tkDateToISO(bounds.start);
    var endISO = tkDateToISO(bounds.end);
    var projects = await tkGetProjects();

    try{
      var rows = await dbRequest('time_entries?employee_id=eq.' + session.user.id + '&work_date=gte.' + startISO + '&work_date=lte.' + endISO + '&select=*');
      var byDate = {};
      rows.forEach(function(r){ byDate[r.work_date] = r; });

      var days = [];
      for(var i=0;i<14;i++){
        days.push(new Date(bounds.start.getTime() + i*TK_DAY_MS));
      }

      // Current Period: only the period containing today is actually editable.
      // Future periods are viewable (so people can see what's coming) but
      // locked for entry until that period arrives. History stays read-only
      // regardless (editable param is false for History from the start).
      var todayOffset = tkOffsetForToday();
      var isFuturePeriod = editable && offset > todayOffset;
      var gridEditable = editable && !isFuturePeriod;

      var navHtml = '';
      if(showNav){
        var showPrev = offset > todayOffset; // only appears once they've moved forward past today's period
        var showToday = offset !== todayOffset;
        navHtml = '<div class="tk-period-nav">'
          + (showPrev ? '<button class="tk-period-nav-btn" onclick="tkNavPeriod(\'' + containerId + '\',' + (editable?1:0) + ',-1)">&larr; Prev</button>' : '')
          + (showToday ? '<button class="tk-period-nav-btn" onclick="tkGoToCurrentPeriod(\'' + containerId + '\')">Today</button>' : '')
          + '<button class="tk-period-nav-btn" onclick="tkNavPeriod(\'' + containerId + '\',' + (editable?1:0) + ',1)">Next &rarr;</button>'
          + '</div>';
      }

      var html = '<div class="tk-entry-card">'
        + '<div class="tk-period-header">'
        + '<div><div class="tk-period-label">Pay Period ' + tkPeriodNumber(offset) + (isFuturePeriod ? ' <span class="tk-status-pill draft" style="margin-left:6px;">Upcoming — view only</span>' : '') + '</div>'
        + '<div class="tk-period-dates">' + formatDate(startISO) + ' – ' + formatDate(endISO) + '</div></div>'
        + navHtml
        + '</div>'
        + '<table class="tk-grid-table"><thead><tr>'
        + '<th>Day / Date</th><th>Start</th><th>Stop</th><th>Project</th><th>Status</th><th>Hours</th>'
        + '</tr></thead><tbody>';

      var weekTotals = [0,0];
      days.forEach(function(d, idx){
        var iso = tkDateToISO(d);
        var row = byDate[iso];
        var weekIdx = idx < 7 ? 0 : 1;
        var dayLabel = d.toLocaleDateString('en-US', { weekday:'long' }) + ', ' + formatDate(iso);
        var earningType = row && row.earning_type ? row.earning_type : 'regular';
        var isLockedType = row && (row.earning_type === 'pto'); // PTO rows come from the PTO Request flow, not hand-edited here
        var rowClass = (idx === 6) ? 'tk-week-divider' : '';
        if(isLockedType){ rowClass += ' tk-day-pto'; }

        var startVal = row && row.day_start ? row.day_start.slice(0,5) : '';
        var endVal = row && row.day_end ? row.day_end.slice(0,5) : '';
        var projectVal = row && row.project_id ? row.project_id : '';
        var hours = row && row.hours != null ? row.hours : 0;
        weekTotals[weekIdx] += hours;

        var rowEditable = gridEditable && !isLockedType;
        var inputAttrs = rowEditable ? '' : 'disabled';

        var projectSelect = '<select class="tk-grid-input" id="tkg-proj-' + iso + '" ' + (rowEditable ? '' : 'disabled') + '>'
          + '<option value="">—</option>'
          + projects.map(function(p){ return '<option value="' + p.id + '"' + (p.id === projectVal ? ' selected' : '') + '>' + p.name + '</option>'; }).join('')
          + '</select>';

        var statusOptions = earningType === 'overtime'
          ? '<option value="overtime" selected>Overtime (system-assigned)</option>'
          : TK_SELECTABLE_TYPES.map(function(t){ return '<option value="' + t + '"' + (t === earningType ? ' selected' : '') + '>' + TK_TYPE_LABELS[t] + '</option>'; }).join('');
        var statusSelect = '<select class="tk-grid-input" id="tkg-type-' + iso + '" ' + (rowEditable && earningType !== 'overtime' ? '' : 'disabled') + '>'
          + statusOptions
          + '</select>';

        var startCell = rowEditable
          ? '<input type="time" class="tk-grid-input" id="tkg-start-' + iso + '" value="' + startVal + '" onchange="tkRecalcRow(\'' + iso + '\')">'
            + '<button class="tk-now-btn" type="button" onclick="tkFillNow(\'' + iso + '\',\'start\')" title="Fill current time">Now</button>'
          : '<input type="time" class="tk-grid-input" id="tkg-start-' + iso + '" value="' + startVal + '" disabled>';

        var endCell = rowEditable
          ? '<input type="time" class="tk-grid-input" id="tkg-end-' + iso + '" value="' + endVal + '" onchange="tkRecalcRow(\'' + iso + '\')">'
            + '<button class="tk-now-btn" type="button" onclick="tkFillNow(\'' + iso + '\',\'end\')" title="Fill current time">Now</button>'
          : '<input type="time" class="tk-grid-input" id="tkg-end-' + iso + '" value="' + endVal + '" disabled>';

        html += '<tr class="' + rowClass + '" data-date="' + iso + '">'
          + '<td>' + dayLabel + (row && row.status === 'approved' ? ' <span class="tk-status-pill approved" style="margin-left:6px;">Approved</span>' : '') + '</td>'
          + '<td><div class="tk-time-cell">' + startCell + '</div></td>'
          + '<td><div class="tk-time-cell">' + endCell + '</div></td>'
          + '<td>' + projectSelect + '</td>'
          + '<td>' + statusSelect + '</td>'
          + '<td><span class="tk-hours-cell" id="tkg-hours-' + iso + '">' + (hours || '—') + '</span><div class="tk-grid-row-error" id="tkg-error-' + iso + '"></div></td>'
          + '</tr>';
      });

      html += '</tbody></table>'
        + '<div class="tk-grid-footer">'
        + '<div class="tk-grid-footer-item">Week 1: <span>' + weekTotals[0].toFixed(2) + ' hrs</span></div>'
        + '<div class="tk-grid-footer-item">Week 2: <span>' + weekTotals[1].toFixed(2) + ' hrs</span></div>'
        + '<div class="tk-grid-footer-item">Total: <span>' + (weekTotals[0]+weekTotals[1]).toFixed(2) + ' hrs</span></div>'
        + '</div>';

      if(gridEditable){
        html += '<div class="tk-grid-actions">'
          + '<div class="login-error" id="tkg-save-error" style="margin-top:0;flex:1;"></div>'
          + '<button class="btn btn-primary" style="width:auto;padding:11px 20px;" onclick="saveTkPeriod(\'' + startISO + '\',\'' + endISO + '\')">Save Period</button>'
          + '</div>';
      }

      html += '</div>';
      container.innerHTML = html;
    }catch(e){
      container.innerHTML = '<div class="placeholder-card"><div class="placeholder-title">Couldn\'t load timekeeping</div><div class="placeholder-sub">Try refreshing the page.</div></div>';
      console.error(e);
    }
  }

  function tkFillNow(iso, which){
    var el = document.getElementById('tkg-' + which + '-' + iso);
    if(!el || el.disabled){ return; }
    var now = new Date();
    el.value = String(now.getHours()).padStart(2,'0') + ':' + String(now.getMinutes()).padStart(2,'0');
    tkRecalcRow(iso);
  }

  function tkNavPeriod(containerId, editableFlag, dir){
    // Only Current Period uses this now — History is driven entirely by
    // the year/period dropdowns (initTkHistory / tkHistoryPeriodChanged).
    tkCurrentPeriodOffset += dir;
    loadTkPeriod(containerId, tkCurrentPeriodOffset, true);
  }

  function tkGoToCurrentPeriod(containerId){
    tkCurrentPeriodOffset = tkOffsetForToday();
    loadTkPeriod(containerId, tkCurrentPeriodOffset, true);
  }

  // ---- History: year + period dropdowns drive which period's grid renders ----
  function tkPeriodsForYear(year){
    // Returns offsets for every period whose start date falls in the given year
    var list = [];
    var o = -12; // Period 1 (1/4/2026)
    var todayOffset = tkOffsetForToday();
    while(o <= todayOffset + 26){ // generous upper bound so future years resolve too
      var b = tkPeriodBounds(o);
      if(b.start.getFullYear() === year){ list.push(o); }
      if(b.start.getFullYear() > year){ break; }
      o++;
    }
    return list;
  }

  function initTkHistory(){
    var container = document.getElementById('tk-history');
    var todayOffset = tkOffsetForToday();
    var currentYear = tkPeriodBounds(todayOffset).start.getFullYear();
    var years = [currentYear]; // demo data only spans this year so far

    container.innerHTML = '<div class="tk-entry-card" style="margin-bottom:16px;">'
      + '<div class="tk-history-filter-grid">'
      + '<div><label class="field-label" for="tkh-year">Year</label><select id="tkh-year" class="field-input" onchange="tkHistoryYearChanged()">'
      + years.map(function(y){ return '<option value="' + y + '">' + y + '</option>'; }).join('')
      + '</select></div>'
      + '<div><label class="field-label" for="tkh-period">Pay Period</label><select id="tkh-period" class="field-input" onchange="tkHistoryPeriodChanged()"></select></div>'
      + '</div>'
      + '</div>'
      + '<div id="tkh-grid-wrap"></div>';

    tkPopulateHistoryPeriodOptions(currentYear);
    tkHistoryPeriodOffset = todayOffset; // default to most recent period on load
    var periodSelect = document.getElementById('tkh-period');
    periodSelect.value = String(todayOffset);
    loadTkPeriod('tkh-grid-wrap', todayOffset, false, false);
  }

  function tkPopulateHistoryPeriodOptions(year){
    var offsets = tkPeriodsForYear(year);
    var select = document.getElementById('tkh-period');
    select.innerHTML = offsets.map(function(o){
      var b = tkPeriodBounds(o);
      return '<option value="' + o + '">Period ' + tkPeriodNumber(o) + ' (' + formatDate(tkDateToISO(b.start)) + ' – ' + formatDate(tkDateToISO(b.end)) + ')</option>';
    }).join('');
  }

  function tkHistoryYearChanged(){
    var year = parseInt(document.getElementById('tkh-year').value, 10);
    tkPopulateHistoryPeriodOptions(year);
    tkHistoryPeriodChanged();
  }

  function tkHistoryPeriodChanged(){
    var offset = parseInt(document.getElementById('tkh-period').value, 10);
    tkHistoryPeriodOffset = offset;
    loadTkPeriod('tkh-grid-wrap', offset, false, false);
  }

  function tkRecalcRow(iso){
    var startEl = document.getElementById('tkg-start-' + iso);
    var endEl = document.getElementById('tkg-end-' + iso);
    var hoursEl = document.getElementById('tkg-hours-' + iso);
    var errorEl = document.getElementById('tkg-error-' + iso);
    if(!startEl || !endEl){ return; }
    errorEl.textContent = '';
    startEl.classList.remove('tk-input-error');
    endEl.classList.remove('tk-input-error');

    var result = tkHoursFromTimes(startEl.value, endEl.value);
    if(result === 'error'){
      errorEl.textContent = 'Stop must be after Start.';
      startEl.classList.add('tk-input-error');
      endEl.classList.add('tk-input-error');
      hoursEl.textContent = '—';
      hoursEl.dataset.invalid = '1';
    } else {
      hoursEl.textContent = result == null ? '—' : result;
      delete hoursEl.dataset.invalid;
    }
  }

  async function saveTkPeriod(startISO, endISO){
    var session = getSession();
    var saveErrorEl = document.getElementById('tkg-save-error');
    saveErrorEl.textContent = '';

    var rows = document.querySelectorAll('#tk-current tr[data-date]');
    var hasError = false;

    rows.forEach(function(tr){
      var iso = tr.dataset.date;
      var hoursEl = document.getElementById('tkg-hours-' + iso);
      if(hoursEl && hoursEl.dataset.invalid){ hasError = true; }
    });

    if(hasError){
      saveErrorEl.textContent = 'Fix invalid Start/Stop times before saving (Stop must be after Start).';
      return;
    }

    var payload = [];
    rows.forEach(function(tr){
      var iso = tr.dataset.date;
      var startEl = document.getElementById('tkg-start-' + iso);
      var endEl = document.getElementById('tkg-end-' + iso);
      var projEl = document.getElementById('tkg-proj-' + iso);
      var typeEl = document.getElementById('tkg-type-' + iso);
      if(!startEl || startEl.disabled){ return; } // skip locked rows (e.g. PTO from request flow), untouched
      if(!startEl.value && !endEl.value){ return; } // skip empty days
      var hoursResult = tkHoursFromTimes(startEl.value, endEl.value);
      if(hoursResult === 'error' || hoursResult == null){ return; }
      payload.push({
        work_date: iso,
        day_start: startEl.value,
        day_end: endEl.value,
        project_id: projEl.value || null,
        hours: hoursResult,
        earning_type: typeEl ? typeEl.value : 'regular'
      });
    });

    // System determines regular vs overtime: only rows marked 'regular' count
    // toward the 40hr/week threshold. Other types (PTO/training/travel/
    // admin/award) are excluded from OT math entirely.
    var weekRegularTotal = [0,0];
    payload.forEach(function(p){
      if(p.earning_type !== 'regular'){ return; }
      var dayIdx = Math.round((new Date(p.work_date + 'T00:00:00') - new Date(startISO + 'T00:00:00')) / TK_DAY_MS);
      var weekIdx = dayIdx < 7 ? 0 : 1;
      weekRegularTotal[weekIdx] += p.hours;
    });

    try{
      var runningWeekHours = [0,0];
      for(var i=0;i<payload.length;i++){
        var p = payload[i];
        var dayIdx = Math.round((new Date(p.work_date + 'T00:00:00') - new Date(startISO + 'T00:00:00')) / TK_DAY_MS);
        var weekIdx = dayIdx < 7 ? 0 : 1;
        var finalType = p.earning_type;

        if(p.earning_type === 'regular'){
          var before = runningWeekHours[weekIdx];
          var after = before + p.hours;
          if(before >= 40){
            finalType = 'overtime'; // entire day past the 40hr line
          } else if(after > 40){
            finalType = 'overtime'; // day pushes the week past 40 — flagged OT (whole-day granularity, no hour-splitting)
          }
          runningWeekHours[weekIdx] = after;
        }

        var existing = await dbRequest('time_entries?employee_id=eq.' + session.user.id + '&work_date=eq.' + p.work_date + '&select=id');
        var body = {
          employee_id: session.user.id,
          work_date: p.work_date,
          day_start: p.day_start,
          day_end: p.day_end,
          project_id: p.project_id,
          hours: p.hours,
          earning_type: finalType,
          status: 'submitted'
        };
        if(existing.length){
          await dbWrite('time_entries?id=eq.' + existing[0].id, 'PATCH', body);
        } else {
          await dbWrite('time_entries', 'POST', body);
        }
      }
      loadTkPeriod('tk-current', tkCurrentPeriodOffset, true);
    }catch(e){
      saveErrorEl.textContent = 'Could not save period — try again.';
      console.error(e);
    }
  }

  // ---- PTO Request ----
  async function loadPtoRequest(){
    var container = document.getElementById('tk-ptorequest');
    var session = getSession();
    if(!session || !session.user){ return; }

    try{
      var stats = await tkComputePtoStats();
      container.innerHTML = '<div class="tk-entry-card">'
        + '<div class="tk-pto-summary-row" style="margin-bottom:4px;">'
        + '<div class="tk-pto-stat-box"><div class="tk-pto-stat-label">Current Balance</div><div class="tk-pto-stat-val">' + stats.currentBalance.toFixed(2) + '</div></div>'
        + '<div class="tk-pto-stat-box"><div class="tk-pto-stat-label">Pending Balance</div><div class="tk-pto-stat-val">' + stats.pendingBalance.toFixed(2) + '</div></div>'
        + '<div class="tk-pto-stat-box"><div class="tk-pto-stat-label">Projected by Dec 31</div><div class="tk-pto-stat-val">' + stats.projectedTotal.toFixed(2) + '</div></div>'
        + '</div>'
        + '</div>'
        + '<div class="tk-entry-card">'
        + '<div class="tk-section-title">Request PTO</div>'
        + '<div class="tk-pto-form-grid">'
        + '<div><label class="field-label" for="pto-start">Start Date</label><input type="date" id="pto-start" class="field-input"></div>'
        + '<div><label class="field-label" for="pto-end">End Date</label><input type="date" id="pto-end" class="field-input"></div>'
        + '<button class="btn btn-primary" style="width:auto;padding:12px 20px;white-space:nowrap;" onclick="submitPtoRequest()">Submit Request</button>'
        + '</div>'
        + '<div class="login-error" id="pto-request-error"></div>'
        + '</div>'
        + '<div class="tk-entry-card">'
        + '<div class="tk-section-title">Pending &amp; Upcoming PTO</div>'
        + (await tkRenderUpcomingPtoTable(session.user.id))
        + '</div>';
    }catch(e){
      container.innerHTML = '<div class="placeholder-card"><div class="placeholder-title">Couldn\'t load PTO request</div><div class="placeholder-sub">Try refreshing the page.</div></div>';
      console.error(e);
    }
  }

  async function tkRenderUpcomingPtoTable(employeeId){
    var todayISO = new Date().toISOString().slice(0,10);
    var pendingRows = await dbRequest('time_entries?employee_id=eq.' + employeeId + '&earning_type=eq.pto&status=eq.pending&order=work_date.asc&select=id,work_date,hours,status');
    var approvedUpcoming = await dbRequest('time_entries?employee_id=eq.' + employeeId + '&earning_type=eq.pto&status=eq.approved&work_date=gte.' + todayISO + '&order=work_date.asc&select=id,work_date,hours,status');
    var rows = pendingRows.concat(approvedUpcoming).sort(function(a,b){ return a.work_date < b.work_date ? -1 : 1; });

    if(!rows.length){
      return '<div class="tk-empty">No pending or upcoming approved PTO.</div>';
    }
    return '<table class="tk-grid-table"><thead><tr><th>Date</th><th>Hours</th><th>Status</th><th></th></tr></thead><tbody>'
      + rows.map(function(r){
          var action = r.status === 'pending'
            ? '<button class="tk-now-btn" type="button" onclick="cancelPtoRequest(\'' + r.id + '\')">Cancel</button>'
            : '';
          return '<tr><td>' + formatDate(r.work_date) + '</td><td>' + r.hours + '</td><td>' + tkStatusPill(r.status) + '</td><td>' + action + '</td></tr>';
        }).join('')
      + '</tbody></table>';
  }

  async function cancelPtoRequest(rowId){
    try{
      await dbWrite('time_entries?id=eq.' + rowId, 'PATCH', { status: 'cancelled_by_submitter' });
      loadPtoRequest();
    }catch(e){
      console.error(e);
    }
  }

  async function tkGetTotalPendingPtoHours(excludeNew){
    var session = getSession();
    var rows = await dbRequest('time_entries?employee_id=eq.' + session.user.id + '&earning_type=eq.pto&status=eq.pending&select=hours');
    return rows.reduce(function(sum,r){ return sum + (parseFloat(r.hours)||0); }, 0);
  }

  async function submitPtoRequest(skipNegativeCheck){
    var errorEl = document.getElementById('pto-request-error');
    var session = getSession();
    var startVal = document.getElementById('pto-start').value;
    var endVal = document.getElementById('pto-end').value;
    errorEl.textContent = '';
    errorEl.innerHTML = '';

    if(!startVal || !endVal){
      errorEl.textContent = 'Enter a start and end date.';
      return;
    }
    if(new Date(endVal) < new Date(startVal)){
      errorEl.textContent = 'End date must be on or after start date.';
      return;
    }

    var d = new Date(startVal + 'T00:00:00');
    var end = new Date(endVal + 'T00:00:00');
    var requestedDays = 0;
    while(d <= end){ requestedDays++; d = new Date(d.getTime() + TK_DAY_MS); }
    var requestedHours = requestedDays * 8;

    if(!skipNegativeCheck){
      try{
        var profRows = await dbRequest('profiles?id=eq.' + session.user.id + '&select=pto_balance_hours');
        var currentBalance = profRows.length ? (parseFloat(profRows[0].pto_balance_hours) || 0) : 0;
        var existingPending = await tkGetTotalPendingPtoHours();
        var resultingBalance = currentBalance - existingPending - requestedHours;

        if(resultingBalance < 0){
          errorEl.style.color = 'var(--amber)';
          errorEl.innerHTML = 'This request (' + requestedHours.toFixed(1) + ' hrs) would put your PTO balance at ' + resultingBalance.toFixed(1) + ' hrs — below zero.'
            + ' <button class="tk-now-btn" type="button" onclick="submitPtoRequest(true)" style="margin-left:6px;">Submit Anyway</button>';
          return;
        }
      }catch(e){
        console.error(e); // if the check itself fails, fall through and let submission proceed
      }
    }

    try{
      var d2 = new Date(startVal + 'T00:00:00');
      var inserts = [];
      while(d2 <= end){
        inserts.push({
          employee_id: session.user.id,
          work_date: tkDateToISO(d2),
          hours: 8,
          earning_type: 'pto',
          status: 'pending'
        });
        d2 = new Date(d2.getTime() + TK_DAY_MS);
      }
      for(var i=0;i<inserts.length;i++){
        await dbWrite('time_entries', 'POST', inserts[i]);
      }
      document.getElementById('pto-start').value = '';
      document.getElementById('pto-end').value = '';
      errorEl.style.color = 'var(--teal)';
      errorEl.textContent = 'PTO request submitted for manager approval.';
    }catch(e){
      errorEl.style.color = 'var(--red)';
      errorEl.textContent = 'Could not submit request — try again.';
      console.error(e);
    }
  }


  async function tkComputePtoStats(){
    var session = getSession();
    var profRows = await dbRequest('profiles?id=eq.' + session.user.id + '&select=pto_balance_hours,pto_accrual_rate');
    var prof = profRows.length ? profRows[0] : { pto_balance_hours:0, pto_accrual_rate:0 };
    var currentBalance = parseFloat(prof.pto_balance_hours) || 0;
    var accrualRate = parseFloat(prof.pto_accrual_rate) || 0;

    var bounds = tkPeriodBounds(tkCurrentPeriodOffset);
    var startISO = tkDateToISO(bounds.start);
    var endISO = tkDateToISO(bounds.end);
    var ptoRows = await dbRequest('time_entries?employee_id=eq.' + session.user.id + '&earning_type=eq.pto&status=eq.pending&work_date=gte.' + startISO + '&work_date=lte.' + endISO + '&select=hours');
    var pendingPtoHours = ptoRows.reduce(function(sum,r){ return sum + (parseFloat(r.hours)||0); }, 0);
    var pendingBalance = currentBalance - pendingPtoHours;

    var todayOffset = tkOffsetForToday();
    var yearEnd = new Date(new Date().getFullYear() + '-12-31T00:00:00');
    var periodsRemaining = 0;
    var cursorOffset = todayOffset;
    while(tkPeriodBounds(cursorOffset).end <= yearEnd){
      periodsRemaining++;
      cursorOffset++;
    }
    var projectedEarn = periodsRemaining * accrualRate;
    var projectedTotal = currentBalance + projectedEarn;

    return {
      currentBalance: currentBalance,
      accrualRate: accrualRate,
      pendingBalance: pendingBalance,
      projectedEarn: projectedEarn,
      projectedTotal: projectedTotal
    };
  }

  // ---- PTO Balance ----
  async function loadPtoBalance(){
    var container = document.getElementById('tk-ptobalance');
    var session = getSession();
    if(!session || !session.user){ return; }

    try{
      var stats = await tkComputePtoStats();
      var allPtoRows = await dbRequest('time_entries?employee_id=eq.' + session.user.id + '&earning_type=eq.pto&order=work_date.desc&select=work_date,hours,status');

      var logRows = allPtoRows.length
        ? '<table class="tk-grid-table"><thead><tr><th>Date</th><th>Hours</th><th>Status</th></tr></thead><tbody>'
          + allPtoRows.map(function(r){
              return '<tr><td>' + formatDate(r.work_date) + '</td><td>' + r.hours + '</td><td>' + tkStatusPill(r.status) + '</td></tr>';
            }).join('')
          + '</tbody></table>'
        : '<div class="tk-empty">No PTO requests submitted yet.</div>';

      container.innerHTML = '<div class="tk-entry-card">'
        + '<div class="tk-section-title">PTO Balance</div>'
        + '<div class="tk-pto-balance-grid">'
        + '<div class="tk-pto-stat-box"><div class="tk-pto-stat-label">Current Balance</div><div class="tk-pto-stat-val">' + stats.currentBalance.toFixed(2) + '</div><div class="tk-pto-stat-sub">hours available</div></div>'
        + '<div class="tk-pto-stat-box"><div class="tk-pto-stat-label">Pending Balance</div><div class="tk-pto-stat-val">' + stats.pendingBalance.toFixed(2) + '</div><div class="tk-pto-stat-sub">after current period\'s unapproved PTO</div></div>'
        + '<div class="tk-pto-stat-box"><div class="tk-pto-stat-label">Accrual Rate</div><div class="tk-pto-stat-val">' + stats.accrualRate.toFixed(2) + '</div><div class="tk-pto-stat-sub">hours per pay period</div></div>'
        + '<div class="tk-pto-stat-box"><div class="tk-pto-stat-label">Projected by Dec 31</div><div class="tk-pto-stat-val">+' + stats.projectedEarn.toFixed(2) + '</div><div class="tk-pto-stat-sub">projected total: ' + stats.projectedTotal.toFixed(2) + ' hrs</div></div>'
        + '</div>'
        + '</div>'
        + '<div class="tk-entry-card">'
        + '<div class="tk-section-title">PTO Request Log</div>'
        + logRows
        + '</div>';
    }catch(e){
      container.innerHTML = '<div class="placeholder-card"><div class="placeholder-title">Couldn\'t load PTO balance</div><div class="placeholder-sub">Try refreshing the page.</div></div>';
      console.error(e);
    }
  }

