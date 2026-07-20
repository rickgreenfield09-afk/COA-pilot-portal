/* COA Employee Portal — screen-timekeeping.js
   Weekly time card (Time Code x Mon-Sun matrix), history, PTO request/
   balance, and the My Team/Admin timekeeping review functions (scope
   param, reused by screen-myteam.js and screen-admin.js). Time Code
   options come from the new time_codes table via tkGetTimeCodes() — also
   read by screen-dashboard.js (quick time entry) — load order in
   index.html keeps this file before screen-dashboard.js.
   Depends on app-core.js: getSession, dbRequest, dbWrite, dbRpc, isAdmin,
   getRecursiveReportIds.
   DCAA compliance: every submit/edit/approve/return writes a row to
   time_card_audit_log via tkLogAudit(). */

  // ---------- Timekeeping ----------
  var TK_DAY_MS = 24 * 60 * 60 * 1000;
  // Week 1 = the first full Monday-Sunday week entirely inside January 2026
  // (same "first full period inside January" convention the old biweekly
  // scheme used) — Monday 1/5/2026. Offset 0 = Week 1.
  var TK_WEEK_ANCHOR = new Date('2026-01-05T00:00:00');
  var tkCurrentWeekOffset = 0;   // 0 = week containing today
  var tkHistoryWeekOffset = -1;
  var TK_TIME_CODES_CACHE = null;
  var tkGridRowSeq = 0; // client-side unique suffix for dynamically-added blank rows


  function tkStatusPill(status){
    return '<span class="tk-status-pill ' + status + '">' + status + '</span>';
  }

  function switchTkSubtab(name){
    document.querySelectorAll('.tk-subscreen').forEach(function(s){ s.classList.remove('active'); });
    document.querySelectorAll('[data-tksubtab]').forEach(function(b){ b.classList.toggle('active', b.dataset.tksubtab === name); });
    document.getElementById('tk-' + name).classList.add('active');
    if(name === 'current'){ loadTkWeek('tk-current', tkCurrentWeekOffset, true); }
    if(name === 'history'){ initTkHistory(); }
    if(name === 'pto'){ loadPtoTab(); }
  }

  // ---- Week math ----
  function tkWeekBounds(offset){
    var start = new Date(TK_WEEK_ANCHOR.getTime() + offset * 7 * TK_DAY_MS);
    var end = new Date(start.getTime() + 6 * TK_DAY_MS);
    return { start: start, end: end };
  }

  function tkWeekNumber(offset){
    return offset + 1;
  }

  function tkWeekDays(startDate){
    var days = [];
    for(var i=0;i<7;i++){ days.push(new Date(startDate.getTime() + i*TK_DAY_MS)); }
    return days;
  }

  function tkDateToISO(d){
    return d.getFullYear() + '-' + String(d.getMonth()+1).padStart(2,'0') + '-' + String(d.getDate()).padStart(2,'0');
  }

  function tkOffsetForToday(){
    var todayUTC = new Date(new Date().toISOString().slice(0,10) + 'T00:00:00');
    var diffDays = Math.round((todayUTC - TK_WEEK_ANCHOR) / TK_DAY_MS);
    return Math.floor(diffDays / 7);
  }

  // Prints every work week from Week 1 (1/5/2026) through the week
  // containing today, to the browser console. Run printTkWeeks() from
  // devtools console to verify the calendar.
  function printTkWeeks(){
    var todayOffset = tkOffsetForToday();
    var rows = [];
    for(var o = 0; o <= todayOffset; o++){
      var b = tkWeekBounds(o);
      rows.push({ week: tkWeekNumber(o), start: tkDateToISO(b.start), end: tkDateToISO(b.end) });
    }
    console.table(rows);
    return rows;
  }

  // ---------- Time Codes (labor category / customer / CLIN-SLIN / indirect) ----------
  async function tkGetTimeCodes(){
    if(TK_TIME_CODES_CACHE){ return TK_TIME_CODES_CACHE; }
    try{
      TK_TIME_CODES_CACHE = await dbRequest('time_codes?active=eq.true&select=id,code,label,category&order=sort_order.asc,label.asc');
    }catch(e){ TK_TIME_CODES_CACHE = []; console.error(e); }
    return TK_TIME_CODES_CACHE;
  }

  // Vacation is a normal time code, but linked to the PTO Request/Balance
  // system: entering it requires a covering pending/approved PTO request
  // (see saveTkWeek's missing-PTO check). Identified by a fixed `code`
  // value rather than by label so relabeling it in time_codes doesn't
  // break the linkage.
  function tkVacationCode(codes){
    return codes.find(function(c){ return c.code === 'VACATION'; }) || null;
  }

  // ---------- Shared weekly grid (used by the employee's own Current/
  //            History card and the My Team/Admin review card) ----------
  function tkGroupEntriesByCode(entries){
    var byCode = {};
    entries.forEach(function(e){
      var key = e.time_code_id || 'none';
      if(!byCode[key]){ byCode[key] = { time_code_id: e.time_code_id, byDate: {} }; }
      byCode[key].byDate[e.work_date] = e;
    });
    return byCode;
  }

  function tkSortRowsByCodeOrder(rows, timeCodes){
    var sortIndex = {};
    timeCodes.forEach(function(c,i){ sortIndex[c.id] = i; });
    return rows.sort(function(a,b){
      return (sortIndex[a.time_code_id] != null ? sortIndex[a.time_code_id] : 999) - (sortIndex[b.time_code_id] != null ? sortIndex[b.time_code_id] : 999);
    });
  }

  function tkRowTotal(row, days){
    var total = 0;
    days.forEach(function(d){
      var e = row.byDate[tkDateToISO(d)];
      if(e && e.hours != null && e.status !== 'rejected' && e.status !== 'cancelled_by_submitter'){ total += parseFloat(e.hours) || 0; }
    });
    return total;
  }

  function tkDayTotals(rows, days){
    return days.map(function(d){
      var iso = tkDateToISO(d);
      var sum = 0;
      rows.forEach(function(row){
        var e = row.byDate[iso];
        if(e && e.hours != null && e.status !== 'rejected' && e.status !== 'cancelled_by_submitter'){ sum += parseFloat(e.hours) || 0; }
      });
      return sum;
    });
  }

  // Half-hour dropdown, 0-12hrs — guarantees a valid value, no loose minutes.
  function tkHoursOptionsHtml(selected){
    var opts = ['<option value="">—</option>'];
    for(var h=0; h<=12; h+=0.5){
      opts.push('<option value="' + h + '"' + (String(h) === String(selected) ? ' selected' : '') + '>' + h + '</option>');
    }
    return opts.join('');
  }

  // rowsIn: array of {time_code_id, byDate} from tkGroupEntriesByCode. days:
  // 7 Date objects Mon-Sun. opts.editable=true for the employee's own
  // Current week; false renders a read-only grid (History, My Team/Admin).
  // opts.showFlagToggle/opts.scope/opts.employeeId/opts.flaggedDates are
  // only used in My Team/Admin review mode (flags a whole day-column).
  function tkRenderGridTable(rowsIn, days, timeCodes, opts){
    var idBase = opts.rowIdBase;
    var editable = !!opts.editable;
    var vacation = tkVacationCode(timeCodes);
    var codesById = {};
    timeCodes.forEach(function(c){ codesById[c.id] = c; });

    var headerCells = days.map(function(d){
      var iso = tkDateToISO(d);
      var flagged = opts.flaggedDates && opts.flaggedDates[iso];
      var flagBtn = opts.showFlagToggle
        ? '<br><button class="tk-now-btn" type="button" onclick="teamTkToggleFlag(\'' + opts.scope + '\',\'' + opts.employeeId + '\',\'' + iso + '\')">' + (flagged ? 'Unflag' : 'Flag') + '</button>'
        : '';
      return '<th' + (flagged ? ' class="tk-day-flagged"' : '') + '>' + d.toLocaleDateString('en-US',{weekday:'short'}) + '<br>' + d.toLocaleDateString('en-US',{month:'numeric',day:'numeric'}) + flagBtn + '</th>';
    }).join('');

    var bodyRows = rowsIn.map(function(row, idx){
      var rowId = idBase + '-' + idx;
      var codeVal = row.time_code_id || '';
      var isVacationRow = !!(vacation && codeVal === vacation.id);
      var rowLocked = isVacationRow; // Vacation rows come from the PTO Request flow / the inline request prompt, never hand-edited once created
      var rowEditable = editable && !rowLocked;
      var hasAnySavedEntry = Object.keys(row.byDate).length > 0;

      var codeCell = editable
        ? ('<button class="tk-now-btn" type="button" onclick="tkAddGridRow(\'' + idBase + '\')" title="Add time code row">+</button> '
          + '<select class="tk-grid-input" style="display:inline-block;width:calc(100% - 34px);" id="tkg-code-' + rowId + '" ' + ((hasAnySavedEntry || rowLocked) ? 'disabled' : '') + '>'
          + '<option value="">Select time code…</option>'
          + timeCodes.map(function(c){ return '<option value="' + c.id + '"' + (c.id === codeVal ? ' selected' : '') + '>' + c.label + '</option>'; }).join('')
          + '</select>')
        : '<span>' + (codesById[codeVal] ? codesById[codeVal].label : '—') + '</span>';

      var dayCells = days.map(function(d){
        var iso = tkDateToISO(d);
        var e = row.byDate[iso];
        var hours = e && e.hours != null ? e.hours : '';
        var cellHtml;
        if(editable){
          cellHtml = '<select class="tk-grid-input" id="tkg-hours-' + rowId + '-' + iso + '" data-entry-id="' + (e ? e.id : '') + '" data-entry-hours="' + hours + '" ' + (rowEditable ? '' : 'disabled') + ' onchange="tkOnCellChange(\'' + idBase + '\')">'
            + tkHoursOptionsHtml(hours)
            + '</select>';
        } else {
          cellHtml = '<span>' + (hours === '' ? '—' : hours) + '</span>' + (e && e.status && e.status !== 'approved' ? '<br>' + tkStatusPill(e.status) : '');
        }
        return '<td>' + cellHtml + '</td>';
      }).join('');

      var removeBtn = (editable && idx > 0 && !hasAnySavedEntry && !rowLocked)
        ? '<button class="tk-now-btn" type="button" onclick="tkRemoveGridRow(\'' + rowId + '\')" title="Remove row">&minus;</button>'
        : '';

      return '<tr data-rowid="' + rowId + '">'
        + '<td>' + codeCell + '</td>'
        + dayCells
        + '<td class="tk-hours-cell">' + tkRowTotal(row, days).toFixed(2) + '</td>'
        + '<td>' + removeBtn + '</td>'
        + '</tr>';
    }).join('');

    var dayTotals = tkDayTotals(rowsIn, days);
    var footerCells = dayTotals.map(function(t){ return '<td class="tk-hours-cell">' + t.toFixed(2) + '</td>'; }).join('');
    var weekTotal = dayTotals.reduce(function(a,b){ return a+b; }, 0);

    return '<div class="tk-grid-table-wrap"><table class="tk-grid-table" id="' + idBase + '-table"><thead><tr>'
      + '<th>Time Code</th>' + headerCells + '<th>Total</th><th></th>'
      + '</tr></thead><tbody id="' + idBase + '-tbody">' + bodyRows + '</tbody>'
      + (editable ? '' : '<tfoot><tr><td><strong>Day Total</strong></td>' + footerCells + '<td class="tk-hours-cell"><strong>' + weekTotal.toFixed(2) + '</strong></td><td></td></tr></tfoot>')
      + '</table></div>';
  }

  function tkAddGridRow(idBase){
    var tbody = document.getElementById(idBase + '-tbody');
    if(!tbody){ return; }
    tkGridRowSeq++;
    var rowId = idBase + '-new' + tkGridRowSeq;
    var days = tbody.dataset.days ? JSON.parse(tbody.dataset.days) : [];
    var timeCodesJson = tbody.dataset.timeCodes ? JSON.parse(tbody.dataset.timeCodes) : [];

    var codeOptions = '<option value="">Select time code…</option>' + timeCodesJson.map(function(c){ return '<option value="' + c.id + '">' + c.label + '</option>'; }).join('');
    var dayCells = days.map(function(iso){
      return '<td><select class="tk-grid-input" id="tkg-hours-' + rowId + '-' + iso + '" data-entry-id="" data-entry-hours="" onchange="tkOnCellChange(\'' + idBase + '\')">' + tkHoursOptionsHtml('') + '</select></td>';
    }).join('');

    var rowHtml = '<tr data-rowid="' + rowId + '">'
      + '<td><button class="tk-now-btn" type="button" onclick="tkAddGridRow(\'' + idBase + '\')" title="Add time code row">+</button> '
      + '<select class="tk-grid-input" style="display:inline-block;width:calc(100% - 34px);" id="tkg-code-' + rowId + '">' + codeOptions + '</select></td>'
      + dayCells
      + '<td class="tk-hours-cell">0.00</td>'
      + '<td><button class="tk-now-btn" type="button" onclick="tkRemoveGridRow(\'' + rowId + '\')" title="Remove row">&minus;</button></td>'
      + '</tr>';
    tbody.insertAdjacentHTML('beforeend', rowHtml);
  }

  function tkRemoveGridRow(rowId){
    var tr = document.querySelector('tr[data-rowid="' + rowId + '"]');
    if(tr){ tr.remove(); }
  }

  function tkOnCellChange(idBase){
    var tbody = document.getElementById(idBase + '-tbody');
    if(!tbody){ return; }
    tbody.querySelectorAll('tr[data-rowid]').forEach(function(tr){
      var total = 0;
      tr.querySelectorAll('select[id^="tkg-hours-"]').forEach(function(sel){ total += parseFloat(sel.value) || 0; });
      var totalCell = tr.children[tr.children.length - 2];
      if(totalCell){ totalCell.textContent = total.toFixed(2); }
    });
  }

  // ---------- DCAA audit log (time_card_audit_log) ----------
  async function tkLogAudit(employeeId, weekOrDateISO, timeCodeId, action, fieldChanges, reason){
    var session = getSession();
    var changes = (fieldChanges && fieldChanges.length) ? fieldChanges : [{ field:null, oldVal:null, newVal:null }];
    for(var i=0;i<changes.length;i++){
      try{
        await dbWrite('time_card_audit_log', 'POST', {
          employee_id: employeeId,
          week_start_date: weekOrDateISO,
          time_code_id: timeCodeId || null,
          action: action,
          field_changed: changes[i].field,
          old_value: changes[i].oldVal != null ? String(changes[i].oldVal) : null,
          new_value: changes[i].newVal != null ? String(changes[i].newVal) : null,
          performed_by: session.user.id,
          reason: reason || null
        });
      }catch(e){ console.error(e); } // an audit-log write failure must never block the underlying timekeeping action
    }
  }

  // ---------- My Team (manager/admin review) ----------
  var myTeamFlagged = {}; // { employeeId: { iso: true } } — flags a whole day-column for return, keyed by employee id only; ids are unique company-wide so no scope collision risk

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
      var bounds = tkWeekBounds(todayOffset);
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
      + '<div class="tk-period-label">Week ' + tkWeekNumber(tkOffsetForToday()) + '</div>'
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
    var timeCodes = await tkGetTimeCodes();
    var entries = await dbRequest('time_entries?employee_id=eq.' + employee.id + '&work_date=gte.' + startISO + '&work_date=lte.' + endISO + '&select=*');
    var rows = tkSortRowsByCodeOrder(Object.values(tkGroupEntriesByCode(entries)), timeCodes);
    var days = tkWeekDays(new Date(startISO + 'T00:00:00'));

    if(!myTeamFlagged[employee.id]){ myTeamFlagged[employee.id] = {}; }
    var flaggedForThis = myTeamFlagged[employee.id];
    var cardId = 'myteam-card-' + employee.id;

    var tableHtml = rows.length
      ? tkRenderGridTable(rows, days, timeCodes, { editable:false, rowIdBase: cardId, scope: scope, employeeId: employee.id, flaggedDates: flaggedForThis, showFlagToggle: true })
      : '<div class="tk-empty">No time entries submitted for this week yet.</div>';

    var weekTotal = tkDayTotals(rows, days).reduce(function(a,b){ return a+b; }, 0);
    var anyFlagged = Object.keys(flaggedForThis).some(function(k){ return flaggedForThis[k]; });

    return '<div class="tk-entry-card" id="' + cardId + '">'
      + '<div class="myteam-employee-header">'
      + '<div class="myteam-employee-name">' + (employee.full_name || 'Unknown') + '</div>'
      + '<div class="myteam-employee-title">' + (employee.job_title || '—') + '</div>'
      + '</div>'
      + tableHtml
      + '<div class="tk-grid-footer"><div class="tk-grid-footer-item">Week Total: <span>' + weekTotal.toFixed(2) + ' hrs</span></div></div>'
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
      var rows = await dbRequest('time_entries?employee_id=eq.' + employeeId + '&work_date=gte.' + startISO + '&work_date=lte.' + endISO + '&select=id,time_code_id');
      var session = getSession();
      for(var i=0;i<rows.length;i++){
        await dbWrite('time_entries?id=eq.' + rows[i].id, 'PATCH', {
          status: 'approved',
          approved_by: session.user.id,
          approved_at: new Date().toISOString()
        });
        await tkLogAudit(employeeId, startISO, rows[i].time_code_id, 'approve', null, null);
      }
      // Accrue PTO once per employee per approved week, not per-row
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
          + '<input type="text" class="field-input" id="myteam-note-' + employeeId + '-' + iso + '" placeholder="Reason for returning this date"></div>';
      }).join('');
    } else {
      fieldsHtml = '<div style="margin-bottom:10px;"><label class="field-label">Note for this submission</label>'
        + '<input type="text" class="field-input" id="myteam-note-' + employeeId + '-general" placeholder="Reason for returning this week"></div>';
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
          var existing = await dbRequest('time_entries?employee_id=eq.' + employeeId + '&work_date=eq.' + iso + '&select=id,time_code_id');
          for(var e=0;e<existing.length;e++){
            await dbWrite('time_entries?id=eq.' + existing[e].id, 'PATCH', {
              status: 'rejected',
              notes: formatDate(iso) + ': ' + note,
              approved_by: session.user.id,
              approved_at: new Date().toISOString()
            });
            await tkLogAudit(employeeId, startISO, existing[e].time_code_id, 'return', [{ field:'status', oldVal:'submitted', newVal:'rejected' }], note);
          }
        }
      } else {
        var noteEl2 = document.getElementById('myteam-note-' + employeeId + '-general');
        var note2 = noteEl2 ? noteEl2.value : '';
        var rows = await dbRequest('time_entries?employee_id=eq.' + employeeId + '&work_date=gte.' + startISO + '&work_date=lte.' + endISO + '&select=id,time_code_id');
        for(var j=0;j<rows.length;j++){
          await dbWrite('time_entries?id=eq.' + rows[j].id, 'PATCH', {
            status: 'rejected',
            notes: note2,
            approved_by: session.user.id,
            approved_at: new Date().toISOString()
          });
          await tkLogAudit(employeeId, startISO, rows[j].time_code_id, 'return', [{ field:'status', oldVal:'submitted', newVal:'rejected' }], note2);
        }
      }
      delete myTeamFlagged[employeeId];
      teamTkRenderCurrentCard(scope);
    }catch(e){
      errorEl.textContent = 'Could not submit return — try again.';
      console.error(e);
    }
  }


  // ---- Shared week loader: editable=true for Current week, false for History.
  //      showNav=true shows Prev/Next arrows (Current week); false hides them
  //      because History is driven by year/week dropdowns instead.
  async function loadTkWeek(containerId, offset, editable, showNav){
    if(showNav === undefined){ showNav = editable; }
    var container = document.getElementById(containerId);
    var session = getSession();
    if(!session || !session.user){ return; }
    var bounds = tkWeekBounds(offset);
    var startISO = tkDateToISO(bounds.start);
    var endISO = tkDateToISO(bounds.end);
    var timeCodes = await tkGetTimeCodes();

    try{
      var entries = await dbRequest('time_entries?employee_id=eq.' + session.user.id + '&work_date=gte.' + startISO + '&work_date=lte.' + endISO + '&select=*');
      var rows = tkSortRowsByCodeOrder(Object.values(tkGroupEntriesByCode(entries)), timeCodes);
      var days = tkWeekDays(bounds.start);

      // Current week: only the week containing today is actually editable.
      // Future weeks are viewable (so people can see what's coming) but
      // locked for entry until that week arrives. History stays read-only
      // regardless (editable param is false for History from the start).
      var todayOffset = tkOffsetForToday();
      var isFutureWeek = editable && offset > todayOffset;
      var gridEditable = editable && !isFutureWeek;

      if(gridEditable && rows.length === 0){
        rows = [{ time_code_id: '', byDate: {} }]; // one blank row by default on a brand-new week
      }

      var navHtml = '';
      if(showNav){
        var showPrev = offset > todayOffset; // only appears once they've moved forward past today's week
        var showToday = offset !== todayOffset;
        navHtml = '<div class="tk-period-nav">'
          + (showPrev ? '<button class="tk-period-nav-btn" onclick="tkNavWeek(\'' + containerId + '\',' + (editable?1:0) + ',-1)">&larr; Prev</button>' : '')
          + (showToday ? '<button class="tk-period-nav-btn" onclick="tkGoToCurrentWeek(\'' + containerId + '\')">Today</button>' : '')
          + '<button class="tk-period-nav-btn" onclick="tkNavWeek(\'' + containerId + '\',' + (editable?1:0) + ',1)">Next &rarr;</button>'
          + '</div>';
      }

      var idBase = containerId + '-grid';
      var tableHtml = tkRenderGridTable(rows, days, timeCodes, { editable: gridEditable, rowIdBase: idBase });
      var weekTotal = tkDayTotals(rows, days).reduce(function(a,b){ return a+b; }, 0);

      var html = '<div class="tk-entry-card">'
        + '<div class="tk-period-header">'
        + '<div><div class="tk-period-label">Week ' + tkWeekNumber(offset) + (isFutureWeek ? ' <span class="tk-status-pill draft" style="margin-left:6px;">Upcoming — view only</span>' : '') + '</div>'
        + '<div class="tk-period-dates">' + formatDate(startISO) + ' – ' + formatDate(endISO) + '</div></div>'
        + navHtml
        + '</div>'
        + tableHtml
        + (gridEditable ? '' : '<div class="tk-grid-footer"><div class="tk-grid-footer-item">Week Total: <span>' + weekTotal.toFixed(2) + ' hrs</span></div></div>')
        + '<div id="tkg-missing-pto-panel"></div>';

      if(gridEditable){
        html += '<div class="tk-grid-actions">'
          + '<div class="login-error" id="tkg-save-error" style="margin-top:0;flex:1;"></div>'
          + '<button class="btn btn-primary" style="width:auto;padding:11px 20px;" onclick="saveTkWeek(\'' + startISO + '\',\'' + endISO + '\',\'' + containerId + '\')">Save Week</button>'
          + '</div>';
      }
      html += '</div>';
      container.innerHTML = html;

      var tbody = document.getElementById(idBase + '-tbody');
      if(tbody){
        tbody.dataset.days = JSON.stringify(days.map(tkDateToISO));
        tbody.dataset.timeCodes = JSON.stringify(timeCodes.map(function(c){ return { id: c.id, label: c.label }; }));
      }
    }catch(e){
      container.innerHTML = '<div class="placeholder-card"><div class="placeholder-title">Couldn\'t load timekeeping</div><div class="placeholder-sub">Try refreshing the page.</div></div>';
      console.error(e);
    }
  }

  function tkNavWeek(containerId, editableFlag, dir){
    // Only Current week uses this now — History is driven entirely by
    // the year/week dropdowns (initTkHistory / tkHistoryWeekChanged).
    tkCurrentWeekOffset += dir;
    loadTkWeek(containerId, tkCurrentWeekOffset, true);
  }

  function tkGoToCurrentWeek(containerId){
    tkCurrentWeekOffset = tkOffsetForToday();
    loadTkWeek(containerId, tkCurrentWeekOffset, true);
  }

  // ---- History: year + week dropdowns drive which week's grid renders ----
  function tkWeeksForYear(year){
    // Returns offsets for every week whose start date falls in the given year
    var list = [];
    var o = 0; // Week 1 (1/5/2026)
    var todayOffset = tkOffsetForToday();
    while(o <= todayOffset + 53){ // generous upper bound so future years resolve too
      var b = tkWeekBounds(o);
      if(b.start.getFullYear() === year){ list.push(o); }
      if(b.start.getFullYear() > year){ break; }
      o++;
    }
    return list;
  }

  function initTkHistory(){
    var container = document.getElementById('tk-history');
    var todayOffset = tkOffsetForToday();
    var currentYear = tkWeekBounds(todayOffset).start.getFullYear();
    var years = [currentYear]; // demo data only spans this year so far

    container.innerHTML = '<div class="tk-entry-card" style="margin-bottom:16px;">'
      + '<div class="tk-history-filter-grid">'
      + '<div><label class="field-label" for="tkh-year">Year</label><select id="tkh-year" class="field-input" onchange="tkHistoryYearChanged()">'
      + years.map(function(y){ return '<option value="' + y + '">' + y + '</option>'; }).join('')
      + '</select></div>'
      + '<div><label class="field-label" for="tkh-week">Week</label><select id="tkh-week" class="field-input" onchange="tkHistoryWeekChanged()"></select></div>'
      + '</div>'
      + '</div>'
      + '<div id="tkh-grid-wrap"></div>';

    tkPopulateHistoryWeekOptions(currentYear);
    tkHistoryWeekOffset = todayOffset; // default to most recent week on load
    var weekSelect = document.getElementById('tkh-week');
    weekSelect.value = String(todayOffset);
    loadTkWeek('tkh-grid-wrap', todayOffset, false, false);
  }

  function tkPopulateHistoryWeekOptions(year){
    var offsets = tkWeeksForYear(year);
    var select = document.getElementById('tkh-week');
    select.innerHTML = offsets.map(function(o){
      var b = tkWeekBounds(o);
      return '<option value="' + o + '">Week ' + tkWeekNumber(o) + ' (' + formatDate(tkDateToISO(b.start)) + ' – ' + formatDate(tkDateToISO(b.end)) + ')</option>';
    }).join('');
  }

  function tkHistoryYearChanged(){
    var year = parseInt(document.getElementById('tkh-year').value, 10);
    tkPopulateHistoryWeekOptions(year);
    tkHistoryWeekChanged();
  }

  function tkHistoryWeekChanged(){
    var offset = parseInt(document.getElementById('tkh-week').value, 10);
    tkHistoryWeekOffset = offset;
    loadTkWeek('tkh-grid-wrap', offset, false, false);
  }

  async function saveTkWeek(startISO, endISO, containerId){
    var session = getSession();
    var saveErrorEl = document.getElementById('tkg-save-error');
    if(saveErrorEl){ saveErrorEl.textContent = ''; }
    var missingPtoPanel = document.getElementById('tkg-missing-pto-panel');
    if(missingPtoPanel){ missingPtoPanel.innerHTML = ''; }

    var gridIdBase = containerId + '-grid';
    var timeCodes = await tkGetTimeCodes();
    var vacation = tkVacationCode(timeCodes);
    var codesById = {};
    timeCodes.forEach(function(c){ codesById[c.id] = c; });

    var rowEls = document.querySelectorAll('#' + gridIdBase + '-tbody tr[data-rowid]');
    var days = tkWeekDays(new Date(startISO + 'T00:00:00'));

    // Block the save if any row has hours entered but no Time Code picked —
    // otherwise those hours would silently be dropped rather than saved.
    var codelessButHasHours = false;
    rowEls.forEach(function(tr){
      var codeSel = document.getElementById('tkg-code-' + tr.dataset.rowid);
      if(codeSel && !codeSel.value){
        days.forEach(function(d){
          var cellEl = document.getElementById('tkg-hours-' + tr.dataset.rowid + '-' + tkDateToISO(d));
          if(cellEl && cellEl.value !== '' && parseFloat(cellEl.value) > 0){ codelessButHasHours = true; }
        });
      }
    });
    if(codelessButHasHours){
      if(saveErrorEl){ saveErrorEl.textContent = 'Select a Time Code for every row that has hours entered.'; }
      return;
    }

    var writes = []; // {action: insert|update|delete, id, work_date, time_code_id, hours, oldHours}
    var missingPto = []; // Vacation entries with no covering PTO request yet

    rowEls.forEach(function(tr){
      var rowId = tr.dataset.rowid;
      var codeSel = document.getElementById('tkg-code-' + rowId);
      if(!codeSel || !codeSel.value){ return; }
      var codeId = codeSel.value;
      var isVacation = !!(vacation && codeId === vacation.id);

      days.forEach(function(d){
        var iso = tkDateToISO(d);
        var cellEl = document.getElementById('tkg-hours-' + rowId + '-' + iso);
        if(!cellEl || cellEl.disabled){ return; }
        var existingId = cellEl.dataset.entryId || '';
        var existingHours = cellEl.dataset.entryHours || '';
        var val = cellEl.value;
        if(val === existingHours){ return; } // unchanged
        if(val === '' || parseFloat(val) === 0){
          if(existingId){ writes.push({ action:'delete', id: existingId, work_date: iso, time_code_id: codeId, oldHours: existingHours }); }
          return;
        }
        if(isVacation && !existingId){
          missingPto.push({ iso: iso, hours: val });
          return;
        }
        writes.push({ action: existingId ? 'update' : 'insert', id: existingId, work_date: iso, time_code_id: codeId, hours: parseFloat(val), oldHours: existingHours });
      });
    });

    if(missingPto.length){
      renderMissingPtoPanel(missingPto, containerId);
      if(saveErrorEl){ saveErrorEl.textContent = 'Some Vacation entries need a PTO request before they can be saved (see below).'; }
      return;
    }

    // System determines regular vs overtime for billable (gov_contract /
    // commercial_customer) time codes only — indirect codes (B&P, BD,
    // Holiday, Vacation, etc.) never generate OT. Whole-day granularity: a
    // row that pushes the week's billable regular hours past 40 is flagged
    // overtime in full, same rule as the old biweekly system used per-week.
    writes.sort(function(a,b){ return a.work_date < b.work_date ? -1 : (a.work_date > b.work_date ? 1 : 0); });
    var runningBillableHours = 0;
    writes.forEach(function(w){
      if(w.action === 'delete'){ w.earning_type = null; return; }
      var code = codesById[w.time_code_id];
      var billable = code && (code.category === 'gov_contract' || code.category === 'commercial_customer');
      if(!billable){ w.earning_type = null; return; }
      var before = runningBillableHours;
      var after = before + w.hours;
      w.earning_type = (before >= 40 || after > 40) ? 'overtime' : 'regular';
      runningBillableHours = after;
    });

    try{
      for(var i=0;i<writes.length;i++){
        var w = writes[i];
        if(w.action === 'delete'){
          await dbWrite('time_entries?id=eq.' + w.id, 'DELETE');
          await tkLogAudit(session.user.id, startISO, w.time_code_id, 'edit', [{ field:'hours', oldVal: w.oldHours, newVal: null }]);
        } else if(w.action === 'update'){
          await dbWrite('time_entries?id=eq.' + w.id, 'PATCH', { hours: w.hours, earning_type: w.earning_type, status: 'submitted' });
          await tkLogAudit(session.user.id, startISO, w.time_code_id, 'edit', [{ field:'hours', oldVal: w.oldHours, newVal: w.hours }]);
        } else {
          await dbWrite('time_entries', 'POST', {
            employee_id: session.user.id,
            work_date: w.work_date,
            time_code_id: w.time_code_id,
            hours: w.hours,
            earning_type: w.earning_type,
            status: 'submitted'
          });
          await tkLogAudit(session.user.id, startISO, w.time_code_id, 'submit', [{ field:'hours', oldVal: null, newVal: w.hours }]);
        }
      }
      loadTkWeek(containerId, tkCurrentWeekOffset, true);
    }catch(e){
      if(saveErrorEl){ saveErrorEl.textContent = 'Could not save week — try again.'; }
      console.error(e);
    }
  }

  function renderMissingPtoPanel(missingPto, containerId){
    var panel = document.getElementById('tkg-missing-pto-panel');
    if(!panel){ return; }
    panel.innerHTML = '<div class="myteam-return-box">'
      + '<div class="tk-section-title">Vacation Needs a PTO Request</div>'
      + '<div class="tk-empty" style="padding:0 0 10px;">These Vacation entries don\'t have an approved or pending PTO request covering them yet. Submit a request for each date to continue, or clear the entry and save without it.</div>'
      + missingPto.map(function(m, idx){
          return '<div style="display:flex;gap:10px;align-items:end;margin-bottom:10px;">'
            + '<div><label class="field-label">' + formatDate(m.iso) + '</label><input type="text" inputmode="decimal" class="field-input" id="mpto-hours-' + idx + '" value="' + m.hours + '" style="width:80px;"></div>'
            + '<button class="btn btn-primary" style="width:auto;padding:9px 16px;" onclick="submitInlinePtoRequest(\'' + m.iso + '\',' + idx + ',\'' + containerId + '\')">Submit PTO Request</button>'
            + '<div class="login-error" id="mpto-error-' + idx + '" style="margin-top:0;"></div>'
            + '</div>';
        }).join('')
      + '</div>';
  }

  async function submitInlinePtoRequest(iso, idx, containerId){
    var hoursEl = document.getElementById('mpto-hours-' + idx);
    var errorEl = document.getElementById('mpto-error-' + idx);
    var hours = parseFloat(hoursEl.value);
    errorEl.textContent = '';
    if(!hours || hours <= 0){ errorEl.textContent = 'Enter valid hours.'; return; }

    var session = getSession();
    if(!hoursEl.dataset.confirmedAnyway){
      var warning = await tkCheckPtoBalance(hours);
      if(warning){
        errorEl.innerHTML = warning + ' <button class="tk-now-btn" type="button" onclick="submitInlinePtoRequest(\'' + iso + '\',' + idx + ',\'' + containerId + '\')">Submit Anyway</button>';
        hoursEl.dataset.confirmedAnyway = '1';
        return;
      }
    }
    try{
      var timeCodes = await tkGetTimeCodes();
      var vacation = tkVacationCode(timeCodes);
      if(!vacation){ errorEl.textContent = 'Vacation time code is not configured — contact an admin.'; return; }
      await dbWrite('time_entries', 'POST', {
        employee_id: session.user.id,
        work_date: iso,
        time_code_id: vacation.id,
        hours: hours,
        status: 'pending'
      });
      await tkLogAudit(session.user.id, iso, vacation.id, 'submit', [{ field:'hours', oldVal:null, newVal:hours }], 'Inline PTO request submitted from time card');
      loadTkWeek(containerId, tkCurrentWeekOffset, true);
    }catch(e){
      errorEl.textContent = 'Could not submit request — try again.';
      console.error(e);
    }
  }

  // ---- PTO (merged Request + Balance: stat row + 75/25 request/gallery split) ----
  var tkPtoSelectedId = null; // gallery item id shown in detail view; null = the new-request builder
  var tkPtoDayRowSeq = 0;

  async function loadPtoTab(){
    var container = document.getElementById('tk-pto');
    var session = getSession();
    if(!session || !session.user){ return; }

    try{
      var stats = await tkComputePtoStats();
      tkPtoSelectedId = null;
      container.innerHTML = '<div class="tk-entry-card">'
        + '<div class="tk-pto-summary-row">'
        + '<div class="tk-pto-stat-box"><div class="tk-pto-stat-label">Current Balance</div><div class="tk-pto-stat-val">' + stats.currentBalance.toFixed(2) + '</div></div>'
        + '<div class="tk-pto-stat-box"><div class="tk-pto-stat-label">Pending Balance</div><div class="tk-pto-stat-val">' + stats.pendingBalance.toFixed(2) + '</div></div>'
        + '<div class="tk-pto-stat-box"><div class="tk-pto-stat-label">Accrual Rate</div><div class="tk-pto-stat-val">' + stats.accrualRate.toFixed(2) + '</div><div class="tk-pto-stat-sub">hours per week</div></div>'
        + '<div class="tk-pto-stat-box"><div class="tk-pto-stat-label">Projected by Dec 31</div><div class="tk-pto-stat-val">' + stats.projectedTotal.toFixed(2) + '</div></div>'
        + '</div>'
        + '</div>'
        + '<div class="tk-pto-layout">'
        + '<div id="tk-pto-main"></div>'
        + '<div class="tk-entry-card" id="tk-pto-gallery"><div class="tk-section-title">PTO Requests</div><div id="tk-pto-gallery-list"></div></div>'
        + '</div>';

      await renderPtoRequestBuilder();
      await renderPtoGallery(session.user.id);
    }catch(e){
      container.innerHTML = '<div class="placeholder-card"><div class="placeholder-title">Couldn\'t load PTO</div><div class="placeholder-sub">Try refreshing the page.</div></div>';
      console.error(e);
    }
  }

  // Gallery lists individual PTO day-entries (pending/approved/historical),
  // not grouped multi-day "requests" — the data model stores one row per
  // employee/date/time_code, and a free-form request can span non-
  // contiguous days, so there's no natural request-level grouping key yet.
  async function renderPtoGallery(employeeId){
    var listEl = document.getElementById('tk-pto-gallery-list');
    if(!listEl){ return; }
    var timeCodes = await tkGetTimeCodes();
    var vacation = tkVacationCode(timeCodes);
    var rows = vacation
      ? await dbRequest('time_entries?employee_id=eq.' + employeeId + '&time_code_id=eq.' + vacation.id + '&order=work_date.desc&select=id,work_date,hours,status')
      : [];

    if(!rows.length){
      listEl.innerHTML = '<div class="tk-empty">No PTO requests submitted yet.</div>';
      return;
    }
    listEl.innerHTML = rows.map(function(r){
      var selected = tkPtoSelectedId === r.id;
      return '<div class="tk-pto-gallery-item' + (selected ? ' selected' : '') + '" onclick="selectPtoGalleryItem(\'' + r.id + '\')">'
        + '<div class="tk-pto-gallery-date">' + formatDate(r.work_date) + '</div>'
        + '<div class="tk-pto-gallery-meta">' + r.hours + ' hrs ' + tkStatusPill(r.status) + '</div>'
        + '</div>';
    }).join('');
  }

  async function selectPtoGalleryItem(rowId){
    tkPtoSelectedId = rowId;
    var session = getSession();
    await renderPtoGallery(session.user.id);

    var rows = await dbRequest('time_entries?id=eq.' + rowId + '&select=id,work_date,hours,status');
    var row = rows[0];
    var mainEl = document.getElementById('tk-pto-main');
    if(!row || !mainEl){ return; }

    mainEl.innerHTML = '<div class="tk-entry-card">'
      + '<div class="tk-section-title">PTO Request Detail</div>'
      + '<div class="tk-pto-detail-row"><span>Date</span><strong>' + formatDate(row.work_date) + '</strong></div>'
      + '<div class="tk-pto-detail-row"><span>Hours</span><strong>' + row.hours + '</strong></div>'
      + '<div class="tk-pto-detail-row"><span>Status</span>' + tkStatusPill(row.status) + '</div>'
      + '<div class="tk-grid-actions" style="margin-top:16px;">'
      + '<button class="tk-now-btn" type="button" onclick="clearPtoSelection()">New Request</button>'
      + (row.status === 'pending' ? '<button class="btn-logout" style="width:auto;" onclick="cancelPtoRequest(\'' + row.id + '\')">Cancel Request</button>' : '')
      + '</div>'
      + '</div>';
  }

  async function clearPtoSelection(){
    tkPtoSelectedId = null;
    var session = getSession();
    await renderPtoGallery(session.user.id);
    await renderPtoRequestBuilder();
  }

  // Free-form day builder: add/remove (date, hours) rows so a single
  // request can cover non-contiguous days with different hours each
  // (e.g. 4hrs today, 8hrs Tue/Wed, 4hrs Thu). One blank row by default;
  // the first row can't be removed (same rule as the timesheet grid).
  // tkPtoBuilderBaseline caches the balance figures needed to live-update
  // the Total Hours / Balance After Approval boxes as rows change, without
  // re-querying Supabase on every keystroke.
  var tkPtoBuilderBaseline = { currentBalance: 0, existingPending: 0 };

  async function renderPtoRequestBuilder(){
    var mainEl = document.getElementById('tk-pto-main');
    if(!mainEl){ return; }
    tkPtoDayRowSeq = 0;

    var session = getSession();
    try{
      var profRows = await dbRequest('profiles?id=eq.' + session.user.id + '&select=pto_balance_hours');
      tkPtoBuilderBaseline.currentBalance = profRows.length ? (parseFloat(profRows[0].pto_balance_hours) || 0) : 0;
      tkPtoBuilderBaseline.existingPending = await tkGetTotalPendingPtoHours();
    }catch(e){ console.error(e); }

    mainEl.innerHTML = '<div class="tk-entry-card">'
      + '<div class="tk-section-title">Request PTO</div>'
      + '<table class="tk-grid-table"><thead><tr><th>Date</th><th>Hours</th></tr></thead>'
      + '<tbody id="pto-day-rows"></tbody></table>'
      + '<button class="tk-now-btn" type="button" style="margin-top:10px;" onclick="addPtoDayRow()">+ Add Day</button>'
      + '<div class="tk-pto-request-totals">'
      + '<div class="tk-pto-stat-box"><div class="tk-pto-stat-label">Total Hours Requested</div><div class="tk-pto-stat-val" id="pto-request-total-hours">0.00</div></div>'
      + '<div class="tk-pto-stat-box"><div class="tk-pto-stat-label">Balance After Approval</div><div class="tk-pto-stat-val" id="pto-request-balance-after">' + tkPtoBuilderBaseline.currentBalance.toFixed(2) + '</div></div>'
      + '</div>'
      + '<div class="login-error" id="pto-request-error" style="margin-top:12px;"></div>'
      + '<div class="tk-grid-actions"><button class="btn btn-primary" style="width:auto;padding:11px 20px;" onclick="submitPtoRequest()">Submit Request</button></div>'
      + '</div>';
    addPtoDayRow();
  }

  function addPtoDayRow(){
    var tbody = document.getElementById('pto-day-rows');
    if(!tbody){ return; }
    tkPtoDayRowSeq++;
    var rowId = 'ptoday-' + tkPtoDayRowSeq;
    var isFirst = tbody.children.length === 0;
    var rowHtml = '<tr data-rowid="' + rowId + '">'
      + '<td><input type="date" class="field-input" id="' + rowId + '-date"></td>'
      + '<td><div class="tk-pto-hours-cell"><input type="text" inputmode="decimal" class="field-input" id="' + rowId + '-hours" value="8" style="width:80px;" oninput="recalcPtoRequestTotals()">'
        + (isFirst ? '' : '<button class="tk-now-btn" type="button" onclick="removePtoDayRow(\'' + rowId + '\')">&minus;</button>')
        + '</div></td>'
      + '</tr>';
    tbody.insertAdjacentHTML('beforeend', rowHtml);
    recalcPtoRequestTotals();
  }

  function removePtoDayRow(rowId){
    var tr = document.querySelector('#pto-day-rows tr[data-rowid="' + rowId + '"]');
    if(tr){ tr.remove(); }
    recalcPtoRequestTotals();
  }

  function recalcPtoRequestTotals(){
    var totalEl = document.getElementById('pto-request-total-hours');
    var balanceEl = document.getElementById('pto-request-balance-after');
    if(!totalEl || !balanceEl){ return; }
    var total = 0;
    document.querySelectorAll('#pto-day-rows tr[data-rowid]').forEach(function(tr){
      var hoursEl = document.getElementById(tr.dataset.rowid + '-hours');
      if(hoursEl){ total += parseFloat(hoursEl.value) || 0; }
    });
    var balanceAfter = tkPtoBuilderBaseline.currentBalance - tkPtoBuilderBaseline.existingPending - total;
    totalEl.textContent = total.toFixed(2);
    balanceEl.textContent = balanceAfter.toFixed(2);
    balanceEl.style.color = balanceAfter < 0 ? 'var(--red)' : '';
  }

  async function cancelPtoRequest(rowId){
    try{
      await dbWrite('time_entries?id=eq.' + rowId, 'PATCH', { status: 'cancelled_by_submitter' });
      loadPtoTab();
    }catch(e){
      console.error(e);
    }
  }

  async function tkGetTotalPendingPtoHours(){
    var session = getSession();
    var timeCodes = await tkGetTimeCodes();
    var vacation = tkVacationCode(timeCodes);
    if(!vacation){ return 0; }
    var rows = await dbRequest('time_entries?employee_id=eq.' + session.user.id + '&time_code_id=eq.' + vacation.id + '&status=eq.pending&select=hours');
    return rows.reduce(function(sum,r){ return sum + (parseFloat(r.hours)||0); }, 0);
  }

  // Shared negative-balance warning, used by both the main Request PTO form
  // and the inline "submit a PTO request now" prompt triggered from the
  // time card's Vacation guard. Per user's call: negative-balance requests
  // are still allowed via "Submit Anyway" — no hard block — pending a
  // policy decision from the team.
  async function tkCheckPtoBalance(requestedHours){
    var session = getSession();
    try{
      var profRows = await dbRequest('profiles?id=eq.' + session.user.id + '&select=pto_balance_hours');
      var currentBalance = profRows.length ? (parseFloat(profRows[0].pto_balance_hours) || 0) : 0;
      var existingPending = await tkGetTotalPendingPtoHours();
      var resultingBalance = currentBalance - existingPending - requestedHours;
      if(resultingBalance < 0){
        return 'This request (' + requestedHours.toFixed(1) + ' hrs) would put your PTO balance at ' + resultingBalance.toFixed(1) + ' hrs — below zero.';
      }
    }catch(e){ console.error(e); } // if the check itself fails, fall through and let submission proceed
    return null;
  }

  async function submitPtoRequest(skipNegativeCheck){
    var errorEl = document.getElementById('pto-request-error');
    var session = getSession();
    errorEl.textContent = '';
    errorEl.innerHTML = '';

    var dayRowEls = document.querySelectorAll('#pto-day-rows tr[data-rowid]');
    var days = [];
    var hasInvalid = false;
    dayRowEls.forEach(function(tr){
      var rowId = tr.dataset.rowid;
      var dateVal = document.getElementById(rowId + '-date').value;
      var hoursVal = parseFloat(document.getElementById(rowId + '-hours').value);
      if(!dateVal || !hoursVal || hoursVal <= 0){ hasInvalid = true; return; }
      days.push({ date: dateVal, hours: hoursVal });
    });

    if(!days.length || hasInvalid){
      errorEl.textContent = 'Enter a valid date and hours for each day.';
      return;
    }
    var seenDates = {};
    for(var k=0;k<days.length;k++){
      if(seenDates[days[k].date]){ errorEl.textContent = 'Each day can only appear once in a request.'; return; }
      seenDates[days[k].date] = true;
    }

    var requestedHours = days.reduce(function(sum,d){ return sum + d.hours; }, 0);

    if(!skipNegativeCheck){
      var warning = await tkCheckPtoBalance(requestedHours);
      if(warning){
        errorEl.style.color = 'var(--amber)';
        errorEl.innerHTML = warning + ' <button class="tk-now-btn" type="button" onclick="submitPtoRequest(true)" style="margin-left:6px;">Submit Anyway</button>';
        return;
      }
    }

    try{
      var timeCodes = await tkGetTimeCodes();
      var vacation = tkVacationCode(timeCodes);
      if(!vacation){ errorEl.textContent = 'Vacation time code is not configured — contact an admin.'; return; }
      for(var i=0;i<days.length;i++){
        await dbWrite('time_entries', 'POST', {
          employee_id: session.user.id,
          work_date: days[i].date,
          time_code_id: vacation.id,
          hours: days[i].hours,
          status: 'pending'
        });
        await tkLogAudit(session.user.id, days[i].date, vacation.id, 'submit', [{ field:'hours', oldVal:null, newVal:days[i].hours }]);
      }
      loadPtoTab();
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

    var timeCodes = await tkGetTimeCodes();
    var vacation = tkVacationCode(timeCodes);
    var bounds = tkWeekBounds(tkCurrentWeekOffset);
    var startISO = tkDateToISO(bounds.start);
    var endISO = tkDateToISO(bounds.end);
    var pendingPtoHours = 0;
    if(vacation){
      var ptoRows = await dbRequest('time_entries?employee_id=eq.' + session.user.id + '&time_code_id=eq.' + vacation.id + '&status=eq.pending&work_date=gte.' + startISO + '&work_date=lte.' + endISO + '&select=hours');
      pendingPtoHours = ptoRows.reduce(function(sum,r){ return sum + (parseFloat(r.hours)||0); }, 0);
    }
    var pendingBalance = currentBalance - pendingPtoHours;

    var todayOffset = tkOffsetForToday();
    var yearEnd = new Date(new Date().getFullYear() + '-12-31T00:00:00');
    var weeksRemaining = 0;
    var cursorOffset = todayOffset;
    while(tkWeekBounds(cursorOffset).end <= yearEnd){
      weeksRemaining++;
      cursorOffset++;
    }
    // NOTE: pto_accrual_rate previously meant "hours per (biweekly) pay
    // period." Periods are now weekly — if that column still holds the old
    // biweekly rate, this projection will overstate accrual by 2x. Confirm
    // with payroll/HR whether pto_accrual_rate needs to be halved as part
    // of this rollout (flagged in ssp-log.md).
    var projectedEarn = weeksRemaining * accrualRate;
    var projectedTotal = currentBalance + projectedEarn;

    return {
      currentBalance: currentBalance,
      accrualRate: accrualRate,
      pendingBalance: pendingBalance,
      projectedEarn: projectedEarn,
      projectedTotal: projectedTotal
    };
  }

