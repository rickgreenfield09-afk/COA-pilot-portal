/* COA Employee Portal — screen-travel.js
   Shared travel review helpers used by screen-myteam.js and screen-admin.js:
   switchTeamTravelSubtab, teamTravelReadOnlyField, toggleDetailBreakdown,
   travelPendingSummaryHtml, buildUpcomingTravelHtml (scope param, reused
   across My Dashboard, My Team, and Admin). Depends on app-core.js:
   getSession, dbRequest, dbWrite, isAdmin, escAttr, formatDate,
   getRecursiveReportIds. */

  function switchTravelSubtab(name){
    document.querySelectorAll('#screen-travel .travel-subscreen').forEach(function(s){ s.classList.remove('active'); });
    document.querySelectorAll('#screen-travel [data-travelsubtab]').forEach(function(b){ b.classList.toggle('active', b.dataset.travelsubtab === name); });
    document.getElementById('travel-' + name).classList.add('active');
    if(name === 'estimate'){ loadTravelEstimateScreen(); }
    if(name === 'expense'){ loadTravelExpenseScreen(); }
  }

  // ---------- Team Travel (My Team = read-only + manager decision; Admin = editable + travel admin decision) ----------
  function switchTeamTravelSubtab(scope, name){
    var wrap = document.getElementById(scope + '-travel');
    wrap.querySelectorAll('.travel-subscreen').forEach(function(s){ s.classList.remove('active'); });
    wrap.querySelectorAll('[data-teamtravelsubtab]').forEach(function(b){ b.classList.toggle('active', b.dataset.teamtravelsubtab === name); });
    document.getElementById(scope + '-travel-' + name).classList.add('active');
    if(name === 'estimate'){ loadTeamTravelEstimates(scope); }
    if(name === 'expense'){ loadTeamTravelExpenses(scope); }
  }

  function teamTravelReadOnlyField(label, value){
    return '<div class="info-box"><div class="info-label">' + label + '</div><div class="info-val">' + (value || '—') + '</div></div>';
  }

  // Shows/hides the full line-item cost breakdown on a team review detail
  // card (Estimate or Expense) — approvers can expand it to see what's
  // driving the rolled-up totals before deciding.
  function toggleDetailBreakdown(id){
    var el = document.getElementById(id);
    if(el){ el.style.display = el.style.display === 'none' ? '' : 'none'; }
  }

  // Dashboard "Pending Requests" line items for Travel Estimates/Expense
  // Reports — shared by loadTeamDashboard (screen-myteam.js) and
  // loadAdminDashboard (screen-admin.js) so the pending-approval queries
  // aren't duplicated per CLAUDE.md's shared-function rule. ids is the
  // caller's already-scoped employee id list (recursive reports for
  // myteam, all company profiles for admin).
  async function travelPendingSummaryHtml(scope, ids){
    if(!ids.length){ return ''; }
    var idList = ids.join(',');
    var subtabFn = scope === 'admin' ? 'switchAdminSubtab' : 'switchMyTeamSubtab';
    var html = '';

    function reviewLink(subtab){
      return '<a href="#" onclick="requestSwitchScreen(\'' + scope + '\');setTimeout(function(){' + subtabFn + '(\'travel\');switchTeamTravelSubtab(\'' + scope + '\',\'' + subtab + '\');},0);return false;">Review</a>';
    }

    var estPending = await dbRequest('travel_estimates?created_by=in.(' + idList + ')&status=eq.submitted&select=id');
    if(estPending.length){
      html += '<div class="pending-group-header">Travel Estimates</div>'
        + '<div class="dash-card-empty" style="padding:4px 0 8px;">' + estPending.length + ' awaiting approval. ' + reviewLink('estimate') + '</div>';
    }

    var expFilter = scope === 'admin'
      ? '&supervisor_status=eq.approved&principal_status=eq.pending&current_status=eq.submitted'
      : '&supervisor_status=eq.pending&current_status=eq.submitted';
    var expPending = await dbRequest('travel_expenses?created_by=in.(' + idList + ')' + expFilter + '&select=id');
    if(expPending.length){
      html += '<div class="pending-group-header">Travel Expense Reports</div>'
        + '<div class="dash-card-empty" style="padding:4px 0 8px;">' + expPending.length + ' awaiting approval. ' + reviewLink('expense') + '</div>';
    }

    return html;
  }

  // "Upcoming Travel" dashboard widget — shared across My Dashboard
  // (ids=[you]), My Team (ids=your reports), and Admin (ids=everyone).
  // Lists approved travel_estimates with a future leave date, sorted
  // soonest-first.
  async function buildUpcomingTravelHtml(ids){
    if(!ids.length){ return '<div class="dash-card-empty">No upcoming travel.</div>'; }
    var idList = ids.join(',');
    var todayISO = new Date().toISOString().slice(0,10);

    var estRows = await dbRequest('travel_estimates?created_by=in.(' + idList + ')&status=in.(approved,expensed,paid)&leave_date=gte.' + todayISO + '&select=id,created_by,destination_event,leave_date,return_date&order=leave_date.asc');

    var namesById = {};
    if(ids.length > 1){
      var nameRows = await dbRequest('profiles?id=in.(' + idList + ')&select=id,full_name');
      nameRows.forEach(function(r){ namesById[r.id] = r.full_name; });
    }

    var combined = estRows.map(function(r){
      return { employeeId: r.created_by, destination: r.destination_event, start: r.leave_date, end: r.return_date };
    });
    combined.sort(function(a, b){ return new Date(a.start) - new Date(b.start); });

    if(!combined.length){ return '<div class="dash-card-empty">No upcoming travel.</div>'; }

    return combined.slice(0, 6).map(function(t){
      var who = (ids.length > 1 && namesById[t.employeeId]) ? namesById[t.employeeId] + ' — ' : '';
      return '<div class="dash-card-empty" style="padding:4px 0;">' + who + (t.destination || '—') + ' (' + formatDate(t.start) + ' – ' + formatDate(t.end) + ')</div>';
    }).join('');
  }

