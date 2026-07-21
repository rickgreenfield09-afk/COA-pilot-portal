/* COA Employee Portal — screen-directory.js
   Company directory: roster list and org chart.
   Depends on app-core.js: getSession, dbRequest, avatarHtml. */

  var dirAllProfiles = [];

  function switchDirectorySubtab(name){
    document.querySelectorAll('#screen-directory .dir-subscreen').forEach(function(s){ s.classList.remove('active'); });
    document.querySelectorAll('#screen-directory [data-dirsubtab]').forEach(function(b){ b.classList.toggle('active', b.dataset.dirsubtab === name); });
    document.getElementById('dir-' + name).classList.add('active');
    if(name === 'roster'){ loadDirectoryRoster(); }
    if(name === 'orgchart'){ loadDirectoryOrgChart(); }
  }

  // Shared fetch: all profiles + their department name in one round trip via PostgREST embed
  async function dirFetchAllProfiles(){
    if(dirAllProfiles.length){ return dirAllProfiles; }
    var rows = await dbRequest('profiles?select=id,full_name,job_title,manager_id,department_id,org_position,email,phone,photo_url,departments(name)&order=full_name.asc');
    dirAllProfiles = rows;
    return rows;
  }

  // ---- Roster subtab: flat searchable/filterable list ----
  async function loadDirectoryRoster(){
    var container = document.getElementById('dir-roster');
    try{
      var rows = await dirFetchAllProfiles();
      var byId = {};
      rows.forEach(function(r){ byId[r.id] = r; });

      var deptNames = {};
      rows.forEach(function(r){ if(r.departments && r.departments.name){ deptNames[r.departments.name] = true; } });
      var deptOptions = '<option value="">All Departments</option>' + Object.keys(deptNames).sort().map(function(n){
        return '<option value="' + n + '">' + n + '</option>';
      }).join('');

      container.innerHTML = '<div class="dir-search-wrap">'
        + '<input class="field-input dir-search-input" id="dir-search-input" placeholder="Search by name or title..." oninput="dirRenderRosterList()">'
        + '<select class="dir-dept-filter" id="dir-dept-filter" onchange="dirRenderRosterList()">' + deptOptions + '</select>'
        + '</div>'
        + '<div class="tk-entry-card" id="dir-roster-list"></div>';

      dirRenderRosterList();
    }catch(e){
      container.innerHTML = '<div class="placeholder-card"><div class="placeholder-title">Couldn\'t load directory</div><div class="placeholder-sub">Try refreshing the page.</div></div>';
      console.error(e);
    }
  }

  function dirRenderRosterList(){
    var listEl = document.getElementById('dir-roster-list');
    if(!listEl){ return; }
    var searchVal = (document.getElementById('dir-search-input').value || '').toLowerCase().trim();
    var deptVal = document.getElementById('dir-dept-filter').value;

    var byId = {};
    dirAllProfiles.forEach(function(r){ byId[r.id] = r; });

    var filtered = dirAllProfiles.filter(function(r){
      var deptName = r.departments && r.departments.name ? r.departments.name : '';
      if(deptVal && deptName !== deptVal){ return false; }
      if(searchVal){
        var hay = ((r.full_name||'') + ' ' + (r.job_title||'')).toLowerCase();
        if(hay.indexOf(searchVal) === -1){ return false; }
      }
      return true;
    });

    if(!filtered.length){
      listEl.innerHTML = '<div class="tk-empty">No employees match your search.</div>';
      return;
    }

    listEl.innerHTML = filtered.map(function(r){
      var deptName = r.departments && r.departments.name ? r.departments.name : '—';
      var mgr = r.manager_id && byId[r.manager_id] ? byId[r.manager_id].full_name : '—';
      return '<div class="dir-roster-row" onclick="dirToggleRosterRow(this)">'
        + avatarHtml(r.photo_url, r.full_name, 'dir-roster-initials', 'dir-roster-photo-img')
        + '<div style="flex:1;">'
        + '<div class="dir-roster-name">' + (r.full_name||'—') + '</div>'
        + '<div class="dir-roster-title">' + (r.job_title||'—') + '</div>'
        + '<div class="dir-roster-detail">'
        + '<div class="dir-roster-detail-line">' + (r.email||'—') + '</div>'
        + '<div class="dir-roster-detail-line">' + (r.phone||'—') + '</div>'
        + '<div class="dir-roster-detail-line">Reports to ' + mgr + '</div>'
        + '</div>'
        + '</div>'
        + '<div class="dir-roster-dept">' + deptName + '</div>'
        + '</div>';
    }).join('');
  }

  function dirToggleRosterRow(rowEl){
    rowEl.classList.toggle('expanded');
  }

  // ---- Org Chart subtab: tree built client-side from manager_id ----
  async function loadDirectoryOrgChart(){
    var container = document.getElementById('dir-orgchart');
    try{
      var rows = await dirFetchAllProfiles();
      var session = getSession();
      var meId = session && session.user ? session.user.id : null;

      var byId = {};
      rows.forEach(function(r){ byId[r.id] = r; });
      var childrenOf = {};
      rows.forEach(function(r){
        var key = r.manager_id || '__root__';
        if(!childrenOf[key]){ childrenOf[key] = []; }
        childrenOf[key].push(r);
      });

      var deptRows = await dbRequest('departments?select=id,name,sort_order&order=sort_order.asc');

      // Force-expand: path from root to logged-in user, plus their full subtree.
      var expandIds = {};
      if(meId && byId[meId]){
        var cursor = byId[meId];
        while(cursor){
          expandIds[cursor.id] = true;
          cursor = cursor.manager_id ? byId[cursor.manager_id] : null;
        }
        var stack = (childrenOf[meId] || []).slice();
        while(stack.length){
          var node = stack.pop();
          expandIds[node.id] = true;
          (childrenOf[node.id] || []).forEach(function(c){ stack.push(c); });
        }
      }

      // data-person-id lets the line-drawing pass find each card's real
      // rendered position after layout. data-has-kids marks which cards
      // need a connector drawn down to a children wrap.
      function cardHtml(person, extraClass){
        var kids = childrenOf[person.id] || [];
        var hasKids = kids.length > 0;
        var isYou = meId && person.id === meId;
        var cls = 'dir-chart-card' + (extraClass ? ' ' + extraClass : '') + (hasKids ? ' has-children' : '') + (isYou ? ' is-you' : '');
        var onclick = hasKids ? ' onclick="dirToggleCard(this)"' : '';
        return '<div class="' + cls + '" data-person-id="' + person.id + '"' + onclick + '>'
          + avatarHtml(person.photo_url, person.full_name, 'dir-chart-avatar', 'dir-chart-avatar-img')
          + '<div class="dir-chart-card-name">' + person.full_name + '</div>'
          + '<div class="dir-chart-card-title">' + (person.job_title||'') + '</div>'
          + '<div class="dir-chart-card-contact">' + (person.email||'') + (person.phone ? '<br>' + person.phone : '') + '</div>'
          + (isYou ? '<div class="dir-chart-you-tag">You</div>' : '')
          + (hasKids ? '<div class="dir-chart-caret-toggle">&#9656; ' + kids.length + (kids.length===1?' report':' reports') + '</div>' : '')
          + '</div>';
      }

      // Recursive branch — no CSS-drawn lines here anymore. The wrapper
      // just needs a stable id so dirRecalcLines() can find each parent
      // card and its corresponding children-wrap by person id.
      function branchHtml(person, extraClass){
        var kids = childrenOf[person.id] || [];
        var hasKids = kids.length > 0;
        var openClass = expandIds[person.id] ? ' open' : '';
        var html = '<div class="dir-chart-branch">' + cardHtml(person, extraClass);
        if(hasKids){
          html += '<div class="dir-chart-children-wrap' + openClass + '" data-parent-id="' + person.id + '">'
            + '<div class="dir-chart-siblings">'
            + kids.map(function(k){ return branchHtml(k); }).join('')
            + '</div></div>';
        }
        html += '</div>';
        return html;
      }

      var rootPerson = (childrenOf['__root__']||[])[0];
      var rootHtml = rootPerson
        ? '<div class="dir-chart-root-wrap">' + cardHtml(rootPerson, 'is-root') + '</div>'
        : '';

      var deptBranches = deptRows.map(function(dept){
        var head = rows.find(function(p){ return p.org_position === 'department_head' && p.department_id === dept.id; });
        if(!head){
          return '<div class="dir-chart-branch"><div class="dir-chart-card"><div class="dir-chart-card-name">' + dept.name + '</div><div class="dir-chart-card-title">Unassigned</div></div></div>';
        }
        return branchHtml(head);
      }).join('');

      var deptRowHtml = '<div class="dir-chart-row" data-parent-id="' + (rootPerson?rootPerson.id:'') + '"><div class="dir-chart-siblings">' + deptBranches + '</div></div>';

      var toolbarHtml = '<div class="dir-chart-toolbar">'
        + '<button class="dir-chart-toolbar-btn" onclick="dirExpandAll()">Expand All</button>'
        + '<button class="dir-chart-toolbar-btn" onclick="dirCollapseAll()">Collapse All</button>'
        + '</div>';

      // SVG layer sits behind the cards (z-index below them via CSS) and
      // gets repopulated by dirRecalcLines() after every layout change.
      var svgLayer = '<svg id="dir-chart-svg" class="dir-chart-svg"></svg>';

      container.innerHTML = toolbarHtml + '<div class="dir-chart-scroll" id="dir-chart-scroll">'
        + '<div class="dir-chart-canvas" id="dir-chart-canvas">'
        + svgLayer + rootHtml + deptRowHtml
        + '</div></div>';

      // Measure after the browser has actually painted the layout —
      // rAF ensures we read real positions, not pre-layout zeros.
      requestAnimationFrame(function(){ requestAnimationFrame(dirRecalcLines); });
      dirAttachResizeListener();
    }catch(e){
      container.innerHTML = '<div class="placeholder-card"><div class="placeholder-title">Couldn\'t load org chart</div><div class="placeholder-sub">Try refreshing the page.</div></div>';
      console.error(e);
    }
  }

  // ---- JS-measured connector lines ----
  // Replaces the old CSS pseudo-element approach, which broke down once
  // branches had uneven width/depth (couldn't keep a child row centered
  // under its specific parent card). This measures real rendered
  // positions via getBoundingClientRect and draws an SVG bus-line
  // (shared horizontal bar + vertical drops) matching the original
  // visual style, but correct regardless of row width or nesting depth.

  var dirResizeListenerAttached = false;
  var dirResizeDebounce = null;

  function dirAttachResizeListener(){
    if(dirResizeListenerAttached){ return; }
    dirResizeListenerAttached = true;
    window.addEventListener('resize', function(){
      clearTimeout(dirResizeDebounce);
      dirResizeDebounce = setTimeout(dirRecalcLines, 150);
    });
  }

  function dirRecalcLines(){
    var canvas = document.getElementById('dir-chart-canvas');
    var svg = document.getElementById('dir-chart-svg');
    if(!canvas || !svg){ return; }

    var canvasRect = canvas.getBoundingClientRect();
    svg.setAttribute('width', canvas.scrollWidth);
    svg.setAttribute('height', canvas.scrollHeight);
    svg.innerHTML = '';

    function pointFor(el, edge){
      var r = el.getBoundingClientRect();
      var x = r.left - canvasRect.left + r.width / 2;
      var y = (edge === 'top') ? (r.top - canvasRect.top) : (r.bottom - canvasRect.top);
      return { x: x, y: y };
    }

    function drawLine(x1, y1, x2, y2){
      var line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
      line.setAttribute('x1', x1); line.setAttribute('y1', y1);
      line.setAttribute('x2', x2); line.setAttribute('y2', y2);
      line.setAttribute('stroke', '#2E3440');
      line.setAttribute('stroke-width', '1');
      svg.appendChild(line);
    }

    // For every children-wrap currently visible (open), draw a bus-line:
    // one vertical drop from the parent card's bottom, a horizontal bar
    // spanning the min-to-max child x-range, then a vertical drop from
    // that bar down to each individual child card's top.
    document.querySelectorAll('#dir-orgchart [data-parent-id]').forEach(function(wrap){
      var parentId = wrap.getAttribute('data-parent-id');
      if(!parentId){ return; }
      var parentCard = document.querySelector('#dir-orgchart [data-person-id="' + parentId + '"]');
      if(!parentCard){ return; }

      // Skip if this wrap is a collapsed children-wrap (not visible) —
      // the dept-head row itself has no .dir-chart-children-wrap class
      // so it's always visible; nested wraps respect .open.
      if(wrap.classList.contains('dir-chart-children-wrap') && !wrap.classList.contains('open')){ return; }

      var childCards = wrap.querySelectorAll(':scope > .dir-chart-siblings > .dir-chart-branch > .dir-chart-card');
      if(!childCards.length){ return; }

      var parentPt = pointFor(parentCard, 'bottom');
      var childPts = Array.prototype.map.call(childCards, function(c){ return pointFor(c, 'top'); });

      var busY = parentPt.y + 24;
      var minX = Math.min.apply(null, childPts.map(function(p){ return p.x; }));
      var maxX = Math.max.apply(null, childPts.map(function(p){ return p.x; }));

      // Parent drop
      drawLine(parentPt.x, parentPt.y, parentPt.x, busY);
      // Horizontal bus (only needed if more than one child)
      if(childPts.length > 1){
        drawLine(minX, busY, maxX, busY);
      }
      // Each child's drop from the bus down to its own card
      childPts.forEach(function(p){
        drawLine(p.x, busY, p.x, p.y);
      });
    });
  }

  function dirToggleCard(cardEl){
    var branch = cardEl.closest('.dir-chart-branch');
    if(!branch){ return; }
    var wrap = branch.querySelector('.dir-chart-children-wrap');
    if(!wrap){ return; }
    wrap.classList.toggle('open');
    requestAnimationFrame(function(){ requestAnimationFrame(dirRecalcLines); });
  }

  function dirExpandAll(){
    document.querySelectorAll('#dir-orgchart .dir-chart-children-wrap').forEach(function(w){ w.classList.add('open'); });
    requestAnimationFrame(function(){ requestAnimationFrame(dirRecalcLines); });
  }

  function dirCollapseAll(){
    document.querySelectorAll('#dir-orgchart .dir-chart-children-wrap').forEach(function(w){ w.classList.remove('open'); });
    requestAnimationFrame(function(){ requestAnimationFrame(dirRecalcLines); });
  }
