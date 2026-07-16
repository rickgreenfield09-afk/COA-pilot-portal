/* COA Employee Portal — screen-travel.js
   Personal travel request screen (flights/hotel/car, submit/edit) plus the
   My Team/Admin travel review functions (loadTeamTravel, openTeamTravelDetail,
   etc. — scope param, reused by screen-myteam.js and screen-admin.js).
   Depends on app-core.js: getSession, dbRequest, dbWrite, isAdmin, escAttr,
   formatDate, getRecursiveReportIds. */

  function switchTravelSubtab(name){
    document.querySelectorAll('#screen-travel .travel-subscreen').forEach(function(s){ s.classList.remove('active'); });
    document.querySelectorAll('#screen-travel [data-travelsubtab]').forEach(function(b){ b.classList.toggle('active', b.dataset.travelsubtab === name); });
    document.getElementById('travel-' + name).classList.add('active');
    if(name === 'request'){ loadTravelScreen(); }
    if(name === 'estimate'){ loadTravelEstimateScreen(); }
    if(name === 'expense'){ loadTravelExpenseScreen(); }
  }

  // ---------- Travel screen (standalone travel_requests) ----------
  var travelProjectsCache = [];
  var travelContractsCache = [];
  var travelPreferenceWasChecked = false;
  var travelOwnKtn = '';
  var travelOwnPrograms = [];
  var travelEditingId = null;
  var travelEditingRow = null;

  async function loadTravelScreen(editId){
    var container = document.getElementById('travel-content');
    var session = getSession();
    if(!session || !session.user){ return; }
    travelEditingId = editId || null;
    travelEditingRow = null;

    try{
      if(!travelProjectsCache.length){
        travelProjectsCache = await dbRequest('projects?active=eq.true&select=id,name&order=name.asc');
      }
      if(!travelContractsCache.length){
        travelContractsCache = await dbRequest('gov_contracts?select=id,contract_name&order=contract_name.asc');
      }

      var profRows = await dbRequest('profiles?id=eq.' + session.user.id + '&select=known_traveler_number');
      travelOwnKtn = profRows.length ? (profRows[0].known_traveler_number || '') : '';
      travelOwnPrograms = await dbRequest('employee_travel_programs?employee_id=eq.' + session.user.id + '&select=program_type,provider_name');

      if(travelEditingId){
        var existingRows = await dbRequest('travel_requests?id=eq.' + travelEditingId + '&select=*');
        if(existingRows.length){ travelEditingRow = existingRows[0]; }
      }

      container.innerHTML = '<div class="tk-entry-card">'
        + '<div class="tk-section-title">' + (travelEditingRow ? 'Edit Draft Travel Request' : 'New Travel Request') + '</div>'
        + '<div class="tk-pto-form-grid" style="grid-template-columns:1fr 1fr;">'
        + '<div><label class="field-label" for="trav-destination">Destination</label><input class="field-input" id="trav-destination" placeholder="City, State"></div>'
        + '<div><label class="field-label" for="trav-purpose">Purpose</label><input class="field-input" id="trav-purpose" placeholder="Reason for travel"></div>'
        + '<div><label class="field-label" for="trav-start">Travel Start Date</label><input type="date" class="field-input" id="trav-start"></div>'
        + '<div><label class="field-label" for="trav-end">Travel End Date</label><input type="date" class="field-input" id="trav-end"></div>'
        + '</div>'
        + '<div class="field-label" style="margin-top:6px;">Cost Activity</div>'
        + '<div class="tk-pto-form-grid" style="grid-template-columns:1fr 1fr 1fr;margin-bottom:18px;">'
        + '<div><label class="field-label" for="trav-cost-mode">Bill To</label>'
        + '<select class="field-input" id="trav-cost-mode" onchange="travelCostModeChanged()">'
        + '<option value="">— None —</option>'
        + '<option value="project">Project</option>'
        + '<option value="gov_contract">Government Contract</option>'
        + '<option value="training">Training</option>'
        + '</select></div>'
        + '<div id="trav-cost-detail-wrap" style="display:none;"><label class="field-label" for="trav-cost-detail">Select</label><select class="field-input" id="trav-cost-detail"></select></div>'
        + '</div>'
        + '<div class="resume-row-checkbox" style="margin-bottom:4px;">'
        + '<input type="checkbox" id="trav-self-book" onchange="travelPreferenceToggled()">'
        + '<label for="trav-self-book">I want to research and propose my own travel arrangements</label>'
        + '</div>'
        + '<div id="trav-proposed-wrap" style="display:none;margin-bottom:14px;">'
        + '<div class="resume-section"><div class="resume-section-title">Flights</div><div id="trav-flight-rows"></div></div>'
        + '<div class="resume-section" id="trav-hotel-section"><div class="resume-section-title">Hotel</div></div>'
        + '<div class="resume-section" id="trav-car-section">'
        + '<div class="resume-section-title">Car Rental</div>'
        + '<div class="resume-row-checkbox" style="margin-bottom:10px;">'
        + '<input type="checkbox" id="trav-rideshare" onchange="travelRideshareToggled()">'
        + '<label for="trav-rideshare">I will use ride share services (no rental car needed)</label>'
        + '</div>'
        + '<div id="trav-car-fields-wrap"></div>'
        + '</div>'
        + '<div class="tk-entry-card" style="margin-top:14px;margin-bottom:0;">'
        + '<div class="tk-pto-summary-row">'
        + '<div class="tk-pto-stat-box"><div class="tk-pto-stat-label">Flights</div><div class="tk-pto-stat-val" id="trav-total-flights">$0.00</div></div>'
        + '<div class="tk-pto-stat-box"><div class="tk-pto-stat-label">Hotel</div><div class="tk-pto-stat-val" id="trav-total-hotel">$0.00</div></div>'
        + '<div class="tk-pto-stat-box"><div class="tk-pto-stat-label">Car</div><div class="tk-pto-stat-val" id="trav-total-car">$0.00</div></div>'
        + '<div class="tk-pto-stat-box"><div class="tk-pto-stat-label">Trip Total</div><div class="tk-pto-stat-val" id="trav-total-grand">$0.00</div></div>'
        + '</div></div>'
        + '</div>'
        + '<div style="display:flex;gap:10px;margin-top:10px;">'
        + '<button class="btn btn-primary" style="width:auto;padding:12px 20px;" onclick="submitTravelRequest(\'submitted\')">Submit Request</button>'
        + '<button class="btn-cancel" onclick="submitTravelRequest(\'draft\')">Save as Draft</button>'
        + '<button class="btn-cancel" onclick="loadTravelScreen()">Cancel</button>'
        + '</div>'
        + '<div class="login-error" id="travel-request-error"></div>'
        + '</div>'
        + '<div class="tk-entry-card">'
        + '<div class="tk-section-title">My Travel Requests</div>'
        + (await travelRenderMyRequestsTable(session.user.id))
        + '</div>';

      travelRenderFlightLegs();
      document.getElementById('trav-hotel-section').insertAdjacentHTML('beforeend', travelHotelSectionHtml());
      document.getElementById('trav-car-fields-wrap').insertAdjacentHTML('beforeend', travelCarSectionHtml());

      if(travelEditingRow){
        travelPrefillForm(travelEditingRow);
      }

      travelPreferenceWasChecked = false;
    }catch(e){
      container.innerHTML = '<div class="placeholder-card"><div class="placeholder-title">Couldn\'t load travel</div><div class="placeholder-sub">Try refreshing the page.</div></div>';
      console.error(e);
    }
  }

  function travelPrefillForm(row){
    document.getElementById('trav-destination').value = row.destination || '';
    document.getElementById('trav-purpose').value = row.purpose || '';
    document.getElementById('trav-start').value = row.travel_start_date || '';
    document.getElementById('trav-end').value = row.travel_end_date || '';

    var costMode = row.project_id ? 'project' : (row.gov_contract_id ? 'gov_contract' : (row.cost_category === 'training' ? 'training' : ''));
    document.getElementById('trav-cost-mode').value = costMode;
    if(costMode){
      travelCostModeChanged();
      var detailVal = row.project_id || row.gov_contract_id || '';
      if(detailVal){ document.getElementById('trav-cost-detail').value = detailVal; }
    }

    if(row.preference_mode === 'self_researched'){
      document.getElementById('trav-self-book').checked = true;
      travelPreferenceToggled();

      var detail = row.proposed_arrangements_detail || {};
      var flights = detail.flights || [];
      var departureData = flights.find(function(f){ return f.leg === 'departure'; });
      var returnData = flights.find(function(f){ return f.leg === 'return'; });

      if(departureData){ travelFillFlightRow('trav-flight-departure', departureData); }
      if(returnData){
        travelFillFlightRow('trav-flight-return', returnData);
      }else if(flights.length){
        // Had flight data but no return leg saved — treat as one-way.
        document.getElementById('trav-oneway').checked = true;
        travelOnewayToggled();
      }

      if(detail.hotel){
        document.getElementById('trav-hotel-city').value = detail.hotel.city || '';
        document.getElementById('trav-hotel-state').value = detail.hotel.state || '';
        document.getElementById('trav-hotel-chain').value = detail.hotel.chain || '';
        document.getElementById('trav-hotel-checkin').value = detail.hotel.check_in_date || '';
        document.getElementById('trav-hotel-checkout').value = detail.hotel.check_out_date || '';
        document.getElementById('trav-hotel-cost').value = detail.hotel.cost || 0;
        document.getElementById('trav-hotel-rewards').value = detail.hotel.rewards_program || '';
      }

      if(detail.car && (detail.car.chain || detail.car.pickup_location || (detail.car.cost || 0) > 0)){
        document.getElementById('trav-car-chain').value = detail.car.chain || '';
        document.getElementById('trav-car-pickup-loc').value = detail.car.pickup_location || '';
        document.getElementById('trav-car-pickup-date').value = detail.car.pickup_date || '';
        document.getElementById('trav-car-dropoff-loc').value = detail.car.dropoff_location || '';
        document.getElementById('trav-car-dropoff-date').value = detail.car.dropoff_date || '';
        document.getElementById('trav-car-cost').value = detail.car.cost || 0;
        document.getElementById('trav-car-rewards').value = detail.car.rewards_program || '';
      }else{
        document.getElementById('trav-rideshare').checked = true;
        travelRideshareToggled();
      }

      recalcTravelTotals();
    }
  }

  function travelFillFlightRow(rowId, data){
    var row = document.getElementById(rowId);
    if(!row){ return; }
    row.querySelectorAll('[data-field]').forEach(function(el){
      var key = el.dataset.field;
      if(data[key] !== undefined){ el.value = data[key]; }
    });
  }


  function travelCostModeChanged(){
    var mode = document.getElementById('trav-cost-mode').value;
    var wrap = document.getElementById('trav-cost-detail-wrap');
    var detail = document.getElementById('trav-cost-detail');
    if(mode === 'project'){
      detail.innerHTML = travelProjectsCache.map(function(p){ return '<option value="' + p.id + '">' + p.name + '</option>'; }).join('');
      wrap.style.display = '';
      document.querySelector('label[for="trav-cost-detail"]').textContent = 'Project';
    }else if(mode === 'gov_contract'){
      detail.innerHTML = travelContractsCache.map(function(c){ return '<option value="' + c.id + '">' + c.contract_name + '</option>'; }).join('');
      wrap.style.display = '';
      document.querySelector('label[for="trav-cost-detail"]').textContent = 'Government Contract';
    }else{
      wrap.style.display = 'none';
      detail.innerHTML = '';
    }
  }

  function travelProposedHasData(){
    var flightHasData = Array.prototype.some.call(document.querySelectorAll('#trav-flight-rows .trav-flight-row'), function(row){
      return Array.prototype.some.call(row.querySelectorAll('[data-field]'), function(el){
        if(el.dataset.field === 'cost'){ return (parseFloat(el.value) || 0) > 0; }
        return el.value && el.value.trim();
      });
    });
    if(flightHasData){ return true; }

    var hotelInputs = ['trav-hotel-city','trav-hotel-state','trav-hotel-chain','trav-hotel-checkin','trav-hotel-checkout'];
    var carInputs = ['trav-car-chain','trav-car-pickup-loc','trav-car-pickup-date','trav-car-dropoff-loc','trav-car-dropoff-date'];
    var anyFilled = hotelInputs.concat(carInputs).some(function(id){
      var el = document.getElementById(id);
      return el && el.value && el.value.trim();
    });
    var anyCost = (parseFloat((document.getElementById('trav-hotel-cost')||{}).value) || 0) > 0
      || (parseFloat((document.getElementById('trav-car-cost')||{}).value) || 0) > 0;
    return anyFilled || anyCost;
  }

  function travelClearProposedForm(){
    document.getElementById('trav-rideshare').checked = false;
    if(document.getElementById('trav-oneway')){ document.getElementById('trav-oneway').checked = false; }
    travelRenderFlightLegs();
    document.getElementById('trav-hotel-section').innerHTML = '<div class="resume-section-title">Hotel</div>' + travelHotelSectionHtml();
    document.getElementById('trav-car-fields-wrap').innerHTML = travelCarSectionHtml();
    recalcTravelTotals();
  }


  function travelPreferenceToggled(){
    var checkbox = document.getElementById('trav-self-book');
    var proposedWrap = document.getElementById('trav-proposed-wrap');

    if(checkbox.checked){
      proposedWrap.style.display = '';
      travelPreferenceWasChecked = true;
      return;
    }

    // Unchecking after it was checked: warn before clearing self-booked flight/hotel/car entries.
    if(travelPreferenceWasChecked && travelProposedHasData()){
      var confirmed = confirm('Switching to Travel Admin booking will clear the flight, hotel, and car details you entered. Continue?');
      if(!confirmed){
        checkbox.checked = true;
        return;
      }
      travelClearProposedForm();
    }
    proposedWrap.style.display = 'none';
    travelPreferenceWasChecked = false;
  }

  function travelRewardsOptionsHtml(programType, selected){
    var matches = travelOwnPrograms.filter(function(p){ return p.program_type === programType; });
    var opts = '<option value="">— None —</option>';
    matches.forEach(function(p){
      opts += '<option value="' + escAttr(p.provider_name) + '"' + (p.provider_name === selected ? ' selected' : '') + '>' + p.provider_name + '</option>';
    });
    return opts;
  }

  function travelFlightRowHtml(leg){
    var isDeparture = leg === 'departure';
    var legLabel = isDeparture ? 'Departure Flight' : 'Return Flight';
    var rowId = isDeparture ? 'trav-flight-departure' : 'trav-flight-return';

    var onewayCheckbox = isDeparture
      ? '<div class="resume-row-checkbox" style="margin-top:10px;">'
        + '<input type="checkbox" id="trav-oneway" onchange="travelOnewayToggled()">'
        + '<label for="trav-oneway">This is one-way travel (no return flight)</label>'
        + '</div>'
      : '';

    return '<div class="resume-row trav-flight-row" id="' + rowId + '" data-leg="' + leg + '">'
      + '<div class="resume-row-header">' + legLabel + '</div>'
      + '<div class="resume-row-grid">'
      + '<div class="field-mini-wrap"><span class="field-mini-label">Departure City</span><input class="info-edit-input" data-field="departure_city"></div>'
      + '<div class="field-mini-wrap"><span class="field-mini-label">Departure State</span><input class="info-edit-input" data-field="departure_state"></div>'
      + '<div class="field-mini-wrap"><span class="field-mini-label">Airport</span><input class="info-edit-input" data-field="airport"></div>'
      + '<div class="field-mini-wrap"><span class="field-mini-label">Airline</span><input class="info-edit-input" data-field="airline"></div>'
      + '<div class="field-mini-wrap"><span class="field-mini-label">Flight Number</span><input class="info-edit-input" data-field="flight_number"></div>'
      + '<div class="field-mini-wrap"><span class="field-mini-label">Departure Time</span><input type="time" class="info-edit-input" data-field="departure_time"></div>'
      + '<div class="field-mini-wrap"><span class="field-mini-label">Arrival Time</span><input type="time" class="info-edit-input" data-field="arrival_time"></div>'
      + '<div class="field-mini-wrap"><span class="field-mini-label">Cost</span><input type="number" step="0.01" class="info-edit-input trav-cost-input" data-field="cost" data-bucket="flights" oninput="recalcTravelTotals()" value="0"></div>'
      + '<div class="field-mini-wrap"><span class="field-mini-label">Known Traveler Number</span><div class="info-val" style="padding:6px 8px;">' + (travelOwnKtn || '—') + '</div></div>'
      + '<div class="field-mini-wrap"><span class="field-mini-label">Airline Rewards</span><select class="info-edit-input" data-field="rewards_program">' + travelRewardsOptionsHtml('airline') + '</select></div>'
      + '</div>'
      + onewayCheckbox
      + '</div>';
  }

  function travelRenderFlightLegs(){
    document.getElementById('trav-flight-rows').innerHTML =
      travelFlightRowHtml('departure') + travelFlightRowHtml('return');
  }

  function travelLegHasData(rowId){
    var row = document.getElementById(rowId);
    if(!row){ return false; }
    var anyText = Array.prototype.some.call(row.querySelectorAll('input[data-field], select[data-field]'), function(el){
      if(el.dataset.field === 'cost'){ return (parseFloat(el.value) || 0) > 0; }
      return el.value && el.value.trim();
    });
    return anyText;
  }

  function travelOnewayToggled(){
    var checkbox = document.getElementById('trav-oneway');
    var returnRow = document.getElementById('trav-flight-return');

    if(checkbox.checked){
      if(travelLegHasData('trav-flight-return')){
        var confirmed = confirm('Marking this as one-way will delete the Return Flight details you already entered. Continue?');
        if(!confirmed){
          checkbox.checked = false;
          return;
        }
      }
      if(returnRow){ returnRow.remove(); }
      recalcTravelTotals();
      return;
    }

    // Re-checking off one-way: restore an empty Return Flight card.
    if(!document.getElementById('trav-flight-return')){
      document.getElementById('trav-flight-rows').insertAdjacentHTML('beforeend', travelFlightRowHtml('return'));
    }
  }

  function travelCarRowHasData(){
    if(!document.getElementById('trav-car-row')){ return false; }
    var fieldIds = ['trav-car-chain','trav-car-pickup-loc','trav-car-pickup-date','trav-car-dropoff-loc','trav-car-dropoff-date'];
    var anyFilled = fieldIds.some(function(id){
      var el = document.getElementById(id);
      return el && el.value && el.value.trim();
    });
    var anyCost = (parseFloat((document.getElementById('trav-car-cost')||{}).value) || 0) > 0;
    return anyFilled || anyCost;
  }

  function travelRideshareToggled(){
    var checkbox = document.getElementById('trav-rideshare');
    var fieldsWrap = document.getElementById('trav-car-fields-wrap');

    if(checkbox.checked){
      if(travelCarRowHasData()){
        var confirmed = confirm('Choosing ride share will delete the rental car details you already entered. Continue?');
        if(!confirmed){
          checkbox.checked = false;
          return;
        }
      }
      fieldsWrap.innerHTML = '';
      recalcTravelTotals();
      return;
    }

    // Re-checking off ride share: restore empty rental car fields.
    if(!document.getElementById('trav-car-row')){
      fieldsWrap.innerHTML = travelCarSectionHtml();
    }
  }

  function travelHotelSectionHtml(){
    return '<div class="resume-row" id="trav-hotel-row">'
      + '<div class="resume-row-grid">'
      + '<div class="field-mini-wrap"><span class="field-mini-label">City</span><input class="info-edit-input" id="trav-hotel-city"></div>'
      + '<div class="field-mini-wrap"><span class="field-mini-label">State</span><input class="info-edit-input" id="trav-hotel-state"></div>'
      + '<div class="field-mini-wrap"><span class="field-mini-label">Chain</span><input class="info-edit-input" id="trav-hotel-chain"></div>'
      + '<div class="field-mini-wrap"><span class="field-mini-label">Check-In Date</span><input type="date" class="info-edit-input" id="trav-hotel-checkin"></div>'
      + '<div class="field-mini-wrap"><span class="field-mini-label">Check-Out Date</span><input type="date" class="info-edit-input" id="trav-hotel-checkout"></div>'
      + '<div class="field-mini-wrap"><span class="field-mini-label">Cost</span><input type="number" step="0.01" class="info-edit-input trav-cost-input" id="trav-hotel-cost" data-bucket="hotel" oninput="recalcTravelTotals()" value="0"></div>'
      + '<div class="field-mini-wrap"><span class="field-mini-label">Hotel Rewards</span><select class="info-edit-input" id="trav-hotel-rewards">' + travelRewardsOptionsHtml('hotel') + '</select></div>'
      + '</div></div>';
  }

  function travelCarSectionHtml(){
    return '<div class="resume-row" id="trav-car-row">'
      + '<div class="resume-row-grid">'
      + '<div class="field-mini-wrap"><span class="field-mini-label">Chain</span><input class="info-edit-input" id="trav-car-chain"></div>'
      + '<div class="field-mini-wrap"><span class="field-mini-label">Pick-Up Location</span><input class="info-edit-input" id="trav-car-pickup-loc"></div>'
      + '<div class="field-mini-wrap"><span class="field-mini-label">Pick-Up Date</span><input type="date" class="info-edit-input" id="trav-car-pickup-date"></div>'
      + '<div class="field-mini-wrap"><span class="field-mini-label">Drop-Off Location</span><input class="info-edit-input" id="trav-car-dropoff-loc"></div>'
      + '<div class="field-mini-wrap"><span class="field-mini-label">Drop-Off Date</span><input type="date" class="info-edit-input" id="trav-car-dropoff-date"></div>'
      + '<div class="field-mini-wrap"><span class="field-mini-label">Cost</span><input type="number" step="0.01" class="info-edit-input trav-cost-input" id="trav-car-cost" data-bucket="car" oninput="recalcTravelTotals()" value="0"></div>'
      + '<div class="field-mini-wrap"><span class="field-mini-label">Car Rewards</span><select class="info-edit-input" id="trav-car-rewards">' + travelRewardsOptionsHtml('car_rental') + '</select></div>'
      + '</div></div>';
  }

  function recalcTravelTotals(){
    var flightsSum = 0;
    document.querySelectorAll('#trav-flight-rows .trav-cost-input').forEach(function(el){
      flightsSum += parseFloat(el.value) || 0;
    });
    var hotelCost = parseFloat((document.getElementById('trav-hotel-cost') || {}).value) || 0;
    var carCost = parseFloat((document.getElementById('trav-car-cost') || {}).value) || 0;
    var grand = flightsSum + hotelCost + carCost;

    document.getElementById('trav-total-flights').textContent = '$' + flightsSum.toFixed(2);
    document.getElementById('trav-total-hotel').textContent = '$' + hotelCost.toFixed(2);
    document.getElementById('trav-total-car').textContent = '$' + carCost.toFixed(2);
    document.getElementById('trav-total-grand').textContent = '$' + grand.toFixed(2);

    return { flightsSum: flightsSum, hotelCost: hotelCost, carCost: carCost, grand: grand };
  }

  function harvestTravelFlights(){
    var rows = document.querySelectorAll('#trav-flight-rows .trav-flight-row');
    var out = [];
    rows.forEach(function(row){
      var obj = { leg: row.dataset.leg };
      row.querySelectorAll('[data-field]').forEach(function(el){
        obj[el.dataset.field] = el.tagName === 'SELECT' ? el.value : (el.value || '');
      });
      obj.cost = parseFloat(obj.cost) || 0;
      obj.known_traveler_number = travelOwnKtn || '';
      out.push(obj);
    });
    return out;
  }


  async function travelRenderMyRequestsTable(employeeId){
    var rows = await dbRequest('travel_requests?requester_id=eq.' + employeeId + '&order=created_at.desc&select=id,destination,travel_start_date,travel_end_date,current_status,manager_status,travel_status');
    if(!rows.length){
      return '<div class="tk-empty">No travel requests yet.</div>';
    }
    return '<table class="tk-grid-table"><thead><tr><th>Destination</th><th>Dates</th><th>Status</th><th>Manager</th><th>Travel Admin</th><th></th></tr></thead><tbody>'
      + rows.map(function(r){
          var action = r.current_status === 'draft'
            ? '<button class="tk-now-btn" type="button" onclick="loadTravelScreen(\'' + r.id + '\')">Edit Draft</button>'
            : '';
          return '<tr><td>' + (r.destination || '—') + '</td>'
            + '<td>' + formatDate(r.travel_start_date) + ' – ' + formatDate(r.travel_end_date) + '</td>'
            + '<td>' + tkStatusPill(r.current_status) + '</td>'
            + '<td>' + tkStatusPill(r.manager_status) + '</td>'
            + '<td>' + tkStatusPill(r.travel_status) + '</td>'
            + '<td>' + action + '</td></tr>';
        }).join('')
      + '</tbody></table>';
  }

  async function submitTravelRequest(targetStatus){
    var errorEl = document.getElementById('travel-request-error');
    var session = getSession();
    errorEl.textContent = '';

    var destination = document.getElementById('trav-destination').value.trim();
    var purpose = document.getElementById('trav-purpose').value.trim();
    var startVal = document.getElementById('trav-start').value;
    var endVal = document.getElementById('trav-end').value;
    var costMode = document.getElementById('trav-cost-mode').value;
    var costDetail = document.getElementById('trav-cost-detail') ? document.getElementById('trav-cost-detail').value : '';
    var selfBook = document.getElementById('trav-self-book').checked;

    // Drafts can be saved with missing information — only submitted requests are validated.
    if(targetStatus === 'submitted'){
      if(!destination || !purpose || !startVal || !endVal){
        errorEl.textContent = 'Destination, purpose, and both dates are required to submit.';
        return;
      }
      if(new Date(endVal) < new Date(startVal)){
        errorEl.textContent = 'Travel end date must be on or after start date.';
        return;
      }
    }

    var detail = null;
    var flightsCost = 0, hotelCost = 0, carCost = 0, totalCost = 0;

    if(selfBook){
      var totals = recalcTravelTotals();
      flightsCost = totals.flightsSum;
      hotelCost = totals.hotelCost;
      carCost = totals.carCost;
      totalCost = totals.grand;

      detail = {
        flights: harvestTravelFlights(),
        hotel: {
          city: document.getElementById('trav-hotel-city').value.trim(),
          state: document.getElementById('trav-hotel-state').value.trim(),
          chain: document.getElementById('trav-hotel-chain').value.trim(),
          check_in_date: document.getElementById('trav-hotel-checkin').value,
          check_out_date: document.getElementById('trav-hotel-checkout').value,
          cost: hotelCost,
          rewards_program: document.getElementById('trav-hotel-rewards').value
        },
        car: {
          chain: document.getElementById('trav-car-chain').value.trim(),
          pickup_location: document.getElementById('trav-car-pickup-loc').value.trim(),
          pickup_date: document.getElementById('trav-car-pickup-date').value,
          dropoff_location: document.getElementById('trav-car-dropoff-loc').value.trim(),
          dropoff_date: document.getElementById('trav-car-dropoff-date').value,
          cost: carCost,
          rewards_program: document.getElementById('trav-car-rewards').value
        }
      };
    }

    var body = {
      requester_id: session.user.id,
      destination: destination || null,
      purpose: purpose || null,
      travel_start_date: startVal || null,
      travel_end_date: endVal || null,
      preference_mode: selfBook ? 'self_researched' : 'delegated',
      proposed_arrangements_detail: detail,
      flights_cost: flightsCost,
      hotel_cost: hotelCost,
      car_cost: carCost,
      total_cost: totalCost,
      project_id: costMode === 'project' ? costDetail : null,
      gov_contract_id: costMode === 'gov_contract' ? costDetail : null,
      cost_category: costMode === 'training' ? 'training' : null,
      current_status: targetStatus
    };

    try{
      if(travelEditingId){
        delete body.requester_id;
        await dbWrite('travel_requests?id=eq.' + travelEditingId, 'PATCH', body);
      }else{
        await dbWrite('travel_requests', 'POST', [body]);
      }
      travelEditingId = null;
      travelEditingRow = null;
      loadTravelScreen();
    }catch(e){
      errorEl.textContent = 'Couldn\'t save travel request. Try again.';
      console.error(e);
    }
  }


  // ---------- Team Travel (My Team = read-only + manager decision; Admin = editable + travel admin decision) ----------
  var teamTravelReportIds = { myteam: null, admin: null };

  async function loadTeamTravel(scope){
    var container = document.getElementById(scope === 'admin' ? 'admin-travel' : 'myteam-travel');
    var session = getSession();
    if(!session || !session.user){ return; }

    try{
      var ids;
      if(scope === 'admin'){
        ids = (await dbRequest('profiles?select=id')).map(function(p){ return p.id; });
      }else{
        ids = await getRecursiveReportIds(session.user.id);
      }
      teamTravelReportIds[scope] = ids;

      if(!ids.length){
        container.innerHTML = '<div class="tk-empty">No team members found.</div>';
        return;
      }

      var statusField = scope === 'admin' ? 'travel_status' : 'manager_status';
      var idList = ids.join(',');

      var pendingRows = await dbRequest('travel_requests?requester_id=in.(' + idList + ')&' + statusField + '=eq.pending&current_status=eq.submitted&select=id,requester_id,destination,travel_start_date,travel_end_date,total_cost,current_status,manager_status,travel_status&order=created_at.asc');
      var allRows = await dbRequest('travel_requests?requester_id=in.(' + idList + ')&current_status=neq.draft&select=id,requester_id,destination,travel_start_date,travel_end_date,total_cost,current_status,manager_status,travel_status&order=created_at.desc');

      var namesById = {};
      var nameRows = await dbRequest('profiles?id=in.(' + idList + ')&select=id,full_name');
      nameRows.forEach(function(r){ namesById[r.id] = r.full_name; });

      container.innerHTML = '<div class="tk-entry-card" id="team-travel-pending-' + scope + '">'
        + '<div class="tk-section-title">Needs Your Approval (' + pendingRows.length + ')</div>'
        + (pendingRows.length
            ? '<table class="tk-grid-table"><thead><tr><th>Employee</th><th>Destination</th><th>Dates</th><th>Est. Cost</th><th></th></tr></thead><tbody>'
              + pendingRows.map(function(r){
                  return '<tr><td>' + (namesById[r.requester_id] || '—') + '</td>'
                    + '<td>' + (r.destination || '—') + '</td>'
                    + '<td>' + formatDate(r.travel_start_date) + ' – ' + formatDate(r.travel_end_date) + '</td>'
                    + '<td>$' + (parseFloat(r.total_cost) || 0).toFixed(2) + '</td>'
                    + '<td><button class="tk-now-btn" type="button" onclick="openTeamTravelDetail(\'' + scope + '\',\'' + r.id + '\')">Review</button></td></tr>';
                }).join('')
              + '</tbody></table>'
            : '<div class="tk-empty">Nothing pending.</div>')
        + '</div>'
        + '<div class="tk-entry-card">'
        + '<div class="tk-section-title">All Team Travel Requests</div>'
        + (allRows.length
            ? '<table class="tk-grid-table"><thead><tr><th>Employee</th><th>Destination</th><th>Dates</th><th>Status</th><th>Manager</th><th>Travel Admin</th><th></th></tr></thead><tbody>'
              + allRows.map(function(r){
                  return '<tr><td>' + (namesById[r.requester_id] || '—') + '</td>'
                    + '<td>' + (r.destination || '—') + '</td>'
                    + '<td>' + formatDate(r.travel_start_date) + ' – ' + formatDate(r.travel_end_date) + '</td>'
                    + '<td>' + tkStatusPill(r.current_status) + '</td>'
                    + '<td>' + tkStatusPill(r.manager_status) + '</td>'
                    + '<td>' + tkStatusPill(r.travel_status) + '</td>'
                    + '<td><button class="tk-now-btn" type="button" onclick="openTeamTravelDetail(\'' + scope + '\',\'' + r.id + '\')">View</button></td></tr>';
                }).join('')
              + '</tbody></table>'
            : '<div class="tk-empty">No submitted travel requests yet.</div>')
        + '</div>'
        + '<div id="team-travel-detail-' + scope + '"></div>';
    }catch(e){
      container.innerHTML = '<div class="placeholder-card"><div class="placeholder-title">Couldn\'t load travel requests</div><div class="placeholder-sub">Try refreshing the page.</div></div>';
      console.error(e);
    }
  }

  function teamTravelReadOnlyField(label, value){
    return '<div class="info-box"><div class="info-label">' + label + '</div><div class="info-val">' + (value || '—') + '</div></div>';
  }

  async function openTeamTravelDetail(scope, requestId){
    var detailContainer = document.getElementById('team-travel-detail-' + scope);
    detailContainer.innerHTML = '<div class="tk-entry-card"><div class="placeholder-sub">Loading request...</div></div>';
    detailContainer.scrollIntoView({ behavior: 'smooth', block: 'start' });

    try{
      var rows = await dbRequest('travel_requests?id=eq.' + requestId + '&select=*');
      if(!rows.length){ detailContainer.innerHTML = ''; return; }
      var r = rows[0];
      var nameRows = await dbRequest('profiles?id=eq.' + r.requester_id + '&select=full_name');
      var requesterName = nameRows.length ? nameRows[0].full_name : '—';

      if(scope === 'admin'){
        await renderTeamTravelDetailEditable(detailContainer, r, requesterName);
      }else{
        renderTeamTravelDetailReadOnly(detailContainer, scope, r, requesterName);
      }
    }catch(e){
      detailContainer.innerHTML = '<div class="placeholder-card"><div class="placeholder-title">Couldn\'t load request</div><div class="placeholder-sub">Try refreshing the page.</div></div>';
      console.error(e);
    }
  }

  function renderTeamTravelDetailReadOnly(detailContainer, scope, r, requesterName){
      var detail = r.proposed_arrangements_detail || {};
      var flights = detail.flights || [];
      var flightsHtml = flights.length
        ? flights.map(function(f){
            var legLabel = f.leg === 'return' ? 'Return Flight' : 'Departure Flight';
            return '<div class="resume-view-row"><div class="resume-row-header">' + legLabel + '</div>'
              + '<div class="resume-view-row-title">' + (f.airline || '—') + ' ' + (f.flight_number || '') + '</div>'
              + '<div class="resume-view-row-dates">' + (f.departure_city || '—') + (f.departure_state ? ', ' + f.departure_state : '') + ' · ' + (f.airport || '—') + '</div>'
              + '<div class="resume-view-row-dates">Depart ' + (f.departure_time || '—') + ' · Arrive ' + (f.arrival_time || '—') + '</div>'
              + '<div class="resume-view-row-dates">KTN: ' + (f.known_traveler_number || '—') + ' · Rewards: ' + (f.rewards_program || '—') + '</div>'
              + '<div class="resume-view-row-dates">Cost: $' + (parseFloat(f.cost) || 0).toFixed(2) + '</div></div>';
          }).join('')
        : '<div class="info-val" style="color:var(--muted);">No flight details (one-way or not provided).</div>';

      var hotelHtml = detail.hotel && (detail.hotel.chain || detail.hotel.city)
        ? '<div class="resume-view-row"><div class="resume-view-row-title">' + (detail.hotel.chain || '—') + '</div>'
          + '<div class="resume-view-row-dates">' + (detail.hotel.city || '—') + (detail.hotel.state ? ', ' + detail.hotel.state : '') + '</div>'
          + '<div class="resume-view-row-dates">' + formatDate(detail.hotel.check_in_date) + ' – ' + formatDate(detail.hotel.check_out_date) + '</div>'
          + '<div class="resume-view-row-dates">Rewards: ' + (detail.hotel.rewards_program || '—') + ' · Cost: $' + (parseFloat(detail.hotel.cost) || 0).toFixed(2) + '</div></div>'
        : '<div class="info-val" style="color:var(--muted);">No hotel booked.</div>';

      var carHtml = detail.car && (detail.car.chain || detail.car.pickup_location)
        ? '<div class="resume-view-row"><div class="resume-view-row-title">' + (detail.car.chain || '—') + '</div>'
          + '<div class="resume-view-row-dates">Pick up: ' + (detail.car.pickup_location || '—') + ' on ' + formatDate(detail.car.pickup_date) + '</div>'
          + '<div class="resume-view-row-dates">Drop off: ' + (detail.car.dropoff_location || '—') + ' on ' + formatDate(detail.car.dropoff_date) + '</div>'
          + '<div class="resume-view-row-dates">Rewards: ' + (detail.car.rewards_program || '—') + ' · Cost: $' + (parseFloat(detail.car.cost) || 0).toFixed(2) + '</div></div>'
        : '<div class="info-val" style="color:var(--muted);">Ride share — no rental car.</div>';

      var costActivity = r.cost_category === 'training' ? 'Training' : (r.project_id ? 'Project' : (r.gov_contract_id ? 'Government Contract' : '—'));

      var actionsHtml = '<button class="btn-save" onclick="teamTravelAction(\'' + scope + '\',\'' + r.id + '\',\'approved\')">Approve</button>'
          + '<button class="btn-edit" onclick="teamTravelAction(\'' + scope + '\',\'' + r.id + '\',\'returned\')">Return</button>'
          + '<button class="btn-cancel" style="color:var(--red);border-color:var(--red);" onclick="teamTravelAction(\'' + scope + '\',\'' + r.id + '\',\'denied\')">Deny</button>';

      detailContainer.innerHTML = '<div class="tk-entry-card">'
        + '<div class="tk-section-title">Travel Request — ' + requesterName + '</div>'
        + '<div class="profile-grid">'
        + teamTravelReadOnlyField('Destination', r.destination)
        + teamTravelReadOnlyField('Purpose', r.purpose)
        + teamTravelReadOnlyField('Dates', formatDate(r.travel_start_date) + ' – ' + formatDate(r.travel_end_date))
        + teamTravelReadOnlyField('Cost Activity', costActivity)
        + teamTravelReadOnlyField('Booking Preference', r.preference_mode === 'self_researched' ? 'Employee self-booked' : 'Travel Admin to book')
        + teamTravelReadOnlyField('Trip Total', '$' + (parseFloat(r.total_cost) || 0).toFixed(2))
        + '</div>'
        + (r.preference_mode === 'self_researched'
            ? '<div class="resume-section"><div class="resume-section-title">Flights</div>' + flightsHtml + '</div>'
              + '<div class="resume-section"><div class="resume-section-title">Hotel</div>' + hotelHtml + '</div>'
              + '<div class="resume-section"><div class="resume-section-title">Car Rental</div>' + carHtml + '</div>'
            : '<div class="info-val" style="color:var(--muted);margin-top:10px;">Employee opted to let Travel Admin book — no proposed arrangements to review.</div>')
        + '<div id="team-travel-note-wrap-' + scope + '" style="display:none;margin-top:16px;">'
        + '<label class="field-label" for="team-travel-note-' + scope + '">Note (required for Return or Deny)</label>'
        + '<textarea class="info-edit-input" id="team-travel-note-' + scope + '" rows="2"></textarea>'
        + '</div>'
        + '<div class="login-error" id="team-travel-action-error-' + scope + '"></div>'
        + '<div class="profile-actions">' + actionsHtml + '<button class="btn-cancel" onclick="document.getElementById(\'team-travel-detail-' + scope + '\').innerHTML=\'\'">Close</button></div>'
        + '</div>';
  }

  var teamTravelPendingAction = {};

  async function renderTeamTravelDetailEditable(detailContainer, r, requesterName){
    if(!travelProjectsCache.length){
      travelProjectsCache = await dbRequest('projects?active=eq.true&select=id,name&order=name.asc');
    }
    if(!travelContractsCache.length){
      travelContractsCache = await dbRequest('gov_contracts?select=id,contract_name&order=contract_name.asc');
    }
    var ownerPrograms = await dbRequest('employee_travel_programs?employee_id=eq.' + r.requester_id + '&select=program_type,provider_name');
    var ownerProfRows = await dbRequest('profiles?id=eq.' + r.requester_id + '&select=known_traveler_number');
    var ownerKtn = ownerProfRows.length ? (ownerProfRows[0].known_traveler_number || '') : '';

    function rewardsOpts(programType, selected){
      var matches = ownerPrograms.filter(function(p){ return p.program_type === programType; });
      var opts = '<option value="">— None —</option>';
      matches.forEach(function(p){
        opts += '<option value="' + escAttr(p.provider_name) + '"' + (p.provider_name === selected ? ' selected' : '') + '>' + p.provider_name + '</option>';
      });
      return opts;
    }

    function flightFieldsHtml(leg, label, data){
      data = data || {};
      return '<div class="resume-row teamtrav-flight-row" data-leg="' + leg + '">'
        + '<div class="resume-row-header">' + label + '</div>'
        + '<div class="resume-row-grid">'
        + '<div class="field-mini-wrap"><span class="field-mini-label">Departure City</span><input class="info-edit-input" data-field="departure_city" value="' + escAttr(data.departure_city) + '"></div>'
        + '<div class="field-mini-wrap"><span class="field-mini-label">Departure State</span><input class="info-edit-input" data-field="departure_state" value="' + escAttr(data.departure_state) + '"></div>'
        + '<div class="field-mini-wrap"><span class="field-mini-label">Airport</span><input class="info-edit-input" data-field="airport" value="' + escAttr(data.airport) + '"></div>'
        + '<div class="field-mini-wrap"><span class="field-mini-label">Airline</span><input class="info-edit-input" data-field="airline" value="' + escAttr(data.airline) + '"></div>'
        + '<div class="field-mini-wrap"><span class="field-mini-label">Flight Number</span><input class="info-edit-input" data-field="flight_number" value="' + escAttr(data.flight_number) + '"></div>'
        + '<div class="field-mini-wrap"><span class="field-mini-label">Departure Time</span><input type="time" class="info-edit-input" data-field="departure_time" value="' + escAttr(data.departure_time) + '"></div>'
        + '<div class="field-mini-wrap"><span class="field-mini-label">Arrival Time</span><input type="time" class="info-edit-input" data-field="arrival_time" value="' + escAttr(data.arrival_time) + '"></div>'
        + '<div class="field-mini-wrap"><span class="field-mini-label">Cost</span><input type="number" step="0.01" class="info-edit-input teamtrav-cost-input" data-field="cost" oninput="teamTravRecalc()" value="' + (parseFloat(data.cost) || 0) + '"></div>'
        + '<div class="field-mini-wrap"><span class="field-mini-label">Known Traveler Number</span><div class="info-val" style="padding:6px 8px;">' + (ownerKtn || '—') + '</div></div>'
        + '<div class="field-mini-wrap"><span class="field-mini-label">Airline Rewards</span><select class="info-edit-input" data-field="rewards_program">' + rewardsOpts('airline', data.rewards_program) + '</select></div>'
        + '</div></div>';
    }

    var detail = r.proposed_arrangements_detail || {};
    var flights = detail.flights || [];
    var departureData = flights.find(function(f){ return f.leg === 'departure'; }) || {};
    var returnData = flights.find(function(f){ return f.leg === 'return'; });
    var hotel = detail.hotel || {};
    var car = detail.car || {};
    var costMode = r.project_id ? 'project' : (r.gov_contract_id ? 'gov_contract' : (r.cost_category === 'training' ? 'training' : ''));

    var bookingHtml = r.preference_mode === 'self_researched'
      ? '<div id="teamtrav-flight-rows">'
        + flightFieldsHtml('departure', 'Departure Flight', departureData)
        + (returnData ? flightFieldsHtml('return', 'Return Flight', returnData) : '')
        + '</div>'
        + '<div class="resume-section"><div class="resume-section-title">Hotel</div>'
        + '<div class="resume-row" id="teamtrav-hotel-row"><div class="resume-row-grid">'
        + '<div class="field-mini-wrap"><span class="field-mini-label">City</span><input class="info-edit-input" id="teamtrav-hotel-city" value="' + escAttr(hotel.city) + '"></div>'
        + '<div class="field-mini-wrap"><span class="field-mini-label">State</span><input class="info-edit-input" id="teamtrav-hotel-state" value="' + escAttr(hotel.state) + '"></div>'
        + '<div class="field-mini-wrap"><span class="field-mini-label">Chain</span><input class="info-edit-input" id="teamtrav-hotel-chain" value="' + escAttr(hotel.chain) + '"></div>'
        + '<div class="field-mini-wrap"><span class="field-mini-label">Check-In Date</span><input type="date" class="info-edit-input" id="teamtrav-hotel-checkin" value="' + escAttr(hotel.check_in_date) + '"></div>'
        + '<div class="field-mini-wrap"><span class="field-mini-label">Check-Out Date</span><input type="date" class="info-edit-input" id="teamtrav-hotel-checkout" value="' + escAttr(hotel.check_out_date) + '"></div>'
        + '<div class="field-mini-wrap"><span class="field-mini-label">Cost</span><input type="number" step="0.01" class="info-edit-input teamtrav-cost-input" id="teamtrav-hotel-cost" oninput="teamTravRecalc()" value="' + (parseFloat(hotel.cost) || 0) + '"></div>'
        + '<div class="field-mini-wrap"><span class="field-mini-label">Hotel Rewards</span><select class="info-edit-input" id="teamtrav-hotel-rewards">' + rewardsOpts('hotel', hotel.rewards_program) + '</select></div>'
        + '</div></div></div>'
        + '<div class="resume-section"><div class="resume-section-title">Car Rental</div>'
        + '<div class="resume-row" id="teamtrav-car-row"><div class="resume-row-grid">'
        + '<div class="field-mini-wrap"><span class="field-mini-label">Chain</span><input class="info-edit-input" id="teamtrav-car-chain" value="' + escAttr(car.chain) + '"></div>'
        + '<div class="field-mini-wrap"><span class="field-mini-label">Pick-Up Location</span><input class="info-edit-input" id="teamtrav-car-pickup-loc" value="' + escAttr(car.pickup_location) + '"></div>'
        + '<div class="field-mini-wrap"><span class="field-mini-label">Pick-Up Date</span><input type="date" class="info-edit-input" id="teamtrav-car-pickup-date" value="' + escAttr(car.pickup_date) + '"></div>'
        + '<div class="field-mini-wrap"><span class="field-mini-label">Drop-Off Location</span><input class="info-edit-input" id="teamtrav-car-dropoff-loc" value="' + escAttr(car.dropoff_location) + '"></div>'
        + '<div class="field-mini-wrap"><span class="field-mini-label">Drop-Off Date</span><input type="date" class="info-edit-input" id="teamtrav-car-dropoff-date" value="' + escAttr(car.dropoff_date) + '"></div>'
        + '<div class="field-mini-wrap"><span class="field-mini-label">Cost</span><input type="number" step="0.01" class="info-edit-input teamtrav-cost-input" id="teamtrav-car-cost" oninput="teamTravRecalc()" value="' + (parseFloat(car.cost) || 0) + '"></div>'
        + '<div class="field-mini-wrap"><span class="field-mini-label">Car Rewards</span><select class="info-edit-input" id="teamtrav-car-rewards">' + rewardsOpts('car_rental', car.rewards_program) + '</select></div>'
        + '</div></div></div>'
      : '<div class="info-val" style="color:var(--muted);margin-top:10px;">Employee opted for Travel Admin to book — no proposed arrangements were submitted. Add details here once booked, or leave as-is.</div>';

    var actionsHtml = '<button class="btn-save" onclick="teamTravelAction(\'admin\',\'' + r.id + '\',\'approved\')">Approve</button>'
      + '<button class="btn-edit" onclick="teamTravelAction(\'admin\',\'' + r.id + '\',\'returned\')">Return</button>'
      + '<button class="btn-cancel" style="color:var(--red);border-color:var(--red);" onclick="teamTravelAction(\'admin\',\'' + r.id + '\',\'denied\')">Deny</button>';

    detailContainer.innerHTML = '<div class="tk-entry-card">'
      + '<div class="tk-section-title">Travel Request — ' + requesterName + ' (editable)</div>'
      + '<div class="tk-pto-form-grid" style="grid-template-columns:1fr 1fr;">'
      + '<div><label class="field-label" for="teamtrav-destination">Destination</label><input class="field-input" id="teamtrav-destination" value="' + escAttr(r.destination) + '"></div>'
      + '<div><label class="field-label" for="teamtrav-purpose">Purpose</label><input class="field-input" id="teamtrav-purpose" value="' + escAttr(r.purpose) + '"></div>'
      + '<div><label class="field-label" for="teamtrav-start">Travel Start Date</label><input type="date" class="field-input" id="teamtrav-start" value="' + escAttr(r.travel_start_date) + '"></div>'
      + '<div><label class="field-label" for="teamtrav-end">Travel End Date</label><input type="date" class="field-input" id="teamtrav-end" value="' + escAttr(r.travel_end_date) + '"></div>'
      + '</div>'
      + '<div class="field-label" style="margin-top:6px;">Cost Activity</div>'
      + '<div class="tk-pto-form-grid" style="grid-template-columns:1fr 1fr;margin-bottom:14px;">'
      + '<div><label class="field-label" for="teamtrav-cost-mode">Bill To</label>'
      + '<select class="field-input" id="teamtrav-cost-mode" onchange="teamTravCostModeChanged()">'
      + '<option value="">— None —</option>'
      + '<option value="project"' + (costMode === 'project' ? ' selected' : '') + '>Project</option>'
      + '<option value="gov_contract"' + (costMode === 'gov_contract' ? ' selected' : '') + '>Government Contract</option>'
      + '<option value="training"' + (costMode === 'training' ? ' selected' : '') + '>Training</option>'
      + '</select></div>'
      + '<div id="teamtrav-cost-detail-wrap" style="display:none;"><label class="field-label" for="teamtrav-cost-detail">Select</label><select class="field-input" id="teamtrav-cost-detail"></select></div>'
      + '</div>'
      + bookingHtml
      + '<div class="tk-entry-card" style="margin-top:14px;margin-bottom:0;">'
      + '<div class="tk-pto-summary-row">'
      + '<div class="tk-pto-stat-box"><div class="tk-pto-stat-label">Flights</div><div class="tk-pto-stat-val" id="teamtrav-total-flights">$0.00</div></div>'
      + '<div class="tk-pto-stat-box"><div class="tk-pto-stat-label">Hotel</div><div class="tk-pto-stat-val" id="teamtrav-total-hotel">$0.00</div></div>'
      + '<div class="tk-pto-stat-box"><div class="tk-pto-stat-label">Car</div><div class="tk-pto-stat-val" id="teamtrav-total-car">$0.00</div></div>'
      + '<div class="tk-pto-stat-box"><div class="tk-pto-stat-label">Trip Total</div><div class="tk-pto-stat-val" id="teamtrav-total-grand">$0.00</div></div>'
      + '</div></div>'
      + '<div id="team-travel-note-wrap-admin" style="display:none;margin-top:16px;">'
      + '<label class="field-label" for="team-travel-note-admin">Note (required for Return or Deny)</label>'
      + '<textarea class="info-edit-input" id="team-travel-note-admin" rows="2"></textarea>'
      + '</div>'
      + '<div class="login-error" id="teamtrav-save-error"></div>'
      + '<div class="login-error" id="team-travel-action-error-admin"></div>'
      + '<div class="profile-actions">'
      + '<button class="btn-save" onclick="saveTeamTravelEdits(\'' + r.id + '\')">Save Changes</button>'
      + actionsHtml
      + '<button class="btn-cancel" onclick="document.getElementById(\'team-travel-detail-admin\').innerHTML=\'\'">Close</button>'
      + '</div></div>';

    if(costMode){
      teamTravCostModeChanged();
      var detailVal = r.project_id || r.gov_contract_id || '';
      if(detailVal){ document.getElementById('teamtrav-cost-detail').value = detailVal; }
    }
    teamTravRecalc();
  }

  function teamTravCostModeChanged(){
    var mode = document.getElementById('teamtrav-cost-mode').value;
    var wrap = document.getElementById('teamtrav-cost-detail-wrap');
    var detailSel = document.getElementById('teamtrav-cost-detail');
    if(mode === 'project'){
      detailSel.innerHTML = travelProjectsCache.map(function(p){ return '<option value="' + p.id + '">' + p.name + '</option>'; }).join('');
      wrap.style.display = '';
    }else if(mode === 'gov_contract'){
      detailSel.innerHTML = travelContractsCache.map(function(c){ return '<option value="' + c.id + '">' + c.contract_name + '</option>'; }).join('');
      wrap.style.display = '';
    }else{
      wrap.style.display = 'none';
      detailSel.innerHTML = '';
    }
  }

  function teamTravRecalc(){
    var flightsSum = 0;
    document.querySelectorAll('#teamtrav-flight-rows .teamtrav-cost-input').forEach(function(el){
      flightsSum += parseFloat(el.value) || 0;
    });
    var hotelCost = parseFloat((document.getElementById('teamtrav-hotel-cost') || {}).value) || 0;
    var carCost = parseFloat((document.getElementById('teamtrav-car-cost') || {}).value) || 0;
    var grand = flightsSum + hotelCost + carCost;

    if(document.getElementById('teamtrav-total-flights')){
      document.getElementById('teamtrav-total-flights').textContent = '$' + flightsSum.toFixed(2);
      document.getElementById('teamtrav-total-hotel').textContent = '$' + hotelCost.toFixed(2);
      document.getElementById('teamtrav-total-car').textContent = '$' + carCost.toFixed(2);
      document.getElementById('teamtrav-total-grand').textContent = '$' + grand.toFixed(2);
    }
    return { flightsSum: flightsSum, hotelCost: hotelCost, carCost: carCost, grand: grand };
  }

  function harvestTeamTravelEdits(requesterId){
    var destination = document.getElementById('teamtrav-destination').value.trim();
    var purpose = document.getElementById('teamtrav-purpose').value.trim();
    var startVal = document.getElementById('teamtrav-start').value;
    var endVal = document.getElementById('teamtrav-end').value;
    var costMode = document.getElementById('teamtrav-cost-mode').value;
    var costDetail = document.getElementById('teamtrav-cost-detail') ? document.getElementById('teamtrav-cost-detail').value : '';

    var hasBooking = !!document.getElementById('teamtrav-hotel-row');
    var detail = null;
    var totals = { flightsSum: 0, hotelCost: 0, carCost: 0, grand: 0 };

    if(hasBooking){
      totals = teamTravRecalc();
      var flightRows = document.querySelectorAll('#teamtrav-flight-rows .teamtrav-flight-row');
      var flights = [];
      flightRows.forEach(function(row){
        var obj = { leg: row.dataset.leg };
        row.querySelectorAll('[data-field]').forEach(function(el){
          obj[el.dataset.field] = el.tagName === 'SELECT' ? el.value : (el.value || '');
        });
        obj.cost = parseFloat(obj.cost) || 0;
        flights.push(obj);
      });

      detail = {
        flights: flights,
        hotel: {
          city: document.getElementById('teamtrav-hotel-city').value.trim(),
          state: document.getElementById('teamtrav-hotel-state').value.trim(),
          chain: document.getElementById('teamtrav-hotel-chain').value.trim(),
          check_in_date: document.getElementById('teamtrav-hotel-checkin').value,
          check_out_date: document.getElementById('teamtrav-hotel-checkout').value,
          cost: totals.hotelCost,
          rewards_program: document.getElementById('teamtrav-hotel-rewards').value
        },
        car: {
          chain: document.getElementById('teamtrav-car-chain').value.trim(),
          pickup_location: document.getElementById('teamtrav-car-pickup-loc').value.trim(),
          pickup_date: document.getElementById('teamtrav-car-pickup-date').value,
          dropoff_location: document.getElementById('teamtrav-car-dropoff-loc').value.trim(),
          dropoff_date: document.getElementById('teamtrav-car-dropoff-date').value,
          cost: totals.carCost,
          rewards_program: document.getElementById('teamtrav-car-rewards').value
        }
      };
    }

    return {
      destination: destination || null,
      purpose: purpose || null,
      travel_start_date: startVal || null,
      travel_end_date: endVal || null,
      project_id: costMode === 'project' ? costDetail : null,
      gov_contract_id: costMode === 'gov_contract' ? costDetail : null,
      cost_category: costMode === 'training' ? 'training' : null,
      proposed_arrangements_detail: detail,
      flights_cost: totals.flightsSum,
      hotel_cost: totals.hotelCost,
      car_cost: totals.carCost,
      total_cost: totals.grand
    };
  }

  async function saveTeamTravelEdits(requestId){
    var errorEl = document.getElementById('teamtrav-save-error');
    errorEl.textContent = '';
    try{
      var body = harvestTeamTravelEdits();
      await dbWrite('travel_requests?id=eq.' + requestId, 'PATCH', body);
      errorEl.style.color = 'var(--teal)';
      errorEl.textContent = 'Saved.';
    }catch(e){
      errorEl.style.color = 'var(--red)';
      errorEl.textContent = 'Couldn\'t save changes. Try again.';
      console.error(e);
    }
  }

  async function teamTravelAction(scope, requestId, decision){
    var noteWrap = document.getElementById('team-travel-note-wrap-' + scope);
    var noteField = document.getElementById('team-travel-note-' + scope);
    var errorEl = document.getElementById('team-travel-action-error-' + scope);
    errorEl.textContent = '';

    if(decision !== 'approved'){
      noteWrap.style.display = '';
      if(!noteField.value.trim()){
        errorEl.textContent = 'A note is required to return or deny this request.';
        return;
      }
    }

    var statusField = scope === 'admin' ? 'travel_status' : 'manager_status';
    var body = {};

    // Admin's detail view is editable — fold in whatever's currently in the
    // form so an edit-then-decide action doesn't silently drop unsaved changes.
    if(scope === 'admin' && document.getElementById('teamtrav-destination')){
      body = harvestTeamTravelEdits();
    }

    body[statusField] = decision;

    // Manager approval that clears moves the overall request forward to Travel Admin's queue.
    // Travel Admin's decision sets the overall current_status (terminal for approve/deny;
    // returned sends it back to the employee as editable).
    if(scope === 'admin'){
      body.current_status = decision === 'approved' ? 'approved' : decision;
    }else{
      body.current_status = decision === 'approved' ? 'submitted' : decision;
    }

    try{
      var session = getSession();
      var existing = await dbRequest('travel_requests?id=eq.' + requestId + '&select=status_history');
      var history = (existing.length && existing[0].status_history) || [];
      history.push({
        by: session.user.id,
        role: scope === 'admin' ? 'travel_admin' : 'manager',
        decision: decision,
        note: noteField ? noteField.value.trim() : '',
        at: new Date().toISOString()
      });
      body.status_history = history;

      await dbWrite('travel_requests?id=eq.' + requestId, 'PATCH', body);
      document.getElementById('team-travel-detail-' + scope).innerHTML = '';
      loadTeamTravel(scope);
    }catch(e){
      errorEl.textContent = 'Couldn\'t save decision. Try again.';
      console.error(e);
    }
  }
