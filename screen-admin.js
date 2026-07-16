/* COA Employee Portal — screen-admin.js
   Admin view: subtab switcher + admin dashboard (org-wide team overview).
   Timekeeping, resumes, assets, and travel review are NOT duplicated here —
   this calls the same shared scope-parameterized functions in
   screen-timekeeping.js, screen-profile.js, and screen-travel.js as
   screen-myteam.js does, with scope='admin'.
   Depends on app-core.js: getSession, dbRequest, getRecursiveReportIds. */

  // ---------- Admin subtabs ----------
  function switchAdminSubtab(name){
    document.querySelectorAll('#screen-admin .admin-subscreen').forEach(function(s){ s.classList.remove('active'); });
    document.querySelectorAll('#screen-admin [data-adminsubtab]').forEach(function(b){ b.classList.toggle('active', b.dataset.adminsubtab === name); });
    document.getElementById('admin-' + name).classList.add('active');
    if(name === 'dashboard'){ loadAdminDashboard(); }
    if(name === 'timekeeping'){ loadTeamTimekeeping('admin'); }
    if(name === 'resumes'){ loadTeamResumes('admin'); }
    if(name === 'assets'){ loadTeamAssets('admin'); }
    if(name === 'travel'){ switchTeamTravelSubtab('admin', 'request'); }
  }

  // ---------- Admin Dashboard (team overview) ----------
  async function loadAdminDashboard(){
    var container = document.getElementById('admin-dashboard-content');
    var session = getSession();
    if(!session || !session.user){ return; }

    try{
      var reports = await dbRequest('profiles?id=neq.' + session.user.id + '&select=id,full_name');
      var reportIds = reports.map(function(r){ return r.id; });

      var pendingHtml = '<div class="dash-card-empty">Nothing pending.</div>';
      var assetRequestsHtml = '<div class="dash-card-empty">Nothing pending.</div>';
      var outTodayHtml = '<div class="dash-card-empty">No one on approved PTO today.</div>';

      if(reportIds.length){
        var idFilter = 'employee_id=in.(' + reportIds.join(',') + ')';
        var pendingRows = await dbRequest('time_entries?' + idFilter + '&status=in.(submitted,pending)&select=id,earning_type,status');
        var groups = { timecard: [], pto: [], training: [], travel: [], admin: [], award: [] };
        pendingRows.forEach(function(r){
          if(r.status === 'submitted'){ groups.timecard.push(r); }
          else if(groups[r.earning_type]){ groups[r.earning_type].push(r); }
        });
        var groupLabels = { timecard:'Time Cards', pto:'PTO', training:'Training', travel:'Travel', admin:'Admin', award:'Award' };
        var sectionsHtml = '';
        Object.keys(groups).forEach(function(key){
          if(!groups[key].length){ return; }
          sectionsHtml += '<div class="pending-group-header">' + groupLabels[key] + '</div>'
            + '<div class="dash-card-empty" style="padding:4px 0 8px;">' + groups[key].length + ' awaiting approval. <a href="#" onclick="requestSwitchScreen(\'admin\');setTimeout(function(){switchAdminSubtab(\'timekeeping\');},0);return false;">Review</a></div>';
        });
        pendingHtml = sectionsHtml || pendingHtml;

        var equipRows = await dbRequest('asset_requests?requested_by=in.(' + reportIds.join(',') + ')&status=eq.pending&select=id');
        assetRequestsHtml = equipRows.length
          ? '<div class="dash-card-empty">' + equipRows.length + ' asset request' + (equipRows.length===1?'':'s') + ' awaiting approval. <a href="#" onclick="requestSwitchScreen(\'admin\');setTimeout(function(){switchAdminSubtab(\'assets\');},0);return false;">Review</a></div>'
          : assetRequestsHtml;

        var todayISO = new Date().toISOString().slice(0,10);
        var ptoToday = await dbRequest('time_entries?' + idFilter + '&earning_type=eq.pto&status=eq.approved&work_date=eq.' + todayISO + '&select=employee_id');
        if(ptoToday.length){
          var nameById = {};
          reports.forEach(function(r){ nameById[r.id] = r.full_name; });
          outTodayHtml = '<div class="dash-card-empty">' + ptoToday.map(function(p){ return nameById[p.employee_id] || 'Unknown'; }).join(', ') + '</div>';
        }
      }

      container.innerHTML = '<div class="dash-grid-2col">'
        + '<div class="dash-card"><div class="dash-card-title">Pending Requests</div>' + pendingHtml + '</div>'
        + '<div class="dash-card"><div class="dash-card-title">Asset Requests</div>' + assetRequestsHtml + '</div>'
        + '<div class="dash-card"><div class="dash-card-title">Out Today (Approved PTO)</div>' + outTodayHtml + '</div>'
        + '<div class="dash-card"><div class="dash-card-title">Upcoming Travel<span class="dash-card-badge soon">Soon</span></div><div class="dash-card-empty">Coming soon.</div></div>'
        + '<div class="dash-card"><div class="dash-card-title">Training Requirements<span class="dash-card-badge soon">Soon</span></div><div class="dash-card-empty">Coming soon.</div></div>'
        + '<div class="dash-card"><div class="dash-card-title">Surveys Due<span class="dash-card-badge soon">Soon</span></div><div class="dash-card-empty">Coming soon.</div></div>'
        + '</div>';
    }catch(e){
      container.innerHTML = '<div class="placeholder-card"><div class="placeholder-title">Couldn\'t load team overview</div><div class="placeholder-sub">Try refreshing the page.</div></div>';
      console.error(e);
    }
  }
