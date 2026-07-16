/* COA Employee Portal — screen-travel-estimate.js
   Travel Estimate subtab (nested under the Travel nav item, alongside
   screen-travel.js's Travel Request (New)): create/edit a draft estimate,
   view own estimates, Internal print, post-approval Customer/Prime copy.
   travel_estimates is its own table with its own status lifecycle
   (draft/submitted/approved/expensed/paid), separate from travel_requests.
   Depends on app-core.js: getSession, dbRequest, dbWrite, escAttr, formatDate.

   Per diem / markup rules (confirmed with client, see CLAUDE.md history):
   - Travel days (departure + return, 2 total) = 1.5x daily M&IE rate each.
   - Full days (nights - 1) = 1x M&IE rate each.
   - Hotel = nights x lodging rate.
   - Fee multiplier (Customer/Prime view only) applies to: airfare, airport
     parking/transport, baggage, hotel, rental car/gas/parking/tolls,
     mileage, shipping to/back. Per diem and EWW are never marked up.
   - fee_multiplier_used is snapshotted onto the row at submit time so a
     later change to travel_settings.fee_multiplier doesn't rewrite history.
   - Only status='draft' rows are editable here; submitted/approved/expensed/
     paid render read-only (approval workflow itself is a follow-up build).
   - Customer/Prime figures are never shown on the live/draft form — only
     Internal numbers exist pre-approval. Once status='approved' (or later),
     the read-only detail view exposes a "Generate Customer/Prime Copy"
     action that computes the marked-up view from the stored internal
     totals + fee_multiplier_used, for viewing/printing only (never a
     separately editable record). Confirmed with user 2026-07-16; who may
     trigger it is intentionally unrestricted for now (anyone who can view
     the estimate) pending confirmation of this whole flow with the client
     — see backlog note in coa_travel_backlog memory / next session prompt. */

  var teEditingId = null;
  var teEditingRow = null;
  var teLiveFeeMultiplier = 1;

  async function loadTravelEstimateScreen(editId){
    var container = document.getElementById('travelestimate-content');
    var session = getSession();
    if(!session || !session.user){ return; }
    teEditingId = editId || null;
    teEditingRow = null;

    try{
      var settingsRows = await dbRequest('travel_settings?select=fee_multiplier&limit=1');
      teLiveFeeMultiplier = settingsRows.length ? (parseFloat(settingsRows[0].fee_multiplier) || 1) : 1;

      if(teEditingId){
        var rows = await dbRequest('travel_estimates?id=eq.' + teEditingId + '&select=*');
        if(rows.length){ teEditingRow = rows[0]; }
      }

      if(teEditingRow && teEditingRow.status !== 'draft'){
        container.innerHTML = '<div id="te-detail-wrap"></div><div class="tk-entry-card"><div class="tk-section-title">My Travel Estimates</div>' + (await teRenderMyEstimatesTable(session.user.id)) + '</div>';
        renderTeReadOnlyDetail(teEditingRow);
        return;
      }

      container.innerHTML = teFormHtml(teEditingRow)
        + '<div class="tk-entry-card">'
        + '<div class="tk-section-title">My Travel Estimates</div>'
        + (await teRenderMyEstimatesTable(session.user.id))
        + '</div>';

      if(teEditingRow){ tePrefillForm(teEditingRow); }
      teRecalc();
    }catch(e){
      container.innerHTML = '<div class="placeholder-card"><div class="placeholder-title">Couldn\'t load travel estimate</div><div class="placeholder-sub">Try refreshing the page.</div></div>';
      console.error(e);
    }
  }

  function teFormHtml(row){
    return '<div class="tk-entry-card">'
      + '<div class="tk-section-title">' + (row ? 'Edit Draft Travel Estimate' : 'New Travel Estimate') + '</div>'
      + '<div class="tk-pto-form-grid" style="grid-template-columns:1fr 1fr;">'
      + '<div><label class="field-label" for="te-destination">Destination / Event</label><input class="field-input" id="te-destination" placeholder="City, State / Event name"></div>'
      + '<div><label class="field-label" for="te-trainers">Number of Trainers</label><input type="number" min="1" step="1" class="field-input" id="te-trainers" value="1" oninput="teRecalc()"></div>'
      + '<div><label class="field-label" for="te-leave-date">Leave Date</label><input type="date" class="field-input" id="te-leave-date" oninput="teRecalc()"></div>'
      + '<div><label class="field-label" for="te-return-date">Return Date</label><input type="date" class="field-input" id="te-return-date" oninput="teRecalc()"></div>'
      + '</div>'
      + '<div class="resume-section"><div class="resume-section-title">Per Diem</div>'
      + '<div class="tk-pto-form-grid" style="grid-template-columns:1fr 1fr;">'
      + '<div><label class="field-label" for="te-lodging-rate">Lodging Rate (per night)</label><input type="number" step="0.01" class="field-input" id="te-lodging-rate" value="0" oninput="teRecalc()"></div>'
      + '<div><label class="field-label" for="te-meals-rate">Meals (M&IE) Rate (per day)</label><input type="number" step="0.01" class="field-input" id="te-meals-rate" value="0" oninput="teRecalc()"></div>'
      + '</div>'
      + '<div class="profile-grid" style="margin-top:4px;">'
      + '<div class="info-box"><div class="info-label">Nights</div><div class="info-val" id="te-calc-nights">0</div></div>'
      + '<div class="info-box"><div class="info-label">Travel Days (1.5x)</div><div class="info-val" id="te-calc-traveldays">2</div></div>'
      + '<div class="info-box"><div class="info-label">Full Days (1x)</div><div class="info-val" id="te-calc-fulldays">0</div></div>'
      + '<div class="info-box"><div class="info-label">Per Diem Meals Total</div><div class="info-val" id="te-calc-perdiem">$0.00</div></div>'
      + '</div>'
      + '</div>'
      + '<div class="resume-section"><div class="resume-section-title">Other Direct Costs</div>'
      + '<div class="tk-pto-form-grid" style="grid-template-columns:1fr 1fr 1fr;">'
      + '<div><label class="field-label" for="te-airfare">Airfare (avg)</label><input type="number" step="0.01" class="field-input te-cost-input" id="te-airfare" value="0" oninput="teRecalc()"></div>'
      + '<div><label class="field-label" for="te-parking-transport">Airport Parking / Transport</label><input type="number" step="0.01" class="field-input te-cost-input" id="te-parking-transport" value="0" oninput="teRecalc()"></div>'
      + '<div><label class="field-label" for="te-baggage">Baggage</label><input type="number" step="0.01" class="field-input te-cost-input" id="te-baggage" value="0" oninput="teRecalc()"></div>'
      + '<div><label class="field-label" for="te-rental-car">Rental Car / Gas / Parking / Tolls</label><input type="number" step="0.01" class="field-input te-cost-input" id="te-rental-car" value="0" oninput="teRecalc()"></div>'
      + '<div><label class="field-label" for="te-mileage">Mileage</label><input type="number" step="0.01" class="field-input te-cost-input" id="te-mileage" value="0" oninput="teRecalc()"></div>'
      + '</div>'
      + '<div class="tk-pto-form-grid" style="grid-template-columns:1fr 1fr;">'
      + '<div><label class="field-label" for="te-shipping-to">Shipping (to)</label><input type="number" step="0.01" class="field-input te-cost-input" id="te-shipping-to" value="0" oninput="teRecalc()"></div>'
      + '<div><label class="field-label" for="te-shipping-back">Shipping (back)</label><input type="number" step="0.01" class="field-input te-cost-input" id="te-shipping-back" value="0" oninput="teRecalc()"></div>'
      + '</div>'
      + '</div>'
      + '<div class="resume-section"><div class="resume-section-title">EWW (Extended Work Week)</div>'
      + '<div class="tk-pto-form-grid" style="grid-template-columns:1fr 1fr;">'
      + '<div><label class="field-label" for="te-eww-rate">EWW Rate (per hour)</label><input type="number" step="0.01" class="field-input" id="te-eww-rate" value="0" oninput="teRecalc()"></div>'
      + '<div><label class="field-label" for="te-eww-hours">EWW Hours per Trainer</label><input type="number" step="0.01" class="field-input" id="te-eww-hours" value="0" oninput="teRecalc()"></div>'
      + '</div>'
      + '</div>'
      + '<div class="tk-entry-card" style="margin-top:14px;margin-bottom:0;">'
      + '<div class="tk-pto-summary-row" style="grid-template-columns:repeat(4,1fr);">'
      + '<div class="tk-pto-stat-box"><div class="tk-pto-stat-label">Per Traveler Subtotal</div><div class="tk-pto-stat-val" id="te-total-per-traveler">$0.00</div></div>'
      + '<div class="tk-pto-stat-box"><div class="tk-pto-stat-label">Trip Lead Total</div><div class="tk-pto-stat-val" id="te-total-trip-lead">$0.00</div></div>'
      + '<div class="tk-pto-stat-box"><div class="tk-pto-stat-label">EWW Total</div><div class="tk-pto-stat-val" id="te-total-eww">$0.00</div></div>'
      + '<div class="tk-pto-stat-box"><div class="tk-pto-stat-label">Grand Total (ODC + EWW)</div><div class="tk-pto-stat-val" id="te-total-grand">$0.00</div></div>'
      + '</div></div>'
      + '<div style="display:flex;gap:10px;margin-top:14px;">'
      + '<button class="btn btn-primary" style="width:auto;padding:12px 20px;" onclick="submitTravelEstimate(\'submitted\')">Submit Estimate</button>'
      + '<button class="btn-cancel" onclick="submitTravelEstimate(\'draft\')">Save as Draft</button>'
      + '<button class="btn-cancel" onclick="loadTravelEstimateScreen()">Cancel</button>'
      + '<button class="btn-edit" onclick="printTravelEstimate()">Print</button>'
      + '</div>'
      + '<div class="login-error" id="te-form-error"></div>'
      + '</div>';
  }

  function tePrefillForm(row){
    document.getElementById('te-destination').value = row.destination_event || '';
    document.getElementById('te-trainers').value = row.number_of_trainers || 1;
    document.getElementById('te-leave-date').value = row.leave_date || '';
    document.getElementById('te-return-date').value = row.return_date || '';
    document.getElementById('te-lodging-rate').value = row.per_diem_lodging_rate || 0;
    document.getElementById('te-meals-rate').value = row.per_diem_meals_rate || 0;
    document.getElementById('te-airfare').value = row.airfare_avg || 0;
    document.getElementById('te-parking-transport').value = row.airport_parking_transport || 0;
    document.getElementById('te-baggage').value = row.baggage || 0;
    document.getElementById('te-rental-car').value = row.rental_car_gas_parking_tolls || 0;
    document.getElementById('te-mileage').value = row.mileage || 0;
    document.getElementById('te-shipping-to').value = row.shipping_to || 0;
    document.getElementById('te-shipping-back').value = row.shipping_back || 0;
    document.getElementById('te-eww-rate').value = row.eww_rate || 0;
    document.getElementById('te-eww-hours').value = row.eww_hours_per_trainer || 0;
  }

  // Core calc, shared by the live form (teRecalc) and the print render. Returns
  // both internal (raw) and customer (fee-multiplied) figures so callers pick
  // whichever the current view needs without recomputing.
  function teCalc(inputs){
    var leave = inputs.leaveDate ? new Date(inputs.leaveDate) : null;
    var ret = inputs.returnDate ? new Date(inputs.returnDate) : null;
    var nights = (leave && ret) ? Math.round((ret - leave) / 86400000) : 0;
    if(nights < 0){ nights = 0; }

    var travelDaysCost = 2 * 1.5 * inputs.mealsRate;
    var fullDays = Math.max(nights - 1, 0);
    var fullDaysCost = fullDays * inputs.mealsRate;
    var perDiemMealsTotal = travelDaysCost + fullDaysCost;
    var hotelTotal = nights * inputs.lodgingRate;

    var markupBucketInternal = hotelTotal + inputs.airfare + inputs.parkingTransport + inputs.baggage + inputs.rentalCar + inputs.mileage;
    var shippingInternal = inputs.shippingTo + inputs.shippingBack;

    var perTravelerInternal = perDiemMealsTotal + markupBucketInternal;
    var tripLeadInternal = perTravelerInternal * inputs.trainers + shippingInternal;
    var odcInternal = tripLeadInternal;
    var ewwTotal = inputs.ewwRate * inputs.ewwHours * inputs.trainers;

    var multiplier = inputs.feeMultiplier;
    var perTravelerCustomer = perDiemMealsTotal + (markupBucketInternal * multiplier);
    var tripLeadCustomer = perTravelerCustomer * inputs.trainers + (shippingInternal * multiplier);
    var odcCustomer = tripLeadCustomer;

    return {
      nights: nights, travelDaysCost: travelDaysCost, fullDays: fullDays, fullDaysCost: fullDaysCost,
      perDiemMealsTotal: perDiemMealsTotal, hotelTotal: hotelTotal, ewwTotal: ewwTotal,
      perTravelerInternal: perTravelerInternal, tripLeadInternal: tripLeadInternal, odcInternal: odcInternal,
      perTravelerCustomer: perTravelerCustomer, tripLeadCustomer: tripLeadCustomer, odcCustomer: odcCustomer
    };
  }

  function teReadFormInputs(){
    return {
      leaveDate: document.getElementById('te-leave-date').value,
      returnDate: document.getElementById('te-return-date').value,
      trainers: parseInt(document.getElementById('te-trainers').value, 10) || 1,
      lodgingRate: parseFloat(document.getElementById('te-lodging-rate').value) || 0,
      mealsRate: parseFloat(document.getElementById('te-meals-rate').value) || 0,
      airfare: parseFloat(document.getElementById('te-airfare').value) || 0,
      parkingTransport: parseFloat(document.getElementById('te-parking-transport').value) || 0,
      baggage: parseFloat(document.getElementById('te-baggage').value) || 0,
      rentalCar: parseFloat(document.getElementById('te-rental-car').value) || 0,
      mileage: parseFloat(document.getElementById('te-mileage').value) || 0,
      shippingTo: parseFloat(document.getElementById('te-shipping-to').value) || 0,
      shippingBack: parseFloat(document.getElementById('te-shipping-back').value) || 0,
      ewwRate: parseFloat(document.getElementById('te-eww-rate').value) || 0,
      ewwHours: parseFloat(document.getElementById('te-eww-hours').value) || 0,
      feeMultiplier: teLiveFeeMultiplier
    };
  }

  function teRecalc(){
    var inputs = teReadFormInputs();
    var calc = teCalc(inputs);

    document.getElementById('te-calc-nights').textContent = calc.nights;
    document.getElementById('te-calc-fulldays').textContent = calc.fullDays;
    document.getElementById('te-calc-perdiem').textContent = '$' + calc.perDiemMealsTotal.toFixed(2);
    document.getElementById('te-total-per-traveler').textContent = '$' + calc.perTravelerInternal.toFixed(2);
    document.getElementById('te-total-trip-lead').textContent = '$' + calc.tripLeadInternal.toFixed(2);
    document.getElementById('te-total-eww').textContent = '$' + calc.ewwTotal.toFixed(2);
    document.getElementById('te-total-grand').textContent = '$' + (calc.odcInternal + calc.ewwTotal).toFixed(2);

    return calc;
  }

  async function teRenderMyEstimatesTable(employeeId){
    var rows = await dbRequest('travel_estimates?created_by=eq.' + employeeId + '&order=created_at.desc&select=id,destination_event,leave_date,return_date,status,trip_lead_total,eww_total');
    if(!rows.length){
      return '<div class="tk-empty">No travel estimates yet.</div>';
    }
    return '<table class="tk-grid-table"><thead><tr><th>Destination / Event</th><th>Dates</th><th>Status</th><th>Grand Total</th><th></th></tr></thead><tbody>'
      + rows.map(function(r){
          var grand = (parseFloat(r.trip_lead_total) || 0) + (parseFloat(r.eww_total) || 0);
          var action = r.status === 'draft'
            ? '<button class="tk-now-btn" type="button" onclick="loadTravelEstimateScreen(\'' + r.id + '\')">Edit Draft</button>'
            : '<button class="tk-now-btn" type="button" onclick="loadTravelEstimateScreen(\'' + r.id + '\')">View</button>';
          return '<tr><td>' + (r.destination_event || '—') + '</td>'
            + '<td>' + formatDate(r.leave_date) + ' – ' + formatDate(r.return_date) + '</td>'
            + '<td>' + tkStatusPill(r.status) + '</td>'
            + '<td>$' + grand.toFixed(2) + '</td>'
            + '<td>' + action + '</td></tr>';
        }).join('')
      + '</tbody></table>';
  }

  var TE_CUSTOMER_COPY_STATUSES = ['approved', 'expensed', 'paid'];

  function renderTeReadOnlyDetail(r){
    var wrap = document.getElementById('te-detail-wrap');
    var grand = (parseFloat(r.trip_lead_total) || 0) + (parseFloat(r.eww_total) || 0);
    var canGenerateCustomerCopy = TE_CUSTOMER_COPY_STATUSES.indexOf(r.status) !== -1;

    wrap.innerHTML = '<div class="tk-entry-card">'
      + '<div class="tk-section-title">Travel Estimate — ' + (r.destination_event || '—') + ' ' + tkStatusPill(r.status) + '</div>'
      + '<div class="placeholder-sub" style="margin-bottom:14px;">This estimate is ' + r.status + ' and can no longer be edited here.</div>'
      + '<div class="profile-grid">'
      + teamTravelReadOnlyField('Dates', formatDate(r.leave_date) + ' – ' + formatDate(r.return_date))
      + teamTravelReadOnlyField('Number of Trainers', r.number_of_trainers)
      + teamTravelReadOnlyField('Per Traveler Subtotal', '$' + (parseFloat(r.per_traveler_subtotal) || 0).toFixed(2))
      + teamTravelReadOnlyField('Trip Lead Total', '$' + (parseFloat(r.trip_lead_total) || 0).toFixed(2))
      + teamTravelReadOnlyField('EWW Total', '$' + (parseFloat(r.eww_total) || 0).toFixed(2))
      + teamTravelReadOnlyField('Grand Total', '$' + grand.toFixed(2))
      + teamTravelReadOnlyField('Fee Multiplier Used', r.fee_multiplier_used || '—')
      + '</div>'
      + (canGenerateCustomerCopy
          ? '<div class="profile-actions"><button class="btn-edit" onclick="teGenerateCustomerCopy(\'' + r.id + '\')">Generate Customer / Prime Copy</button></div>'
          : '<div class="placeholder-sub" style="margin-top:4px;">Customer/Prime copy becomes available once this estimate is approved.</div>')
      + '<div id="te-customer-copy-wrap"></div>'
      + '<div class="profile-actions"><button class="btn-cancel" onclick="loadTravelEstimateScreen()">Back</button></div>'
      + '</div>';
  }

  // Recomputes the fee-multiplied view from the stored row (never live form
  // input, since this only exists for non-draft rows) using the snapshotted
  // fee_multiplier_used. View/print only — never written back to the row.
  // Result is cached in teCustomerCopyContext for printTeCustomerCopy() to
  // use, rather than round-tripping the data through an onclick attribute.
  var teCustomerCopyContext = null;

  function teGenerateCustomerCopy(estimateId){
    var r = teEditingRow && teEditingRow.id === estimateId ? teEditingRow : null;
    if(!r){ return; }
    var inputs = {
      leaveDate: r.leave_date, returnDate: r.return_date, trainers: r.number_of_trainers || 1,
      lodgingRate: parseFloat(r.per_diem_lodging_rate) || 0, mealsRate: parseFloat(r.per_diem_meals_rate) || 0,
      airfare: parseFloat(r.airfare_avg) || 0, parkingTransport: parseFloat(r.airport_parking_transport) || 0,
      baggage: parseFloat(r.baggage) || 0, rentalCar: parseFloat(r.rental_car_gas_parking_tolls) || 0,
      mileage: parseFloat(r.mileage) || 0, shippingTo: parseFloat(r.shipping_to) || 0, shippingBack: parseFloat(r.shipping_back) || 0,
      ewwRate: parseFloat(r.eww_rate) || 0, ewwHours: parseFloat(r.eww_hours_per_trainer) || 0,
      feeMultiplier: parseFloat(r.fee_multiplier_used) || 1
    };
    var calc = teCalc(inputs);
    var grand = calc.odcCustomer + calc.ewwTotal;
    teCustomerCopyContext = { destination: r.destination_event || '—', inputs: inputs, calc: calc };

    document.getElementById('te-customer-copy-wrap').innerHTML = '<div class="tk-entry-card" style="margin-top:14px;">'
      + '<div class="tk-section-title">Customer / Prime Copy</div>'
      + '<div class="profile-grid">'
      + teamTravelReadOnlyField('Per Traveler Subtotal', '$' + calc.perTravelerCustomer.toFixed(2))
      + teamTravelReadOnlyField('Trip Lead Total', '$' + calc.tripLeadCustomer.toFixed(2))
      + teamTravelReadOnlyField('EWW Total', '$' + calc.ewwTotal.toFixed(2))
      + teamTravelReadOnlyField('Grand Total', '$' + grand.toFixed(2))
      + '</div>'
      + '<div class="profile-actions"><button class="btn-edit" onclick="printTeCustomerCopy()">Print Customer / Prime Copy</button></div>'
      + '</div>';
  }

  function printTeCustomerCopy(){
    if(!teCustomerCopyContext){ return; }
    var ctx = teCustomerCopyContext;
    document.getElementById('print-travel-estimate').innerHTML = buildTePrintHtml(ctx.destination, true, ctx.inputs, ctx.calc);
    window.print();
  }

  async function submitTravelEstimate(targetStatus){
    var errorEl = document.getElementById('te-form-error');
    var session = getSession();
    errorEl.textContent = '';

    var destination = document.getElementById('te-destination').value.trim();
    var inputs = teReadFormInputs();

    if(targetStatus === 'submitted'){
      if(!destination || !inputs.leaveDate || !inputs.returnDate){
        errorEl.textContent = 'Destination/Event and both dates are required to submit.';
        return;
      }
      if(new Date(inputs.returnDate) < new Date(inputs.leaveDate)){
        errorEl.textContent = 'Return date must be on or after leave date.';
        return;
      }
    }

    var calc = teCalc(inputs);

    var body = {
      destination_event: destination || null,
      leave_date: inputs.leaveDate || null,
      return_date: inputs.returnDate || null,
      number_of_trainers: inputs.trainers,
      per_diem_lodging_rate: inputs.lodgingRate,
      per_diem_meals_rate: inputs.mealsRate,
      airfare_avg: inputs.airfare,
      airport_parking_transport: inputs.parkingTransport,
      baggage: inputs.baggage,
      rental_car_gas_parking_tolls: inputs.rentalCar,
      mileage: inputs.mileage,
      shipping_to: inputs.shippingTo,
      shipping_back: inputs.shippingBack,
      eww_rate: inputs.ewwRate,
      eww_hours_per_trainer: inputs.ewwHours,
      per_traveler_subtotal: calc.perTravelerInternal,
      trip_lead_total: calc.tripLeadInternal,
      estimated_total_odc: calc.odcInternal,
      eww_total: calc.ewwTotal,
      status: targetStatus
    };
    if(targetStatus === 'submitted'){
      body.fee_multiplier_used = teLiveFeeMultiplier;
    }

    try{
      var previousStatus = teEditingRow ? teEditingRow.status : null;
      var fieldChanges = teDiffFields(teEditingRow, body);

      if(teEditingId){
        await dbWrite('travel_estimates?id=eq.' + teEditingId, 'PATCH', body);
      }else{
        body.created_by = session.user.id;
        await dbWrite('travel_estimates', 'POST', [body]);
        var created = await dbRequest('travel_estimates?created_by=eq.' + session.user.id + '&order=created_at.desc&limit=1&select=id');
        teEditingId = created.length ? created[0].id : null;
      }

      await dbWrite('travel_estimate_audit_log', 'POST', [{
        estimate_id: teEditingId,
        changed_by: session.user.id,
        changed_at: new Date().toISOString(),
        action: (previousStatus && previousStatus !== targetStatus) ? 'status_change' : 'edit',
        field_changes: fieldChanges,
        previous_status: previousStatus,
        new_status: targetStatus
      }]);

      teEditingId = null;
      teEditingRow = null;
      loadTravelEstimateScreen();
    }catch(e){
      errorEl.textContent = 'Couldn\'t save travel estimate. Try again.';
      console.error(e);
    }
  }

  // Field-level before/after diff for the audit log — required so
  // travel_estimate_audit_log captures what changed, not just a status flag.
  function teDiffFields(previousRow, newBody){
    var changes = {};
    Object.keys(newBody).forEach(function(key){
      var before = previousRow ? previousRow[key] : null;
      var after = newBody[key];
      if(before !== after && !(before == null && after == null)){
        changes[key] = { from: before == null ? null : before, to: after == null ? null : after };
      }
    });
    return changes;
  }

  // Shared print markup builder — used by the draft form's Print button
  // (always Internal) and printTeCustomerCopy() (post-approval only).
  function buildTePrintHtml(destination, isCustomer, inputs, calc){
    var perTraveler = isCustomer ? calc.perTravelerCustomer : calc.perTravelerInternal;
    var tripLead = isCustomer ? calc.tripLeadCustomer : calc.tripLeadInternal;
    var odc = isCustomer ? calc.odcCustomer : calc.odcInternal;
    var grand = odc + calc.ewwTotal;

    return '<div class="print-te-page">'
      + '<div class="print-te-title">COA Travel Estimate</div>'
      + '<div class="print-te-sub">' + (isCustomer ? 'Customer / Prime Copy' : 'Internal Copy') + ' — ' + destination + '</div>'
      + '<table><tbody>'
      + '<tr><td>Dates</td><td>' + formatDate(inputs.leaveDate) + ' – ' + formatDate(inputs.returnDate) + '</td></tr>'
      + '<tr><td>Number of Trainers</td><td>' + inputs.trainers + '</td></tr>'
      + '<tr><td>Per Diem Meals Total (not marked up)</td><td>$' + calc.perDiemMealsTotal.toFixed(2) + '</td></tr>'
      + '<tr><td>Per Traveler Subtotal</td><td>$' + perTraveler.toFixed(2) + '</td></tr>'
      + '<tr><td>Trip Lead Total</td><td>$' + tripLead.toFixed(2) + '</td></tr>'
      + '<tr><td>EWW Total</td><td>$' + calc.ewwTotal.toFixed(2) + '</td></tr>'
      + '</tbody></table>'
      + '<div class="print-te-grand">Grand Total: $' + grand.toFixed(2) + '</div>'
      + '</div>';
  }

  // Draft-form Print button — Internal only, since Customer/Prime doesn't
  // exist pre-approval.
  function printTravelEstimate(){
    var inputs = teReadFormInputs();
    var calc = teCalc(inputs);
    var destination = document.getElementById('te-destination').value.trim() || '—';
    document.getElementById('print-travel-estimate').innerHTML = buildTePrintHtml(destination, false, inputs, calc);
    window.print();
  }
