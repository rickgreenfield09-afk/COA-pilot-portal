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
  // tkOffsetForToday() is a function declaration (hoisted), so it's safe to
  // call here even though it's defined later in this file — this was
  // previously hardcoded to 0 (Week 1), which only looked right by
  // coincidence if TK_WEEK_ANCHOR happened to match "today" at build time.
  var tkCurrentWeekOffset = tkOffsetForToday();
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
    tkRenderSimEntry();
    tkRenderSimBanner();
    tkRenderSimWizard();
    if(name === 'current'){ tkLoadCurrentTab(); }
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

  // tkSimMode/TK_SIM_TODAY_ISO are declared further down (Timekeeping
  // Simulation Mode) but safe to reference here — by the time this is
  // actually called, the whole script has finished its top-level init.
  function tkOffsetForToday(){
    var todayISO = tkSimMode ? TK_SIM_TODAY_ISO : new Date().toISOString().slice(0,10);
    var todayUTC = new Date(todayISO + 'T00:00:00');
    var diffDays = Math.round((todayUTC - TK_WEEK_ANCHOR) / TK_DAY_MS);
    return Math.floor(diffDays / 7);
  }

  // ---- Semi-monthly pay periods (1st-15th, 16th-end of month) ----
  // Independent of the Mon-Sun week grid above (TK_WEEK_ANCHOR) — periods
  // are the payroll/certification unit, weeks are just the entry grid.
  function tkPeriodBounds(d){
    var year = d.getFullYear(), month = d.getMonth();
    if(d.getDate() <= 15){
      return { start: new Date(year, month, 1), end: new Date(year, month, 15) };
    }
    return { start: new Date(year, month, 16), end: new Date(year, month + 1, 0) };
  }

  function tkCurrentPeriodBounds(){
    return tkPeriodBounds(tkSimMode ? new Date(TK_SIM_TODAY_ISO + 'T00:00:00') : new Date());
  }

  // Walks whole periods (each "half-month" is one unit: 1st or 16th) —
  // offset 0 = the period containing today, -1 = the previous period, etc.
  // Used by the admin/My Team Pay Period review nav.
  function tkPeriodBoundsOffset(offset){
    var cur = tkCurrentPeriodBounds();
    var halfIndex = cur.start.getFullYear() * 24 + cur.start.getMonth() * 2 + (cur.start.getDate() === 1 ? 0 : 1) + offset;
    var year = Math.floor(halfIndex / 24);
    var rem = halfIndex - year * 24;
    var month = Math.floor(rem / 2);
    var day = (rem % 2 === 0) ? 1 : 16;
    return tkPeriodBounds(new Date(year, month, day));
  }

  // Every calendar day (not just weekdays) in a period, for the admin
  // Pay Period rollup grid.
  function tkPeriodDays(start, end){
    var days = [];
    var d = new Date(start.getTime());
    while(d <= end){ days.push(new Date(d.getTime())); d = new Date(d.getTime() + TK_DAY_MS); }
    return days;
  }

  // Weekday (Mon-Fri) ISO dates within a period — every one needs hours
  // entered before the employee can certify.
  function tkPeriodWeekdayISOs(start, end){
    var isos = [];
    var d = new Date(start.getTime());
    while(d <= end){
      var dow = d.getDay();
      if(dow !== 0 && dow !== 6){ isos.push(tkDateToISO(d)); }
      d = new Date(d.getTime() + TK_DAY_MS);
    }
    return isos;
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

  // ---------- Authorized SLINs (Timekeeping -> Burndown linkage) ----------
  // A time code's category of 'gov_contract' or 'commercial_customer' means
  // it's billable to a customer and needs a SLIN; 'indirect' never does.
  function tkIsBillableCategory(category){
    return category === 'gov_contract' || category === 'commercial_customer';
  }

  function tkSlinLabel(s){
    return s.slin_code + (s.slin_description ? ' — ' + s.slin_description : '');
  }

  // Only the SLIN's own code/description -- not customer/contract name.
  // contracts/customers are admin-only RLS today (no employee read policy),
  // so a joined label would break for non-admins; slins itself has
  // slins_employee_read_authorized, which covers this.
  var TK_AUTHORIZED_SLINS_CACHE = {}; // employeeId -> [{id,label}], active authorizations only
  async function tkGetAuthorizedSlins(employeeId){
    if(TK_AUTHORIZED_SLINS_CACHE[employeeId]){ return TK_AUTHORIZED_SLINS_CACHE[employeeId]; }
    var list = [];
    try{
      var todayISO = new Date().toISOString().slice(0,10);
      var rows = await dbRequest('slin_employee_authorization?employee_id=eq.' + employeeId + '&status=eq.active&effective_date=lte.' + todayISO
        + '&select=slin_id,slins(slin_id,slin_code,slin_description)');
      list = rows.filter(function(r){ return r.slins; }).map(function(r){ return { id: r.slin_id, label: tkSlinLabel(r.slins) }; });
    }catch(e){ console.error(e); }
    TK_AUTHORIZED_SLINS_CACHE[employeeId] = list;
    return list;
  }

  // Label lookup for whatever slin_ids already appear on saved entries --
  // separate from tkGetAuthorizedSlins so a row still displays correctly
  // even if that authorization was later revoked (doesn't rely on the
  // "currently authorized" list).
  async function tkFetchSlinLabelsByIds(ids){
    var map = {};
    if(!ids.length){ return map; }
    try{
      var rows = await dbRequest('slins?slin_id=in.(' + ids.join(',') + ')&select=slin_id,slin_code,slin_description');
      rows.forEach(function(s){ map[s.slin_id] = tkSlinLabel(s); });
    }catch(e){ console.error(e); }
    return map;
  }

  function tkUniqueSlinIds(rows){
    var seen = {};
    rows.forEach(function(r){ if(r.slin_id){ seen[r.slin_id] = true; } });
    return Object.keys(seen);
  }

  // ---------- Shared weekly grid (used by the employee's own Current/
  //            History card and the My Team/Admin review card) ----------
  function tkGroupEntriesByCode(entries){
    var byCode = {};
    entries.forEach(function(e){
      var key = (e.time_code_id || 'none') + '|' + (e.slin_id || 'none');
      if(!byCode[key]){ byCode[key] = { time_code_id: e.time_code_id, slin_id: e.slin_id || null, byDate: {} }; }
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

      var codeCell;
      if(editable){
        var codeInfo = codesById[codeVal];
        var rowBillable = !!(codeInfo && tkIsBillableCategory(codeInfo.category));
        var slinLocked = hasAnySavedEntry || rowLocked;
        var currentSlinLabel = row.slin_id && opts.slinLabelById ? opts.slinLabelById[row.slin_id] : null;
        var slinOptionsList = (opts.authorizedSlins || []).slice();
        // A locked row's already-saved SLIN might not be in the current
        // authorized list (revoked since) -- inject it so it still displays.
        if(row.slin_id && !slinOptionsList.some(function(o){ return o.id === row.slin_id; })){
          slinOptionsList.push({ id: row.slin_id, label: currentSlinLabel || 'SLIN' });
        }
        var slinOptionsHtml = slinOptionsList.length
          ? ('<option value="">Select SLIN…</option>' + slinOptionsList.map(function(o){ return '<option value="' + o.id + '"' + (o.id === row.slin_id ? ' selected' : '') + '>' + o.label + '</option>'; }).join(''))
          : '<option value="">No SLINs authorized — contact your admin</option>';

        codeCell = '<button class="tk-now-btn" type="button" onclick="tkAddGridRow(\'' + idBase + '\')" title="Add time code row">+</button> '
          + '<select class="tk-grid-input" style="display:inline-block;width:calc(100% - 34px);" id="tkg-code-' + rowId + '" ' + ((hasAnySavedEntry || rowLocked) ? 'disabled' : '') + ' onchange="tkOnCodeChange(\'' + idBase + '\',\'' + rowId + '\')">'
          + '<option value="">Select time code…</option>'
          + timeCodes.map(function(c){ return '<option value="' + c.id + '" data-category="' + c.category + '"' + (c.id === codeVal ? ' selected' : '') + '>' + c.label + '</option>'; }).join('')
          + '</select>'
          + '<div id="tkg-slin-wrap-' + rowId + '" style="margin-top:6px;display:' + (rowBillable ? 'block' : 'none') + ';">'
          + '<select class="tk-grid-input" id="tkg-slin-' + rowId + '" ' + (slinLocked ? 'disabled' : '') + '>' + slinOptionsHtml + '</select>'
          + '</div>';
      } else {
        var slinSuffix = (row.slin_id && opts.slinLabelById && opts.slinLabelById[row.slin_id])
          ? '<div style="font-size:12px;color:var(--sub);margin-top:2px;">' + opts.slinLabelById[row.slin_id] + '</div>'
          : '';
        codeCell = '<span>' + (codesById[codeVal] ? codesById[codeVal].label : '—') + '</span>' + slinSuffix;
      }

      var dayCells = days.map(function(d){
        var iso = tkDateToISO(d);
        var e = row.byDate[iso];
        var hours = e && e.hours != null ? e.hours : '';
        var dateLocked = !!(opts.lockedDates && opts.lockedDates[iso]);
        var cellHtml;
        if(editable){
          var isRejected = e && e.status === 'rejected';
          cellHtml = '<select class="tk-grid-input" id="tkg-hours-' + rowId + '-' + iso + '" data-entry-id="' + (e ? e.id : '') + '" data-entry-hours="' + hours + '" data-entry-status="' + (e ? e.status : '') + '" ' + (rowEditable && !dateLocked ? '' : 'disabled') + ' onchange="tkOnCellChange(\'' + idBase + '\')">'
            + tkHoursOptionsHtml(hours)
            + '</select>'
            + (isRejected ? '<div class="tk-status-pill rejected" style="margin-top:4px;display:block;" title="' + (e.notes ? String(e.notes).replace(/"/g,'&quot;') : 'Returned by admin') + '">Returned — re-enter to resubmit</div>' : '');
        } else {
          cellHtml = '<span>' + (hours === '' ? '—' : hours) + '</span>' + (e && e.status && e.status !== 'approved' ? '<br>' + tkStatusPill(e.status) : '');
        }
        return '<td>' + cellHtml + '</td>';
      }).join('');

      var removeBtn = (editable && idx > 0 && !hasAnySavedEntry && !rowLocked)
        ? '<button class="tk-now-btn tk-remove-btn" type="button" onclick="tkRemoveGridRow(\'' + rowId + '\')" title="Remove row">&minus;</button>'
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
    var slinOptionsJson = tbody.dataset.slinOptions ? JSON.parse(tbody.dataset.slinOptions) : [];

    var codeOptions = '<option value="">Select time code…</option>' + timeCodesJson.map(function(c){ return '<option value="' + c.id + '" data-category="' + (c.category || '') + '">' + c.label + '</option>'; }).join('');
    var slinOptionsHtml = slinOptionsJson.length
      ? ('<option value="">Select SLIN…</option>' + slinOptionsJson.map(function(o){ return '<option value="' + o.id + '">' + o.label + '</option>'; }).join(''))
      : '<option value="">No SLINs authorized — contact your admin</option>';
    var dayCells = days.map(function(iso){
      return '<td><select class="tk-grid-input" id="tkg-hours-' + rowId + '-' + iso + '" data-entry-id="" data-entry-hours="" onchange="tkOnCellChange(\'' + idBase + '\')">' + tkHoursOptionsHtml('') + '</select></td>';
    }).join('');

    var rowHtml = '<tr data-rowid="' + rowId + '">'
      + '<td><button class="tk-now-btn" type="button" onclick="tkAddGridRow(\'' + idBase + '\')" title="Add time code row">+</button> '
      + '<select class="tk-grid-input" style="display:inline-block;width:calc(100% - 34px);" id="tkg-code-' + rowId + '" onchange="tkOnCodeChange(\'' + idBase + '\',\'' + rowId + '\')">' + codeOptions + '</select>'
      + '<div id="tkg-slin-wrap-' + rowId + '" style="margin-top:6px;display:none;"><select class="tk-grid-input" id="tkg-slin-' + rowId + '">' + slinOptionsHtml + '</select></div>'
      + '</td>'
      + dayCells
      + '<td class="tk-hours-cell">0.00</td>'
      + '<td><button class="tk-now-btn tk-remove-btn" type="button" onclick="tkRemoveGridRow(\'' + rowId + '\')" title="Remove row">&minus;</button></td>'
      + '</tr>';
    tbody.insertAdjacentHTML('beforeend', rowHtml);
  }

  function tkRemoveGridRow(rowId){
    var tr = document.querySelector('tr[data-rowid="' + rowId + '"]');
    if(tr){ tr.remove(); }
  }

  function tkOnCodeChange(idBase, rowId){
    var codeSel = document.getElementById('tkg-code-' + rowId);
    var slinWrap = document.getElementById('tkg-slin-wrap-' + rowId);
    if(!codeSel || !slinWrap){ return; }
    var opt = codeSel.selectedOptions[0];
    var billable = !!(opt && tkIsBillableCategory(opt.dataset.category));
    slinWrap.style.display = billable ? 'block' : 'none';
    if(!billable){
      var slinSel = document.getElementById('tkg-slin-' + rowId);
      if(slinSel){ slinSel.value = ''; }
    }
    tkOnCellChange(idBase); // keep Save/Submit toggle (Pay Period Overview) in sync
  }

  function tkOnCellChange(idBase){
    var tbody = document.getElementById(idBase + '-tbody');
    if(!tbody){ return; }
    var anyDirty = false;
    tbody.querySelectorAll('tr[data-rowid]').forEach(function(tr){
      var total = 0;
      tr.querySelectorAll('select[id^="tkg-hours-"]').forEach(function(sel){
        total += parseFloat(sel.value) || 0;
        if(sel.value !== sel.dataset.entryHours || sel.dataset.entryStatus === 'rejected'){ anyDirty = true; }
      });
      var totalCell = tr.children[tr.children.length - 2];
      if(totalCell){ totalCell.textContent = total.toFixed(2); }
    });
    // Only the Pay Period Overview renders these — toggling Save Pay
    // Period/Submit Pay Period so exactly one shows depending on whether
    // there are unsaved edits. No-op everywhere else (weekly grid has no
    // matching ids).
    var saveBtn = document.getElementById(idBase + '-save-btn');
    var submitBtn = document.getElementById(idBase + '-submit-btn');
    if(saveBtn){ saveBtn.style.display = anyDirty ? '' : 'none'; }
    if(submitBtn){ submitBtn.style.display = anyDirty ? 'none' : ''; }
  }

  // ---------- DCAA audit log (time_card_audit_log) ----------
  async function tkLogAudit(employeeId, weekOrDateISO, timeCodeId, action, fieldChanges, reason){
    var session = getSession();
    var changes = (fieldChanges && fieldChanges.length) ? fieldChanges : [{ field:null, oldVal:null, newVal:null }];
    for(var i=0;i<changes.length;i++){
      try{
        await tkWrite('time_card_audit_log', 'POST', {
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

  // ---------- Pay period certification (employee side) ----------
  var TK_EMPLOYEE_CERT_TEXT = 'I certify that the hours recorded on this timesheet are a true, accurate, and complete record of the actual hours worked, and that they have been properly allocated to the correct cost objectives and project codes in accordance with company policy.';
  var TK_ADMIN_CERT_TEXT = 'I certify that I have reviewed this timesheet, have first-hand knowledge of the work performed, and verify that the hours charged are reasonable, accurate, and properly allocated to the correct project codes.';

  // Checks the current pay period: has it already been certified, and does
  // every weekday have hours entered? Drives both the auto-popup (fired
  // right after a qualifying Save) and the persistent fallback button.
  async function tkCheckPeriodCompletion(employeeId){
    var bounds = tkCurrentPeriodBounds();
    var startISO = tkDateToISO(bounds.start);
    var endISO = tkDateToISO(bounds.end);

    var certRows = await tkReq('pay_period_certifications?employee_id=eq.' + employeeId + '&period_start=eq.' + startISO + '&period_end=eq.' + endISO + '&select=status');
    if(certRows[0] && certRows[0].status !== 'open'){
      return { alreadyCertified: true, startISO: startISO, endISO: endISO };
    }

    var weekdayIsos = tkPeriodWeekdayISOs(bounds.start, bounds.end);
    var entries = await tkReq('time_entries?employee_id=eq.' + employeeId + '&work_date=gte.' + startISO + '&work_date=lte.' + endISO + '&hours=gt.0&status=neq.rejected&select=work_date');
    var covered = {};
    entries.forEach(function(e){ covered[e.work_date] = true; });
    var missing = weekdayIsos.filter(function(iso){ return !covered[iso]; });

    return { alreadyCertified: false, complete: missing.length === 0, missing: missing, startISO: startISO, endISO: endISO };
  }

  // A week can straddle at most one pay-period boundary (7 days inside a
  // ~15-16 day period). Checks every distinct period touched by `days` and
  // returns the set of ISO dates that fall in a period that's no longer
  // 'open' — those cells get disabled even though the rest of the week (or
  // grid) is otherwise editable.
  async function tkGetLockedDatesForWeek(employeeId, days){
    var periods = {};
    days.forEach(function(d){
      var p = tkPeriodBounds(d);
      var key = tkDateToISO(p.start) + '_' + tkDateToISO(p.end);
      if(!periods[key]){ periods[key] = p; }
    });

    var lockedDates = {};
    for(var key in periods){
      var p = periods[key];
      var startISO = tkDateToISO(p.start), endISO = tkDateToISO(p.end);
      var rows = await tkReq('pay_period_certifications?employee_id=eq.' + employeeId + '&period_start=eq.' + startISO + '&period_end=eq.' + endISO + '&select=status');
      if(rows[0] && rows[0].status !== 'open'){
        days.forEach(function(d){
          if(tkDateToISO(d) >= startISO && tkDateToISO(d) <= endISO){ lockedDates[tkDateToISO(d)] = true; }
        });
      }
    }
    return lockedDates;
  }

  // The Current Week tab: shows the normal single-week grid while the
  // current pay period is still incomplete, or the multi-week Pay Period
  // Overview once every weekday is covered (or the period is already
  // certified) — the overview is what carries the Submit Pay Period
  // button now, replacing the old auto-popup + persistent-fallback-button
  // approach entirely.
  async function tkLoadCurrentTab(){
    var employeeId = tkEffectiveEmployeeId();
    try{
      var check = await tkCheckPeriodCompletion(employeeId);
      if(check.alreadyCertified || check.complete){
        await tkRenderPayPeriodOverview('tk-current');
        return;
      }
    }catch(e){ console.error(e); }
    loadTkWeek('tk-current', tkCurrentWeekOffset, true);
  }

  function tkShowEmployeeCertModal(startISO, endISO){
    showDynamicModal(
      '<div class="modal-title">Certify Timesheet</div>'
      + '<div class="modal-text">' + TK_EMPLOYEE_CERT_TEXT + '</div>'
      + '<div class="modal-text">Pay period: ' + formatDate(startISO) + ' – ' + formatDate(endISO) + '</div>'
      + '<div class="modal-actions">'
      + '<button class="btn-cancel" onclick="closeDynamicModal()">Cancel</button>'
      + '<button class="btn-save" onclick="tkConfirmEmployeeCert(\'' + startISO + '\',\'' + endISO + '\')">I Certify &amp; Submit</button>'
      + '</div>'
    );
  }

  async function tkConfirmEmployeeCert(startISO, endISO){
    try{
      await tkRpc('certify_period_employee', { p_period_start: startISO, p_period_end: endISO });
      await tkLogAudit(tkEffectiveEmployeeId(), startISO, null, 'period_certify_employee', null, TK_EMPLOYEE_CERT_TEXT);
      closeDynamicModal();
      await tkRenderPayPeriodOverview('tk-current');
    }catch(e){
      closeDynamicModal();
      showDynamicModal(
        '<div class="modal-title">Couldn\'t Submit</div>'
        + '<div class="modal-text">' + (e.message || 'Something went wrong — try again.') + '</div>'
        + '<div class="modal-actions"><button class="btn-save" onclick="closeDynamicModal()">OK</button></div>'
      );
      console.error(e);
    }
  }

  // Shown on the Current Week tab once the current pay period is complete
  // (or already certified) — a multi-week Mon-Sun grid covering the whole
  // period, a per-category hours breakdown, and whichever of Save Pay
  // Period / Submit Pay Period applies (see tkOnCellChange's dirty-state
  // toggle: Save shows while there are unsaved edits, Submit shows once
  // everything's saved — never both at once).
  async function tkRenderPayPeriodOverview(containerId){
    var container = document.getElementById(containerId);
    var employeeId = tkEffectiveEmployeeId();
    var bounds = tkCurrentPeriodBounds();
    var startISO = tkDateToISO(bounds.start);
    var endISO = tkDateToISO(bounds.end);
    var timeCodes = await tkGetTimeCodes();

    try{
      var entries = await tkReq('time_entries?employee_id=eq.' + employeeId + '&work_date=gte.' + startISO + '&work_date=lte.' + endISO + '&select=*');
      var rows = tkSortRowsByCodeOrder(Object.values(tkGroupEntriesByCode(entries)), timeCodes);
      var days = tkPeriodDays(new Date(startISO + 'T00:00:00'), new Date(endISO + 'T00:00:00'));
      var slinLabelById = await tkFetchSlinLabelsByIds(tkUniqueSlinIds(rows));
      var authorizedSlins = await tkGetAuthorizedSlins(employeeId);

      var certRows = await tkReq('pay_period_certifications?employee_id=eq.' + employeeId + '&period_start=eq.' + startISO + '&period_end=eq.' + endISO + '&select=*');
      var cert = certRows[0] || null;
      var certStatus = cert ? cert.status : 'open';
      var gridEditable = certStatus === 'open';

      // Same weekend-lock-after-first-save rule as the weekly grid, plus
      // the whole period locks once certified, plus any date already
      // admin-approved locks even while the period's still open — a
      // correction there means flagging/returning it in Weekly Review
      // first, not quietly editing already-reviewed hours here.
      var lockedDates = {};
      if(!gridEditable){
        days.forEach(function(d){ lockedDates[tkDateToISO(d)] = true; });
      } else if(entries.length){
        days.forEach(function(d){
          var dow = d.getDay();
          if(dow === 0 || dow === 6){ lockedDates[tkDateToISO(d)] = true; }
        });
        entries.forEach(function(e){ if(e.status === 'approved'){ lockedDates[e.work_date] = true; } });
      }

      var idBase = containerId + '-grid';
      var tableHtml = tkRenderGridTable(rows, days, timeCodes, { editable: gridEditable, rowIdBase: idBase, lockedDates: lockedDates, slinLabelById: slinLabelById, authorizedSlins: authorizedSlins });
      var periodTotal = tkDayTotals(rows, days).reduce(function(a,b){ return a+b; }, 0);

      var categoryTotals = {};
      entries.forEach(function(e){
        if(e.status === 'rejected'){ return; }
        var code = timeCodes.find(function(c){ return c.id === e.time_code_id; });
        var label = code ? code.label : 'Unknown';
        categoryTotals[label] = (categoryTotals[label] || 0) + (parseFloat(e.hours) || 0);
      });
      var categoryLabels = Object.keys(categoryTotals).sort();
      var categoryTableHtml = '<table class="tk-category-totals"><thead><tr><th>Category</th><th>Hours</th></tr></thead><tbody>'
        + (categoryLabels.length
            ? categoryLabels.map(function(label){ return '<tr><td>' + label + '</td><td>' + categoryTotals[label].toFixed(2) + '</td></tr>'; }).join('')
            : '<tr><td colspan="2" class="tk-empty" style="padding:8px 0;">No hours yet.</td></tr>')
        + '</tbody></table>';

      var certStatusLabels = { open: 'Open', employee_certified: 'Certified', admin_certified: 'Certified for Payroll' };
      var certInfoHtml = '';
      if(certStatus === 'employee_certified'){
        certInfoHtml = '<span class="tk-cert-info">Certified by you on ' + formatDate(cert.employee_cert_at.slice(0,10)) + '. Waiting on admin review.</span>';
      } else if(certStatus === 'admin_certified'){
        certInfoHtml = '<span class="tk-cert-info">Certified by you on ' + formatDate(cert.employee_cert_at.slice(0,10)) + ', certified for payroll on ' + formatDate(cert.admin_cert_at.slice(0,10)) + '.</span>';
      }

      var actionsHtml = '';
      if(gridEditable){
        actionsHtml = '<div class="tk-grid-actions">'
          + '<div class="login-error" id="' + containerId + '-save-error" style="margin-top:0;flex:1;"></div>'
          + '<button id="' + idBase + '-save-btn" class="btn btn-primary" style="width:auto;padding:11px 20px;display:none;" onclick="tkSavePayPeriodOverview(\'' + containerId + '\',\'' + startISO + '\',\'' + endISO + '\')">Save Pay Period</button>'
          + '<button id="' + idBase + '-submit-btn" class="btn btn-danger" style="width:auto;padding:11px 20px;" onclick="tkShowEmployeeCertModal(\'' + startISO + '\',\'' + endISO + '\')">Submit Pay Period</button>'
          + '</div>';
      }

      container.innerHTML = '<div class="tk-entry-card">'
        + '<div class="tk-period-header"><div><div class="tk-period-label">Pay Period Overview</div>'
        + '<div class="tk-period-dates">' + formatDate(startISO) + ' – ' + formatDate(endISO) + '</div></div>'
        + '<div><span class="tk-status-pill ' + certStatus + '">' + certStatusLabels[certStatus] + '</span>' + certInfoHtml + '</div>'
        + '</div>'
        + tableHtml
        + '<div id="' + containerId + '-missing-pto-panel"></div>'
        + '<div class="tk-overview-footer">'
        + '<div class="tk-overview-categories">' + categoryTableHtml + '</div>'
        + '<div class="tk-grid-footer-item">Period Total: <span>' + periodTotal.toFixed(2) + ' hrs</span></div>'
        + '</div>'
        + actionsHtml
        + '</div>';

      var tbody = document.getElementById(idBase + '-tbody');
      if(tbody){
        tbody.dataset.days = JSON.stringify(days.map(tkDateToISO));
        tbody.dataset.timeCodes = JSON.stringify(timeCodes.map(function(c){ return { id: c.id, label: c.label, category: c.category }; }));
        tbody.dataset.slinOptions = JSON.stringify(authorizedSlins);
      }
    }catch(e){
      container.innerHTML = '<div class="placeholder-card"><div class="placeholder-title">Couldn\'t load pay period overview</div><div class="placeholder-sub">Try refreshing the page.</div></div>';
      console.error(e);
    }
  }

  async function tkSavePayPeriodOverview(containerId, startISO, endISO){
    await saveTkWeek(startISO, endISO, containerId, {
      onSaved: async function(){ await tkRenderPayPeriodOverview(containerId); }
    });
  }

  // ---------- Timekeeping Simulation Mode ----------
  // A session-only sandbox for demoing the full daily-entry -> employee
  // certify -> admin approve -> admin certify-for-payroll cycle without
  // touching the real database. Admin-only; defaults to Ricky's real
  // pay period data (seeded via seed-ricky-july-pay-period.sql) so the
  // walkthrough has something real to work with.
  //
  // Scope: only time_entries / pay_period_certifications /
  // time_card_audit_log reads+writes, and the 4 RPCs the timekeeping
  // screens use, are intercepted (tkReq/tkWrite/tkRpc below). Anything
  // outside Timekeeping/My Team/Admin's timekeeping views (Dashboard
  // widgets, the PTO tab, everything unrelated) still talks to the real
  // database untouched — this is a scoped sandbox for the certification
  // walkthrough, not an app-wide demo mode.
  var TK_SIM_DEFAULT_EMPLOYEE_ID = '954e67be-05cf-4dd9-abaa-ba37790f9032';
  var TK_SIM_TODAY_ISO = '2026-07-31'; // last day of the seeded July 16-31 period
  var tkSimMode = false;
  var tkSimEmployeeId = TK_SIM_DEFAULT_EMPLOYEE_ID;
  var tkSimGuided = true;
  var tkSimStore = null; // { time_entries: [], pay_period_certifications: [], time_card_audit_log: [] }
  var tkSimIdSeq = 0;

  function tkEffectiveEmployeeId(){
    if(tkSimMode && tkSimEmployeeId){ return tkSimEmployeeId; }
    var session = getSession();
    return session && session.user ? session.user.id : null;
  }

  async function tkStartSimulation(){
    var entries = await dbRequest('time_entries?employee_id=eq.' + tkSimEmployeeId + '&select=*');
    var certs = await dbRequest('pay_period_certifications?employee_id=eq.' + tkSimEmployeeId + '&select=*');
    tkSimStore = {
      time_entries: entries.map(function(e){ return Object.assign({}, e); }),
      pay_period_certifications: certs.map(function(c){ return Object.assign({}, c); }),
      time_card_audit_log: []
    };
    tkSimMode = true;
    tkSimStepIndex = 0;
    tkCurrentWeekOffset = tkOffsetForToday();
    teamTkPeriodOffset.myteam = 0;
    teamTkPeriodOffset.admin = 0;
    tkRenderSimBanner();
    tkRenderSimWizard();
    requestSwitchScreen('timekeeping');
  }

  function tkExitSimulation(){
    tkSimMode = false;
    tkSimStore = null;
    tkCurrentWeekOffset = tkOffsetForToday();
    teamTkPeriodOffset.myteam = 0;
    teamTkPeriodOffset.admin = 0;
    tkRenderSimBanner();
    tkRenderSimWizard();
    tkRenderSimEntry();
    requestSwitchScreen('timekeeping');
  }

  function tkToggleSimGuided(){
    tkSimGuided = !tkSimGuided;
    tkRenderSimBanner();
    tkRenderSimWizard();
  }

  // Timekeeping screen (any subtab), or My Team/Admin specifically while
  // on their Timekeeping subtab — not their Dashboard, Travel, etc.
  function tkSimBannerVisibleHere(){
    var activeScreen = document.querySelector('.screen.active');
    if(!activeScreen){ return false; }
    if(activeScreen.id === 'screen-timekeeping'){ return true; }
    if(activeScreen.id === 'screen-myteam'){
      var sub = document.getElementById('myteam-timekeeping');
      return !!(sub && sub.classList.contains('active'));
    }
    if(activeScreen.id === 'screen-admin'){
      var sub2 = document.getElementById('admin-timekeeping');
      return !!(sub2 && sub2.classList.contains('active'));
    }
    return false;
  }

  function tkRenderSimBanner(){
    var el = document.getElementById('tk-sim-banner');
    if(!el){ return; }
    if(!tkSimMode || !tkSimBannerVisibleHere()){ el.style.display = 'none'; el.innerHTML = ''; return; }
    el.style.display = 'flex';
    el.innerHTML = '<span>&#9888; Simulation Mode — acting as Ricky (' + formatDate(TK_SIM_TODAY_ISO) + ' pay period). Nothing here is saved.</span>'
      + '<label style="margin-left:auto;display:flex;align-items:center;gap:6px;"><input type="checkbox" ' + (tkSimGuided ? 'checked' : '') + ' onchange="tkToggleSimGuided()"> Guided Walkthrough</label>'
      + '<button class="btn-cancel" style="width:auto;padding:6px 14px;" onclick="tkExitSimulation()">Exit Simulation</button>';
  }

  // ---- Guided walkthrough (narration only — the admin performs each
  //      action themselves and clicks Next; nothing here auto-detects or
  //      gates on the action actually happening) ----
  var TK_SIM_STEPS = [
    { title: 'Welcome to the Simulation', body: 'You\'re viewing Ricky\'s Current Week as of July 31, 2026 — the last day of a semi-monthly pay period. Every weekday from July 16-30 already has hours logged.', dcaa: 'DCAA guidelines require time to be recorded daily, not reconstructed later. Ricky\'s kept up every day except today.' },
    { title: 'Enter the Last Day', body: 'On the Current Week grid, enter 8 hours for July 31 under Business Development, then click Save Week.', dcaa: null },
    { title: 'Review the Pay Period Overview', body: 'Saving the last day switches this screen to a Pay Period Overview — every week in the period, plus a category-hours breakdown in the bottom-left corner. This is the chance to double-check everything before submitting.', dcaa: 'Nothing is finalized by this save alone — the employee gets a full look at the period, not just the one day they just entered.' },
    { title: 'Submit the Pay Period', body: 'Click Submit Pay Period. Read the certification statement in the popup, then confirm.', dcaa: 'The system won\'t let a completed period go unattested, and confirming is a deliberate second click — not a side effect of saving.' },
    { title: 'The Period Locks', body: 'Once confirmed, the grid becomes read-only — try changing an hour value and notice you can\'t.', dcaa: 'Once certified, the record is frozen from the employee\'s side — no quiet edits after attestation.' },
    { title: 'Review Each Week', body: 'Switch to My Team or Admin → Timekeeping → Weekly Review. The first two weeks (7/16-7/24) already show approved from earlier reviews — approve the third, currently-submitted week (7/27-7/31), and try adding a note.', dcaa: 'Each week gets independent review — there\'s no single button that rubber-stamps the whole period at once.' },
    { title: 'Certify for Payroll', body: 'Switch to the Pay Period tab. The status should read "Employee Certified." Click Certify & Submit for Payroll, read the second statement, and confirm.', dcaa: 'Two independent attestations — the preparer and the reviewer — happen before anything reaches payroll.' },
    { title: 'Try Reopen', body: 'Click Reopen on the period. Notice it won\'t let you continue without typing a reason.', dcaa: 'Corrections after certification leave a deliberate, reasoned record in the audit trail instead of a silent edit.' },
    { title: 'Try Enter Time for Employee', body: 'On either the Weekly Review or Pay Period card, click "Enter Time for Employee." This is how an admin hand-enters hours on someone\'s behalf under special circumstances.', dcaa: 'Even exception-handling entries are attributably logged — the record always shows who actually entered it.' },
    { title: 'That\'s the Full Cycle', body: 'Everything you just did — every save, approval, certification, and reopen — would normally also write a row to the DCAA audit log, even though nothing was saved for real this time. Exit Simulation whenever you\'re done, or keep exploring freely.', dcaa: null }
  ];
  var tkSimStepIndex = 0;

  function tkSimWizardNext(){ tkSimStepIndex = Math.min(tkSimStepIndex + 1, TK_SIM_STEPS.length - 1); tkRenderSimWizard(); }
  function tkSimWizardBack(){ tkSimStepIndex = Math.max(tkSimStepIndex - 1, 0); tkRenderSimWizard(); }

  function tkRenderSimWizard(){
    var el = document.getElementById('tk-sim-wizard');
    if(!el){ return; }
    if(!(tkSimMode && tkSimGuided && tkSimBannerVisibleHere())){ el.style.display = 'none'; el.innerHTML = ''; return; }
    var step = TK_SIM_STEPS[tkSimStepIndex];
    var isLast = tkSimStepIndex === TK_SIM_STEPS.length - 1;
    el.style.display = 'flex';
    el.innerHTML = '<div class="tk-sim-wizard-main">'
      + '<div class="tk-sim-wizard-step">Step ' + (tkSimStepIndex + 1) + ' of ' + TK_SIM_STEPS.length + '</div>'
      + '<div class="tk-sim-wizard-title">' + step.title + '</div>'
      + '<div class="tk-sim-wizard-body">' + step.body + '</div>'
      + (step.dcaa ? '<div class="tk-sim-wizard-dcaa"><strong>DCAA:</strong> ' + step.dcaa + '</div>' : '')
      + '</div>'
      + '<div class="tk-sim-wizard-actions">'
      + '<button class="tk-sim-wizard-dismiss" type="button" onclick="tkToggleSimGuided()">Hide walkthrough</button>'
      + '<button class="btn-cancel" style="width:auto;padding:6px 12px;" ' + (tkSimStepIndex === 0 ? 'disabled' : '') + ' onclick="tkSimWizardBack()">Back</button>'
      + '<button class="btn-save" style="width:auto;padding:6px 14px;" onclick="' + (isLast ? 'tkToggleSimGuided()' : 'tkSimWizardNext()') + '">' + (isLast ? 'Done' : 'Next') + '</button>'
      + '</div>';
  }

  // Admin-only entry point, rendered into #tk-sim-entry on the Timekeeping
  // screen. Hidden entirely once simulation mode is active (the banner's
  // Exit button is the way out).
  function tkRenderSimEntry(){
    var el = document.getElementById('tk-sim-entry');
    if(!el){ return; }
    if(tkSimMode || !isAdmin()){ el.innerHTML = ''; return; }
    el.innerHTML = '<div class="warning-box" style="margin-bottom:16px;">'
      + '<div class="warning-box-icon">&#9654;</div>'
      + '<div><div class="warning-box-title">Timekeeping Demo Mode</div>'
      + '<div class="warning-box-text">Walk through daily entry, certification, and approval as Ricky, using seeded data — nothing is written to the real database. <a href="#" onclick="tkStartSimulation();return false;">Start Simulation</a></div></div>'
      + '</div>';
  }

  function tkSimTableOf(path){
    var table = path.split('?')[0];
    return (table === 'time_entries' || table === 'pay_period_certifications' || table === 'time_card_audit_log') ? table : null;
  }

  function tkSimParseFilters(path){
    var qIdx = path.indexOf('?');
    var filters = [];
    if(qIdx === -1){ return filters; }
    new URLSearchParams(path.slice(qIdx + 1)).forEach(function(value, key){
      if(key === 'select' || key === 'order' || key === 'limit'){ return; }
      filters.push({ key: key, raw: value });
    });
    return filters;
  }

  function tkSimRowMatches(row, filters){
    return filters.every(function(f){
      var val = row[f.key];
      if(f.raw.indexOf('neq.') === 0){ return String(val) !== f.raw.slice(4); }
      if(f.raw.indexOf('eq.') === 0){ return String(val) === f.raw.slice(3); }
      if(f.raw.indexOf('gte.') === 0){ return val != null && val >= f.raw.slice(4); }
      if(f.raw.indexOf('lte.') === 0){ return val != null && val <= f.raw.slice(4); }
      if(f.raw.indexOf('gt.') === 0){ return parseFloat(val) > parseFloat(f.raw.slice(3)); }
      if(f.raw.indexOf('in.(') === 0){ return f.raw.slice(4, -1).split(',').indexOf(String(val)) !== -1; }
      return true;
    });
  }

  // Drop-in replacements for dbRequest/dbWrite/dbRpc used by the
  // Timekeeping/My Team/Admin timekeeping code paths — pass straight
  // through to the real functions when simulation mode is off (zero
  // behavior change), or read/write tkSimStore when it's on.
  async function tkReq(path){
    var table = tkSimTableOf(path);
    if(!(tkSimMode && table)){ return dbRequest(path); }
    var filters = tkSimParseFilters(path);
    return tkSimStore[table].filter(function(row){ return tkSimRowMatches(row, filters); });
  }

  async function tkWrite(path, method, body){
    var table = tkSimTableOf(path);
    if(!(tkSimMode && table)){ return dbWrite(path, method, body); }
    if(method === 'POST'){
      tkSimIdSeq++;
      tkSimStore[table].push(Object.assign({ id: 'sim-' + tkSimIdSeq }, body));
      return;
    }
    var filters = tkSimParseFilters(path);
    var matches = tkSimStore[table].filter(function(row){ return tkSimRowMatches(row, filters); });
    if(method === 'PATCH'){
      matches.forEach(function(row){ Object.assign(row, body); });
    } else if(method === 'DELETE'){
      matches.forEach(function(row){
        var idx = tkSimStore[table].indexOf(row);
        if(idx !== -1){ tkSimStore[table].splice(idx, 1); }
      });
    }
  }

  // Mirrors the SQL in pay-period-certifications-schema.sql. Deliberately
  // duplicated rather than shared — the real RPCs run in Postgres and
  // can't be called against in-memory data — so keep this in sync if the
  // SQL's business rules ever change.
  async function tkRpc(fnName, params){
    if(!tkSimMode){ return dbRpc(fnName, params); }
    if(fnName === 'accrue_pto'){ return; } // no-op in simulation

    if(fnName === 'certify_period_employee'){
      var weekdays = tkPeriodWeekdayISOs(new Date(params.p_period_start + 'T00:00:00'), new Date(params.p_period_end + 'T00:00:00'));
      var missing = weekdays.filter(function(iso){
        return !tkSimStore.time_entries.some(function(e){
          return e.employee_id === tkSimEmployeeId && e.work_date === iso && parseFloat(e.hours) > 0 && e.status !== 'rejected';
        });
      });
      if(missing.length){ throw new Error('Every weekday in the pay period needs hours entered before you can certify (' + missing.length + ' day(s) still missing)'); }
      var existing = tkSimStore.pay_period_certifications.find(function(c){ return c.employee_id === tkSimEmployeeId && c.period_start === params.p_period_start && c.period_end === params.p_period_end; });
      if(existing && existing.status !== 'open'){ throw new Error('This pay period has already been certified'); }
      if(existing){ existing.status = 'employee_certified'; existing.employee_cert_at = new Date().toISOString(); }
      else{
        tkSimStore.pay_period_certifications.push({
          id: 'sim-cert-' + (++tkSimIdSeq), employee_id: tkSimEmployeeId,
          period_start: params.p_period_start, period_end: params.p_period_end,
          status: 'employee_certified', employee_cert_at: new Date().toISOString(),
          admin_cert_at: null, admin_cert_by: null, admin_notes: null,
          reopened_at: null, reopened_by: null, reopen_reason: null
        });
      }
      return;
    }

    if(fnName === 'certify_period_admin'){
      var cert = tkSimStore.pay_period_certifications.find(function(c){ return c.employee_id === params.p_employee_id && c.period_start === params.p_period_start && c.period_end === params.p_period_end; });
      if(!cert || cert.status !== 'employee_certified'){ throw new Error('The employee must certify this pay period before it can be submitted for payroll'); }
      var unapproved = tkSimStore.time_entries.filter(function(e){
        return e.employee_id === params.p_employee_id && e.work_date >= params.p_period_start && e.work_date <= params.p_period_end && e.status !== 'approved';
      });
      if(unapproved.length){ throw new Error('Every entry in this pay period must be approved before it can be certified for payroll (' + unapproved.length + ' not yet approved)'); }
      cert.status = 'admin_certified';
      cert.admin_cert_at = new Date().toISOString();
      cert.admin_cert_by = tkEffectiveAdminId();
      cert.admin_notes = params.p_notes || null;
      return;
    }

    if(fnName === 'reopen_period'){
      if(!params.p_reason || !params.p_reason.trim()){ throw new Error('A reason is required to reopen a pay period'); }
      var cert2 = tkSimStore.pay_period_certifications.find(function(c){ return c.employee_id === params.p_employee_id && c.period_start === params.p_period_start && c.period_end === params.p_period_end; });
      if(!cert2 || cert2.status === 'open'){ throw new Error('This pay period is not currently certified'); }
      cert2.status = 'open';
      cert2.employee_cert_at = null;
      cert2.admin_cert_at = null;
      cert2.admin_cert_by = null;
      cert2.admin_notes = null;
      cert2.reopened_at = new Date().toISOString();
      cert2.reopened_by = tkEffectiveAdminId();
      cert2.reopen_reason = params.p_reason;
      return;
    }

    return dbRpc(fnName, params);
  }

  function tkEffectiveAdminId(){
    var session = getSession();
    return session && session.user ? session.user.id : null;
  }

  // ---------- My Team (manager/admin review) ----------
  var myTeamFlagged = {}; // { employeeId: { iso: true } } — flags a whole day-column for return, keyed by employee id only; ids are unique company-wide so no scope collision risk

  var teamTkReports = { myteam: [], admin: [] };
  var teamTkIndex = { myteam: 0, admin: 0 };
  var teamTkStartISO = { myteam: '', admin: '' };
  var teamTkEndISO = { myteam: '', admin: '' };
  var teamTkView = { myteam: 'weekly', admin: 'weekly' }; // 'weekly' or 'period'
  var teamTkPeriodOffset = { myteam: 0, admin: 0 };

  function teamTkContentId(scope){
    return scope + '-timekeeping-content';
  }

  // The toggle bar (Weekly Review / Pay Period) lives in the outer content
  // container and stays put across employee/period navigation — only this
  // inner body re-renders.
  function teamTkBodyId(scope){
    return teamTkContentId(scope) + '-body';
  }

  async function loadTeamTimekeeping(scope){
    var container = document.getElementById(teamTkContentId(scope));
    var session = getSession();
    if(!session || !session.user){ return; }

    try{
      if(tkSimMode){
        // Simulation mode reviews only the simulated employee (Ricky) —
        // not the admin's real reports — so it can't be mixed with real
        // review work in the same session.
        teamTkReports[scope] = await dbRequest('profiles?id=eq.' + tkSimEmployeeId + '&select=id,full_name,job_title');
      } else {
        var ids;
        if(scope === 'admin'){
          ids = (await dbRequest('profiles?id=neq.' + session.user.id + '&select=id')).map(function(r){ return r.id; });
        } else {
          ids = await getRecursiveReportIds(session.user.id);
        }
        teamTkReports[scope] = ids.length
          ? await dbRequest('profiles?id=in.(' + ids.join(',') + ')&select=id,full_name,job_title&order=full_name.asc')
          : [];
      }

      if(!teamTkReports[scope].length){
        container.innerHTML = '<div class="placeholder-card"><div class="placeholder-title">No employees found</div><div class="placeholder-sub">' + (scope === 'admin' ? 'No other employees on file.' : 'Nobody is currently assigned to you for review.') + '</div></div>';
        return;
      }

      var todayOffset = tkOffsetForToday();
      var bounds = tkWeekBounds(todayOffset);
      teamTkStartISO[scope] = tkDateToISO(bounds.start);
      teamTkEndISO[scope] = tkDateToISO(bounds.end);
      if(teamTkIndex[scope] >= teamTkReports[scope].length){ teamTkIndex[scope] = 0; }

      await teamTkRenderView(scope);
    }catch(e){
      container.innerHTML = '<div class="placeholder-card"><div class="placeholder-title">Couldn\'t load timekeeping</div><div class="placeholder-sub">Try refreshing the page.</div></div>';
      console.error(e);
    }
  }

  function teamTkSetView(scope, view){
    teamTkView[scope] = view;
    teamTkPeriodOffset[scope] = 0;
    teamTkRenderView(scope);
  }

  async function teamTkRenderView(scope){
    var container = document.getElementById(teamTkContentId(scope));
    container.innerHTML = '<div class="subtab-bar" style="margin-bottom:14px;">'
      + '<button class="subtab-btn ' + (teamTkView[scope] === 'weekly' ? 'active' : '') + '" onclick="teamTkSetView(\'' + scope + '\',\'weekly\')">Weekly Review</button>'
      + '<button class="subtab-btn ' + (teamTkView[scope] === 'period' ? 'active' : '') + '" onclick="teamTkSetView(\'' + scope + '\',\'period\')">Pay Period</button>'
      + '</div>'
      + '<div id="' + teamTkBodyId(scope) + '"></div>';

    if(teamTkView[scope] === 'period'){ await teamTkRenderPeriodCurrentCard(scope); }
    else { await teamTkRenderCurrentCard(scope); }
  }

  async function teamTkRenderCurrentCard(scope){
    var container = document.getElementById(teamTkBodyId(scope));
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

    // If the admin-entry grid (or the read-only grid) rendered, its tbody
    // needs .dataset.days/.timeCodes/.slinOptions for tkAddGridRow's "+"
    // button to work — same wiring loadTkWeek does for the employee's own grid.
    var timeCodes = await tkGetTimeCodes();
    var authorizedSlins = await tkGetAuthorizedSlins(employee.id);
    var days = tkWeekDays(new Date(startISO + 'T00:00:00'));
    ['myteam-entry-' + employee.id + '-grid', 'myteam-card-' + employee.id].forEach(function(idBase){
      var tbody = document.getElementById(idBase + '-tbody');
      if(tbody){
        tbody.dataset.days = JSON.stringify(days.map(tkDateToISO));
        tbody.dataset.timeCodes = JSON.stringify(timeCodes.map(function(c){ return { id: c.id, label: c.label, category: c.category }; }));
        tbody.dataset.slinOptions = JSON.stringify(authorizedSlins);
      }
    });
  }

  function teamTkNavEmployee(scope, dir){
    teamTkIndex[scope] += dir;
    if(teamTkIndex[scope] < 0){ teamTkIndex[scope] = 0; }
    if(teamTkIndex[scope] >= teamTkReports[scope].length){ teamTkIndex[scope] = teamTkReports[scope].length - 1; }
    if(teamTkView[scope] === 'period'){ teamTkRenderPeriodCurrentCard(scope); } else { teamTkRenderCurrentCard(scope); }
  }

  // employeeId -> bool, admin-entry mode toggle (special-circumstances
  // hand entry on an employee's behalf — see teamTkSaveEntryForEmployee).
  var teamTkEditMode = {};

  async function teamTkRenderCard(employee, startISO, endISO, scope){
    var timeCodes = await tkGetTimeCodes();
    var entries = await tkReq('time_entries?employee_id=eq.' + employee.id + '&work_date=gte.' + startISO + '&work_date=lte.' + endISO + '&select=*');
    var rows = tkSortRowsByCodeOrder(Object.values(tkGroupEntriesByCode(entries)), timeCodes);
    var days = tkWeekDays(new Date(startISO + 'T00:00:00'));
    var slinLabelById = await tkFetchSlinLabelsByIds(tkUniqueSlinIds(rows));
    var authorizedSlins = await tkGetAuthorizedSlins(employee.id);

    // Surfaces the pay period's certification status here too, not just
    // on the Pay Period tab — a week can belong to at most one period
    // (checked off its start date; the rare boundary-straddling week is
    // covered well enough by which period contains most of it).
    var weekPeriodBounds = tkPeriodBounds(new Date(startISO + 'T00:00:00'));
    var weekPeriodCertRows = await tkReq('pay_period_certifications?employee_id=eq.' + employee.id + '&period_start=eq.' + tkDateToISO(weekPeriodBounds.start) + '&period_end=eq.' + tkDateToISO(weekPeriodBounds.end) + '&select=status');
    var weekPeriodStatus = weekPeriodCertRows[0] ? weekPeriodCertRows[0].status : 'open';
    var weekCertPillLabels = { employee_certified: 'Certified', admin_certified: 'Certified for Payroll' };
    var weekCertPillHtml = weekCertPillLabels[weekPeriodStatus]
      ? '<span class="tk-status-pill ' + weekPeriodStatus + '" style="margin-left:8px;">' + weekCertPillLabels[weekPeriodStatus] + '</span>'
      : '';

    if(!myTeamFlagged[employee.id]){ myTeamFlagged[employee.id] = {}; }
    var flaggedForThis = myTeamFlagged[employee.id];
    var cardId = 'myteam-card-' + employee.id;
    var editMode = !!teamTkEditMode[employee.id];
    var entryContainerId = 'myteam-entry-' + employee.id;

    var editToggleBtn = '<button class="tk-now-btn" type="button" style="margin-left:8px;" onclick="teamTkToggleEditMode(\'' + scope + '\',\'' + employee.id + '\')">' + (editMode ? 'Done Entering Time' : 'Enter Time for Employee') + '</button>';

    var bodyHtml;
    if(editMode){
      var editRows = rows.length ? rows : [{ time_code_id: '', byDate: {} }];
      var lockedDates = await tkGetLockedDatesForWeek(employee.id, days);
      var idBase = entryContainerId + '-grid';
      var tableHtml = tkRenderGridTable(editRows, days, timeCodes, { editable:true, rowIdBase: idBase, lockedDates: lockedDates, slinLabelById: slinLabelById, authorizedSlins: authorizedSlins });
      var fullyLocked = days.every(function(d){ return lockedDates[tkDateToISO(d)]; });
      bodyHtml = tableHtml + '<div id="' + entryContainerId + '-missing-pto-panel"></div>';
      bodyHtml += fullyLocked
        ? '<div class="tk-empty">This pay period has been submitted and is locked for editing. Reopen the period (Pay Period tab) to make corrections.</div>'
        : '<div class="tk-grid-actions">'
          + '<div class="login-error" id="' + entryContainerId + '-save-error" style="margin-top:0;flex:1;"></div>'
          + '<button class="btn btn-primary" style="width:auto;padding:11px 20px;" onclick="teamTkSaveEntryForEmployee(\'' + scope + '\',\'' + employee.id + '\',\'' + startISO + '\',\'' + endISO + '\',\'' + entryContainerId + '\')">Save</button>'
          + '</div>';
    } else {
      var tableHtml2 = rows.length
        ? tkRenderGridTable(rows, days, timeCodes, { editable:false, rowIdBase: cardId, scope: scope, employeeId: employee.id, flaggedDates: flaggedForThis, showFlagToggle: true, slinLabelById: slinLabelById })
        : '<div class="tk-empty">No time entries submitted for this week yet.</div>';
      var weekTotal = tkDayTotals(rows, days).reduce(function(a,b){ return a+b; }, 0);
      var anyFlagged = Object.keys(flaggedForThis).some(function(k){ return flaggedForThis[k]; });
      bodyHtml = tableHtml2
        + '<div class="tk-grid-footer"><div class="tk-grid-footer-item">Week Total: <span>' + weekTotal.toFixed(2) + ' hrs</span></div></div>'
        + '<div id="myteam-return-panel-' + employee.id + '"></div>'
        + '<div class="tk-grid-actions">'
        + '<div class="login-error" id="myteam-error-' + employee.id + '" style="margin-top:0;flex:1;"></div>'
        + '<button class="btn btn-danger" style="width:auto;padding:11px 20px;" onclick="teamTkOpenReturnPanel(\'' + scope + '\',\'' + employee.id + '\',\'' + startISO + '\',\'' + endISO + '\')">Return</button>'
        + '<button class="btn btn-primary" style="width:auto;padding:11px 20px;" ' + (anyFlagged ? 'disabled' : '') + ' onclick="teamTkOpenApproveModal(\'' + scope + '\',\'' + employee.id + '\',\'' + startISO + '\',\'' + endISO + '\')">Approve All</button>'
        + '</div>';
    }

    return '<div class="tk-entry-card" id="' + cardId + '">'
      + '<div class="myteam-employee-header">'
      + '<div class="myteam-employee-name">' + (employee.full_name || 'Unknown') + '</div>'
      + '<div class="myteam-employee-title">' + (employee.job_title || '—') + '</div>'
      + weekCertPillHtml
      + editToggleBtn
      + '</div>'
      + bodyHtml
      + '</div>';
  }

  function teamTkToggleEditMode(scope, employeeId){
    teamTkEditMode[employeeId] = !teamTkEditMode[employeeId];
    teamTkRenderCurrentCard(scope);
  }

  // Reuses the same saveTkWeek() the employee's own Current-week Save
  // button calls — opts.employeeId targets the employee instead of the
  // caller and stamps entered_by so the DCAA trail shows this wasn't
  // self-entered; opts.onSaved drops back out of edit mode and re-renders
  // the read-only card instead of the employee-self-service reload.
  async function teamTkSaveEntryForEmployee(scope, employeeId, startISO, endISO, containerId){
    await saveTkWeek(startISO, endISO, containerId, {
      employeeId: employeeId,
      onSaved: async function(){
        teamTkEditMode[employeeId] = false;
        await teamTkRenderCurrentCard(scope);
      }
    });
  }

  function teamTkToggleFlag(scope, employeeId, iso){
    if(!myTeamFlagged[employeeId]){ myTeamFlagged[employeeId] = {}; }
    myTeamFlagged[employeeId][iso] = !myTeamFlagged[employeeId][iso];
    teamTkRenderCurrentCard(scope);
  }

  // Approve All still applies to one employee's one week at a time (a
  // single card) — no cross-card/cross-employee bulk approval exists or is
  // planned. This just adds a confirm step with an optional note, so
  // there's a DCAA-relevant record if an admin needs to explain anything
  // unusual about the approval (e.g. hours entered on the employee's
  // behalf under special circumstances).
  function teamTkOpenApproveModal(scope, employeeId, startISO, endISO){
    showDynamicModal(
      '<div class="modal-title">Approve Time Card</div>'
      + '<div class="modal-text">Approve all entries for this employee\'s week (' + formatDate(startISO) + ' – ' + formatDate(endISO) + ')?</div>'
      + '<div style="margin-bottom:14px;"><label class="field-label">Notes (optional)</label><textarea class="field-input" id="myteam-approve-notes" rows="3" placeholder="Anything unusual about this approval, e.g. entered on the employee\'s behalf"></textarea></div>'
      + '<div class="modal-actions">'
      + '<button class="btn-cancel" onclick="closeDynamicModal()">Cancel</button>'
      + '<button class="btn-save" onclick="teamTkApproveAll(\'' + scope + '\',\'' + employeeId + '\',\'' + startISO + '\',\'' + endISO + '\')">Approve</button>'
      + '</div>'
    );
  }

  async function teamTkApproveAll(scope, employeeId, startISO, endISO){
    var notesEl = document.getElementById('myteam-approve-notes');
    var notes = notesEl ? notesEl.value : '';
    closeDynamicModal();
    var errorEl = document.getElementById('myteam-error-' + employeeId);
    if(errorEl){ errorEl.textContent = ''; }
    try{
      var rows = await tkReq('time_entries?employee_id=eq.' + employeeId + '&work_date=gte.' + startISO + '&work_date=lte.' + endISO + '&select=id,time_code_id');
      var session = getSession();
      for(var i=0;i<rows.length;i++){
        await tkWrite('time_entries?id=eq.' + rows[i].id, 'PATCH', {
          status: 'approved',
          approved_by: session.user.id,
          approved_at: new Date().toISOString()
        });
        await tkLogAudit(employeeId, startISO, rows[i].time_code_id, 'approve', null, notes || null);
      }
      // Accrue PTO once per employee per approved week, not per-row
      try{ await tkRpc('accrue_pto', { p_employee_id: employeeId }); }catch(e){ console.error(e); }
      delete myTeamFlagged[employeeId];
      teamTkRenderCurrentCard(scope);
    }catch(e){
      if(errorEl){ errorEl.textContent = 'Could not approve — try again.'; }
      console.error(e);
    }
  }

  // ---------- My Team / Admin: Pay Period review (period-level, not weekly) ----------
  async function teamTkRenderPeriodCurrentCard(scope){
    var container = document.getElementById(teamTkBodyId(scope));
    if(!container){ return; }
    var employee = teamTkReports[scope][teamTkIndex[scope]];
    var bounds = tkPeriodBoundsOffset(teamTkPeriodOffset[scope]);
    var startISO = tkDateToISO(bounds.start);
    var endISO = tkDateToISO(bounds.end);

    var navHtml = '<div class="myteam-tk-header-row">'
      + '<div class="tk-period-label">Pay Period</div>'
      + '<div class="tk-period-dates">' + formatDate(startISO) + ' – ' + formatDate(endISO) + '</div>'
      + '<button class="tk-period-nav-btn" onclick="teamTkNavPeriod(\'' + scope + '\',-1)">&larr; Prev Period</button>'
      + (teamTkPeriodOffset[scope] !== 0 ? '<button class="tk-period-nav-btn" onclick="teamTkGoToCurrentPeriod(\'' + scope + '\')">Current</button>' : '')
      + '<button class="tk-period-nav-btn" ' + (teamTkPeriodOffset[scope] >= 0 ? 'disabled' : '') + ' onclick="teamTkNavPeriod(\'' + scope + '\',1)">Next Period &rarr;</button>'
      + '<button class="tk-period-nav-btn" ' + (teamTkIndex[scope] === 0 ? 'disabled' : '') + ' onclick="teamTkNavEmployee(\'' + scope + '\',-1)">&larr; Employee</button>'
      + '<div class="myteam-nav-count">Employee ' + (teamTkIndex[scope]+1) + ' of ' + teamTkReports[scope].length + '</div>'
      + '<button class="tk-period-nav-btn" ' + (teamTkIndex[scope] === teamTkReports[scope].length-1 ? 'disabled' : '') + ' onclick="teamTkNavEmployee(\'' + scope + '\',1)">Employee &rarr;</button>'
      + '</div>';

    container.innerHTML = navHtml + '<div class="placeholder-card"><div class="placeholder-sub">Loading...</div></div>';
    var cardHtml = await teamTkRenderPeriodCard(employee, startISO, endISO, scope);
    container.innerHTML = navHtml + cardHtml;

    // Same wiring teamTkRenderCurrentCard does — the Enter Time for
    // Employee grid's tbody needs .dataset.days/.timeCodes/.slinOptions for
    // tkAddGridRow's "+" button to work.
    var timeCodes = await tkGetTimeCodes();
    var authorizedSlins = await tkGetAuthorizedSlins(employee.id);
    var periodDays = tkPeriodDays(bounds.start, bounds.end);
    var tbody = document.getElementById('myteam-period-entry-' + employee.id + '-grid-tbody');
    if(tbody){
      tbody.dataset.days = JSON.stringify(periodDays.map(tkDateToISO));
      tbody.dataset.timeCodes = JSON.stringify(timeCodes.map(function(c){ return { id: c.id, label: c.label, category: c.category }; }));
      tbody.dataset.slinOptions = JSON.stringify(authorizedSlins);
    }
  }

  function teamTkNavPeriod(scope, dir){
    teamTkPeriodOffset[scope] += dir;
    if(teamTkPeriodOffset[scope] > 0){ teamTkPeriodOffset[scope] = 0; } // can't review a period that hasn't happened yet
    teamTkRenderPeriodCurrentCard(scope);
  }

  function teamTkGoToCurrentPeriod(scope){
    teamTkPeriodOffset[scope] = 0;
    teamTkRenderPeriodCurrentCard(scope);
  }

  // employeeId -> bool, admin hand-entry mode for the Pay Period card —
  // separate from teamTkEditMode (the Weekly Review card's own toggle) so
  // the two views' edit states don't interfere with each other.
  var teamTkPeriodEditMode = {};

  async function teamTkRenderPeriodCard(employee, startISO, endISO, scope){
    var timeCodes = await tkGetTimeCodes();
    var entries = await tkReq('time_entries?employee_id=eq.' + employee.id + '&work_date=gte.' + startISO + '&work_date=lte.' + endISO + '&select=*');
    var rows = tkSortRowsByCodeOrder(Object.values(tkGroupEntriesByCode(entries)), timeCodes);
    var days = tkPeriodDays(new Date(startISO + 'T00:00:00'), new Date(endISO + 'T00:00:00'));
    var slinLabelById = await tkFetchSlinLabelsByIds(tkUniqueSlinIds(rows));
    var authorizedSlins = await tkGetAuthorizedSlins(employee.id);

    var certRows = await tkReq('pay_period_certifications?employee_id=eq.' + employee.id + '&period_start=eq.' + startISO + '&period_end=eq.' + endISO + '&select=*');
    var cert = certRows[0] || null;
    var status = cert ? cert.status : 'open';
    var statusLabels = { open: 'Open', employee_certified: 'Certified', admin_certified: 'Certified for Payroll' };
    if(status === 'admin_certified'){ await teamTkPreloadAdminName(cert.admin_cert_by); }

    var editMode = status === 'open' && !!teamTkPeriodEditMode[employee.id];
    var entryContainerId = 'myteam-period-entry-' + employee.id;

    var editToggleBtn = status === 'open'
      ? '<button class="tk-now-btn" type="button" style="margin-left:8px;" onclick="teamTkTogglePeriodEditMode(\'' + scope + '\',\'' + employee.id + '\')">' + (editMode ? 'Done Entering Time' : 'Enter Time for Employee') + '</button>'
      : '';

    var certInfoHtml = '';
    if(status === 'admin_certified'){
      certInfoHtml = '<span class="tk-cert-info">Certified by ' + (employee.full_name || 'employee') + ' on ' + formatDate(cert.employee_cert_at.slice(0,10)) + '. Certified for payroll by ' + (teamTkAdminNameCache[cert.admin_cert_by] || 'admin') + ' on ' + formatDate(cert.admin_cert_at.slice(0,10)) + '.' + (cert.admin_notes ? ' Notes: ' + cert.admin_notes : '') + '</span>';
    } else if(status === 'employee_certified'){
      certInfoHtml = '<span class="tk-cert-info">Certified by ' + (employee.full_name || 'employee') + ' on ' + formatDate(cert.employee_cert_at.slice(0,10)) + '.</span>';
    }

    var bodyHtml;
    if(editMode){
      var editRows = rows.length ? rows : [{ time_code_id: '', byDate: {} }];
      var idBase = entryContainerId + '-grid';
      var lockedDates = {};
      if(entries.length){
        days.forEach(function(d){ var dow = d.getDay(); if(dow === 0 || dow === 6){ lockedDates[tkDateToISO(d)] = true; } });
      }
      // Entries from a week that's already been admin-approved lock too —
      // correcting them means flagging/returning that week in Weekly
      // Review first, not quietly editing already-reviewed hours here.
      entries.forEach(function(e){ if(e.status === 'approved'){ lockedDates[e.work_date] = true; } });
      var tableHtml = tkRenderGridTable(editRows, days, timeCodes, { editable:true, rowIdBase: idBase, lockedDates: lockedDates, slinLabelById: slinLabelById, authorizedSlins: authorizedSlins });
      bodyHtml = tableHtml + '<div id="' + entryContainerId + '-missing-pto-panel"></div>'
        + '<div class="tk-grid-actions">'
        + '<div class="login-error" id="' + entryContainerId + '-save-error" style="margin-top:0;flex:1;"></div>'
        + '<button class="btn btn-primary" style="width:auto;padding:11px 20px;" onclick="teamTkSavePeriodEntryForEmployee(\'' + scope + '\',\'' + employee.id + '\',\'' + startISO + '\',\'' + endISO + '\',\'' + entryContainerId + '\')">Save</button>'
        + '</div>';
    } else {
      var tableHtml2 = rows.length
        ? tkRenderGridTable(rows, days, timeCodes, { editable:false, rowIdBase: 'myteam-period-' + employee.id, slinLabelById: slinLabelById })
        : '<div class="tk-empty">No time entries for this pay period yet.</div>';
      var periodTotal = tkDayTotals(rows, days).reduce(function(a,b){ return a+b; }, 0);
      var reopenBtn = '<button class="btn btn-danger" style="width:auto;padding:11px 20px;" onclick="teamTkOpenReopenModal(\'' + scope + '\',\'' + employee.id + '\',\'' + startISO + '\',\'' + endISO + '\')">Reopen</button>';

      var actionHtml;
      if(status === 'admin_certified'){
        actionHtml = '<div class="tk-grid-actions"><div class="login-error" id="myteam-period-error-' + employee.id + '" style="margin-top:0;flex:1;"></div>' + reopenBtn + '</div>';
      } else if(status === 'employee_certified'){
        actionHtml = '<div class="tk-grid-actions">'
          + '<div class="login-error" id="myteam-period-error-' + employee.id + '" style="margin-top:0;flex:1;"></div>'
          + reopenBtn
          + '<button class="btn btn-primary" style="width:auto;padding:11px 20px;" onclick="teamTkOpenPeriodCertModal(\'' + scope + '\',\'' + employee.id + '\',\'' + startISO + '\',\'' + endISO + '\')">Certify &amp; Submit for Payroll</button>'
          + '</div>';
      } else {
        actionHtml = '<div class="tk-empty">Waiting on the employee to certify this pay period.</div>';
      }

      bodyHtml = tableHtml2
        + '<div class="tk-grid-footer"><div class="tk-grid-footer-item">Period Total: <span>' + periodTotal.toFixed(2) + ' hrs</span></div></div>'
        + actionHtml;
    }

    return '<div class="tk-entry-card">'
      + '<div class="myteam-employee-header">'
      + '<div class="myteam-employee-name">' + (employee.full_name || 'Unknown') + '</div>'
      + '<div class="myteam-employee-title">' + (employee.job_title || '—') + '</div>'
      + '<span class="tk-status-pill ' + status + '">' + statusLabels[status] + '</span>'
      + certInfoHtml
      + editToggleBtn
      + '</div>'
      + bodyHtml
      + '</div>';
  }

  function teamTkTogglePeriodEditMode(scope, employeeId){
    teamTkPeriodEditMode[employeeId] = !teamTkPeriodEditMode[employeeId];
    teamTkRenderPeriodCurrentCard(scope);
  }

  // Reuses saveTkWeek exactly like the Weekly Review card's hand-entry
  // mode does (teamTkSaveEntryForEmployee) — safe now that saveTkWeek
  // derives its date range from start/end instead of assuming 7 days, so
  // this can save the whole multi-week period grid in one call without
  // posting anything to the wrong date.
  async function teamTkSavePeriodEntryForEmployee(scope, employeeId, startISO, endISO, containerId){
    await saveTkWeek(startISO, endISO, containerId, {
      employeeId: employeeId,
      onSaved: async function(){
        teamTkPeriodEditMode[employeeId] = false;
        await teamTkRenderPeriodCurrentCard(scope);
      }
    });
  }

  // Small cache so teamTkRenderPeriodCard doesn't refetch the certifying
  // admin's name on every render — keyed by profile id.
  var teamTkAdminNameCache = {};
  async function teamTkPreloadAdminName(adminId){
    if(!adminId || teamTkAdminNameCache[adminId]){ return; }
    try{
      var rows = await dbRequest('profiles?id=eq.' + adminId + '&select=full_name');
      teamTkAdminNameCache[adminId] = rows[0] ? rows[0].full_name : 'admin';
    }catch(e){ teamTkAdminNameCache[adminId] = 'admin'; }
  }

  function teamTkOpenPeriodCertModal(scope, employeeId, startISO, endISO){
    showDynamicModal(
      '<div class="modal-title">Certify Pay Period</div>'
      + '<div class="modal-text">' + TK_ADMIN_CERT_TEXT + '</div>'
      + '<div class="modal-text">Pay period: ' + formatDate(startISO) + ' – ' + formatDate(endISO) + '</div>'
      + '<div style="margin-bottom:14px;"><label class="field-label">Notes (optional)</label><textarea class="field-input" id="myteam-period-cert-notes" rows="3" placeholder="Corrections made, anything unusual about this pay period, etc."></textarea></div>'
      + '<div class="modal-actions">'
      + '<button class="btn-cancel" onclick="closeDynamicModal()">Cancel</button>'
      + '<button class="btn-save" onclick="teamTkConfirmPeriodCert(\'' + scope + '\',\'' + employeeId + '\',\'' + startISO + '\',\'' + endISO + '\')">I Certify &amp; Submit</button>'
      + '</div>'
    );
  }

  async function teamTkConfirmPeriodCert(scope, employeeId, startISO, endISO){
    var notesEl = document.getElementById('myteam-period-cert-notes');
    var notes = notesEl ? notesEl.value : '';
    try{
      await tkRpc('certify_period_admin', { p_employee_id: employeeId, p_period_start: startISO, p_period_end: endISO, p_notes: notes || null });
      await tkLogAudit(employeeId, startISO, null, 'period_certify_admin', null, TK_ADMIN_CERT_TEXT + (notes ? ' | Notes: ' + notes : ''));
      closeDynamicModal();
      teamTkRenderPeriodCurrentCard(scope);
    }catch(e){
      closeDynamicModal();
      showDynamicModal(
        '<div class="modal-title">Couldn\'t Submit</div>'
        + '<div class="modal-text">' + (e.message || 'Something went wrong — try again.') + '</div>'
        + '<div class="modal-actions"><button class="btn-save" onclick="closeDynamicModal()">OK</button></div>'
      );
      console.error(e);
    }
  }

  // Correction path: unlocks a certified period back to 'open' so the
  // employee can fix entries and both certifications happen again from
  // scratch. Reason is mandatory — this is the DCAA-relevant record of why
  // a certified timesheet needed to change after the fact.
  function teamTkOpenReopenModal(scope, employeeId, startISO, endISO){
    showDynamicModal(
      '<div class="modal-title">Reopen Pay Period</div>'
      + '<div class="modal-text">This clears both certifications for ' + formatDate(startISO) + ' – ' + formatDate(endISO) + ' and unlocks it for editing. The employee will need to re-certify, and you\'ll need to re-certify for payroll, once it\'s corrected.</div>'
      + '<div style="margin-bottom:14px;"><label class="field-label">Reason (required)</label><textarea class="field-input" id="myteam-reopen-reason" rows="3" placeholder="Why this pay period needs to be reopened"></textarea></div>'
      + '<div class="login-error" id="myteam-reopen-modal-error" style="margin-top:0;"></div>'
      + '<div class="modal-actions">'
      + '<button class="btn-cancel" onclick="closeDynamicModal()">Cancel</button>'
      + '<button class="btn-save" onclick="teamTkConfirmReopen(\'' + scope + '\',\'' + employeeId + '\',\'' + startISO + '\',\'' + endISO + '\')">Reopen</button>'
      + '</div>'
    );
  }

  async function teamTkConfirmReopen(scope, employeeId, startISO, endISO){
    var reasonEl = document.getElementById('myteam-reopen-reason');
    var reason = reasonEl ? reasonEl.value.trim() : '';
    var modalErrorEl = document.getElementById('myteam-reopen-modal-error');
    if(!reason){
      if(modalErrorEl){ modalErrorEl.textContent = 'A reason is required to reopen a pay period.'; }
      return;
    }
    try{
      await tkRpc('reopen_period', { p_employee_id: employeeId, p_period_start: startISO, p_period_end: endISO, p_reason: reason });
      await tkLogAudit(employeeId, startISO, null, 'period_reopen', null, reason);
      closeDynamicModal();
      teamTkRenderPeriodCurrentCard(scope);
    }catch(e){
      if(modalErrorEl){ modalErrorEl.textContent = e.message || 'Could not reopen — try again.'; }
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
          var existing = await tkReq('time_entries?employee_id=eq.' + employeeId + '&work_date=eq.' + iso + '&select=id,time_code_id');
          for(var e=0;e<existing.length;e++){
            await tkWrite('time_entries?id=eq.' + existing[e].id, 'PATCH', {
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
        var rows = await tkReq('time_entries?employee_id=eq.' + employeeId + '&work_date=gte.' + startISO + '&work_date=lte.' + endISO + '&select=id,time_code_id');
        for(var j=0;j<rows.length;j++){
          await tkWrite('time_entries?id=eq.' + rows[j].id, 'PATCH', {
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
      var employeeId = tkEffectiveEmployeeId();
      var entries = await tkReq('time_entries?employee_id=eq.' + employeeId + '&work_date=gte.' + startISO + '&work_date=lte.' + endISO + '&select=*');
      var rows = tkSortRowsByCodeOrder(Object.values(tkGroupEntriesByCode(entries)), timeCodes);
      var days = tkWeekDays(bounds.start);
      var slinLabelById = await tkFetchSlinLabelsByIds(tkUniqueSlinIds(rows));
      var authorizedSlins = await tkGetAuthorizedSlins(employeeId);

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

      var lockedDates = gridEditable ? await tkGetLockedDatesForWeek(employeeId, days) : {};
      // Once a week has been submitted at least once, weekend cells lock
      // for self-service — Sat/Sun are the exception case, not the norm,
      // so any correction after the fact goes through an admin (Enter
      // Time for Employee) rather than being re-editable indefinitely.
      if(gridEditable && entries.length > 0){
        days.forEach(function(d){
          var dow = d.getDay();
          if(dow === 0 || dow === 6){ lockedDates[tkDateToISO(d)] = true; }
        });
      }
      var idBase = containerId + '-grid';
      var tableHtml = tkRenderGridTable(rows, days, timeCodes, { editable: gridEditable, rowIdBase: idBase, lockedDates: lockedDates, slinLabelById: slinLabelById, authorizedSlins: authorizedSlins });
      var weekTotal = tkDayTotals(rows, days).reduce(function(a,b){ return a+b; }, 0);

      // Surfaces pay period certification here too (History browses past
      // weeks one at a time, so this is the only place it'd otherwise show).
      var weekPeriodBounds = tkPeriodBounds(bounds.start);
      var weekPeriodCertRows = await tkReq('pay_period_certifications?employee_id=eq.' + employeeId + '&period_start=eq.' + tkDateToISO(weekPeriodBounds.start) + '&period_end=eq.' + tkDateToISO(weekPeriodBounds.end) + '&select=status');
      var weekPeriodStatus = weekPeriodCertRows[0] ? weekPeriodCertRows[0].status : 'open';
      var weekCertPillLabels = { employee_certified: 'Certified', admin_certified: 'Certified for Payroll' };
      var weekCertPillHtml = weekCertPillLabels[weekPeriodStatus]
        ? ' <span class="tk-status-pill ' + weekPeriodStatus + '" style="margin-left:6px;">' + weekCertPillLabels[weekPeriodStatus] + '</span>'
        : '';

      var html = '<div class="tk-entry-card">'
        + '<div class="tk-period-header">'
        + '<div><div class="tk-period-label">Week ' + tkWeekNumber(offset) + (isFutureWeek ? ' <span class="tk-status-pill draft" style="margin-left:6px;">Upcoming — view only</span>' : '') + weekCertPillHtml + '</div>'
        + '<div class="tk-period-dates">' + formatDate(startISO) + ' – ' + formatDate(endISO) + '</div></div>'
        + navHtml
        + '</div>'
        + tableHtml
        + (gridEditable ? '' : '<div class="tk-grid-footer"><div class="tk-grid-footer-item">Week Total: <span>' + weekTotal.toFixed(2) + ' hrs</span></div></div>')
        + '<div id="' + containerId + '-missing-pto-panel"></div>';

      var fullyLocked = gridEditable && days.every(function(d){ return lockedDates[tkDateToISO(d)]; });
      if(gridEditable && fullyLocked){
        html += '<div class="tk-grid-footer"><div class="tk-grid-footer-item">Week Total: <span>' + weekTotal.toFixed(2) + ' hrs</span></div></div>'
          + '<div class="tk-empty">This pay period has been submitted and is locked for editing. Contact your admin if a correction is needed.</div>';
      } else if(gridEditable){
        html += '<div class="tk-grid-actions">'
          + '<div class="login-error" id="' + containerId + '-save-error" style="margin-top:0;flex:1;"></div>'
          + '<button class="btn btn-primary" style="width:auto;padding:11px 20px;" onclick="saveTkWeek(\'' + startISO + '\',\'' + endISO + '\',\'' + containerId + '\')">Save Week</button>'
          + '</div>';
      }
      html += '</div>';
      container.innerHTML = html;

      var tbody = document.getElementById(idBase + '-tbody');
      if(tbody){
        tbody.dataset.days = JSON.stringify(days.map(tkDateToISO));
        tbody.dataset.timeCodes = JSON.stringify(timeCodes.map(function(c){ return { id: c.id, label: c.label, category: c.category }; }));
        tbody.dataset.slinOptions = JSON.stringify(authorizedSlins);
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

  // opts (optional) lets an admin enter time on an employee's behalf under
  // special circumstances: opts.employeeId targets that employee instead of
  // the caller, opts.onSaved replaces the default employee-self-service
  // reload (Current-week reload + certification check) with a caller-
  // supplied callback (the My Team/Admin card re-render).
  async function saveTkWeek(startISO, endISO, containerId, opts){
    opts = opts || {};
    var session = getSession();
    var employeeId = opts.employeeId || tkEffectiveEmployeeId();
    var enteredBy = (opts.employeeId && opts.employeeId !== session.user.id) ? session.user.id : null;
    var saveErrorEl = document.getElementById(containerId + '-save-error');
    if(saveErrorEl){ saveErrorEl.textContent = ''; }
    var missingPtoPanel = document.getElementById(containerId + '-missing-pto-panel');
    if(missingPtoPanel){ missingPtoPanel.innerHTML = ''; }

    var gridIdBase = containerId + '-grid';
    var timeCodes = await tkGetTimeCodes();
    var vacation = tkVacationCode(timeCodes);

    var rowEls = document.querySelectorAll('#' + gridIdBase + '-tbody tr[data-rowid]');
    // tkPeriodDays (not tkWeekDays) so this works for any date range, not
    // just a 7-day week — needed to save a whole multi-week pay period
    // grid in one call. Identical output to tkWeekDays for a 7-day range,
    // so existing weekly Save Week calls are unaffected.
    var days = tkPeriodDays(new Date(startISO + 'T00:00:00'), new Date(endISO + 'T00:00:00'));

    // Block the save if any row has hours entered but no Time Code picked
    // (hours would silently be dropped), or a billable Time Code but no
    // SLIN picked (the hours would save with no SLIN attached, breaking the
    // Burndown funding rollup).
    var codelessButHasHours = false;
    var missingSlinButHasHours = false;
    var categoryById = {};
    timeCodes.forEach(function(c){ categoryById[c.id] = c.category; });
    rowEls.forEach(function(tr){
      var codeSel = document.getElementById('tkg-code-' + tr.dataset.rowid);
      var slinSel = document.getElementById('tkg-slin-' + tr.dataset.rowid);
      var rowHasHours = false;
      days.forEach(function(d){
        var cellEl = document.getElementById('tkg-hours-' + tr.dataset.rowid + '-' + tkDateToISO(d));
        if(cellEl && cellEl.value !== '' && parseFloat(cellEl.value) > 0){ rowHasHours = true; }
      });
      if(!rowHasHours){ return; }
      if(codeSel && !codeSel.value){ codelessButHasHours = true; return; }
      if(codeSel && tkIsBillableCategory(categoryById[codeSel.value]) && (!slinSel || !slinSel.value)){ missingSlinButHasHours = true; }
    });
    if(codelessButHasHours){
      if(saveErrorEl){ saveErrorEl.textContent = 'Select a Time Code for every row that has hours entered.'; }
      return;
    }
    if(missingSlinButHasHours){
      if(saveErrorEl){ saveErrorEl.textContent = 'Select a SLIN for every row logging billable hours.'; }
      return;
    }

    var writes = []; // {action: insert|update|delete, id, work_date, time_code_id, hours, oldHours}
    var missingPto = []; // Vacation entries with no covering PTO request yet
    var weekEntries = []; // every non-deleted entry in the week (unchanged + written), for OT calc

    rowEls.forEach(function(tr){
      var rowId = tr.dataset.rowid;
      var codeSel = document.getElementById('tkg-code-' + rowId);
      if(!codeSel || !codeSel.value){ return; }
      var codeId = codeSel.value;
      var isVacation = !!(vacation && codeId === vacation.id);
      var slinSel = document.getElementById('tkg-slin-' + rowId);
      var slinId = (slinSel && slinSel.value) ? slinSel.value : null;

      days.forEach(function(d){
        var iso = tkDateToISO(d);
        var cellEl = document.getElementById('tkg-hours-' + rowId + '-' + iso);
        if(!cellEl || cellEl.disabled){ return; }
        var existingId = cellEl.dataset.entryId || '';
        var existingHours = cellEl.dataset.entryHours || '';
        var existingStatus = cellEl.dataset.entryStatus || '';
        var val = cellEl.value;
        // A rejected entry always needs to flow through as a resubmit,
        // even if the re-entered hours match what was there before —
        // otherwise picking the same value back reads as "no change" and
        // the entry silently stays rejected forever.
        if(val === existingHours && existingStatus !== 'rejected'){ // unchanged
          if(val !== '' && parseFloat(val) > 0){ weekEntries.push({ work_date: iso, hours: parseFloat(val), write: null }); }
          return;
        }
        if(val === '' || parseFloat(val) === 0){
          if(existingId){ writes.push({ action:'delete', id: existingId, work_date: iso, time_code_id: codeId, oldHours: existingHours }); }
          return;
        }
        if(isVacation && !existingId){
          missingPto.push({ iso: iso, hours: val });
          return;
        }
        var w = { action: existingId ? 'update' : 'insert', id: existingId, work_date: iso, time_code_id: codeId, slin_id: slinId, hours: parseFloat(val), oldHours: existingHours };
        writes.push(w);
        weekEntries.push({ work_date: iso, hours: w.hours, write: w });
      });
    });

    if(missingPto.length){
      renderMissingPtoPanel(missingPto, containerId, opts.employeeId);
      if(saveErrorEl){ saveErrorEl.textContent = 'Some Vacation entries need a PTO request before they can be saved (see below).'; }
      return;
    }

    // OT is computed off total weekly (Mon-Sun) hours worked — billable
    // and indirect codes alike (B&P, BD, Holiday, Vacation, etc. all count
    // toward the 40-hour threshold, per user direction). Whole-day/row
    // granularity: an entry that pushes the week's cumulative hours past
    // 40 is flagged overtime in full, same rule the old biweekly system
    // used per-week. Includes hours already on unchanged rows so a
    // partial-week save still sees the true running total.
    // Bucketed by the Monday of each entry's week (not just sorted and
    // summed straight through) so a save spanning more than one week —
    // e.g. the whole multi-week Pay Period Overview grid — still resets
    // the threshold at each week boundary instead of treating the whole
    // date range as one continuous week.
    weekEntries.sort(function(a,b){ return a.work_date < b.work_date ? -1 : (a.work_date > b.work_date ? 1 : 0); });
    var runningHoursByWeek = {};
    weekEntries.forEach(function(entry){
      var d = new Date(entry.work_date + 'T00:00:00');
      var dow = d.getDay(); // 0=Sun..6=Sat
      var mondayOffset = (dow === 0 ? -6 : 1 - dow);
      var weekKey = tkDateToISO(new Date(d.getTime() + mondayOffset * TK_DAY_MS));
      var before = runningHoursByWeek[weekKey] || 0;
      var after = before + entry.hours;
      if(entry.write){ entry.write.earning_type = (before >= 40 || after > 40) ? 'overtime' : 'regular'; }
      runningHoursByWeek[weekKey] = after;
    });

    try{
      for(var i=0;i<writes.length;i++){
        var w = writes[i];
        if(w.action === 'delete'){
          await tkWrite('time_entries?id=eq.' + w.id, 'DELETE');
          await tkLogAudit(employeeId, startISO, w.time_code_id, 'edit', [{ field:'hours', oldVal: w.oldHours, newVal: null }]);
        } else if(w.action === 'update'){
          await tkWrite('time_entries?id=eq.' + w.id, 'PATCH', { hours: w.hours, earning_type: w.earning_type, status: 'submitted' });
          await tkLogAudit(employeeId, startISO, w.time_code_id, 'edit', [{ field:'hours', oldVal: w.oldHours, newVal: w.hours }]);
        } else {
          await tkWrite('time_entries', 'POST', {
            employee_id: employeeId,
            work_date: w.work_date,
            time_code_id: w.time_code_id,
            slin_id: w.slin_id,
            hours: w.hours,
            earning_type: w.earning_type,
            status: 'submitted',
            entered_by: enteredBy
          });
          await tkLogAudit(employeeId, startISO, w.time_code_id, 'submit', [{ field:'hours', oldVal: null, newVal: w.hours }]);
        }
      }
      if(opts.onSaved){
        await opts.onSaved();
      } else if(containerId === 'tk-current'){
        // Switches straight to the Pay Period Overview once this save just
        // completed the period, instead of popping the certification modal
        // immediately — gives them a chance to review/adjust the whole
        // period before choosing to submit it themselves.
        await tkLoadCurrentTab();
      } else {
        await loadTkWeek(containerId, tkCurrentWeekOffset, true);
      }
    }catch(e){
      if(saveErrorEl){ saveErrorEl.textContent = 'Could not save week — try again.'; }
      console.error(e);
    }
  }

  // targetEmployeeId is only set for admin-entry (saveTkWeek opts.employeeId):
  // the inline "Submit PTO Request" convenience button submits as the
  // *caller*, so it can't be offered when the caller is an admin entering
  // on someone else's behalf — shown as guidance text instead.
  function renderMissingPtoPanel(missingPto, containerId, targetEmployeeId){
    var panel = document.getElementById(containerId + '-missing-pto-panel');
    if(!panel){ return; }
    var isAdminEntry = !!targetEmployeeId;
    panel.innerHTML = '<div class="myteam-return-box">'
      + '<div class="tk-section-title">Vacation Needs a PTO Request</div>'
      + '<div class="tk-empty" style="padding:0 0 10px;">These Vacation entries don\'t have an approved or pending PTO request covering them yet.'
      + (isAdminEntry ? ' Have the employee submit a PTO request for these dates, or use a different time code.' : ' Submit a request for each date to continue, or clear the entry and save without it.')
      + '</div>'
      + missingPto.map(function(m, idx){
          return '<div style="display:flex;gap:10px;align-items:end;margin-bottom:10px;">'
            + '<div><label class="field-label">' + formatDate(m.iso) + '</label>'
            + (isAdminEntry ? '<div>' + m.hours + ' hrs</div>' : '<input type="text" inputmode="decimal" class="field-input" id="mpto-hours-' + idx + '" value="' + m.hours + '" style="width:80px;">')
            + '</div>'
            + (isAdminEntry ? '' : '<button class="btn btn-primary" style="width:auto;padding:9px 16px;" onclick="submitInlinePtoRequest(\'' + m.iso + '\',' + idx + ',\'' + containerId + '\')">Submit PTO Request</button>')
            + (isAdminEntry ? '' : '<div class="login-error" id="mpto-error-' + idx + '" style="margin-top:0;"></div>')
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
        + (isFirst ? '' : '<button class="tk-now-btn tk-remove-btn" type="button" onclick="removePtoDayRow(\'' + rowId + '\')">&minus;</button>')
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

