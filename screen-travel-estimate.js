/* COA Employee Portal — screen-travel-estimate.js
   Travel Estimate subtab (nested under the Travel nav item, alongside
   screen-travel.js's Travel Request (New)): create/edit a draft estimate,
   view own estimates, Internal print, post-approval Customer/Prime copy.
   travel_estimates is its own table with its own status lifecycle
   (draft/submitted/approved/expensed/paid), separate from travel_requests.
   Depends on app-core.js: getSession, dbRequest, dbWrite, escAttr, formatDate.

   Per diem / markup rules — verified 2026-07-16 against the source-of-truth
   spreadsheet (CyberOffset_Travel_estimate_V26.0, "To Prime"/"COA Internal"
   tabs), superseding an earlier session's incorrect assumption:
   - Travel days = 1.5x daily M&IE rate, ONCE (not once per departure/return).
   - Full days (nights - 1) = 1x M&IE rate each.
   - Hotel = nights x lodging rate.
   - Per-traveler bucket, multiplied by number of trainers: airfare, airport
     parking/transport, baggage, per diem, hotel.
   - Trip-level bucket, NOT multiplied by trainers (added once regardless of
     headcount): rental car/gas/parking/tolls, mileage, shipping to/back.
   - Fee multiplier (Customer/Prime view only) applies to everything in both
     buckets above except per diem. Per diem and EWW are never marked up.
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
  //
  // Matches the source-of-truth spreadsheet (CyberOffset_Travel_estimate_V26.0,
  // "To Prime"/"COA Internal" tabs), verified 2026-07-16:
  // - Travel Days per diem = 1.5x M&IE ONCE (not per-departure-and-return —
  //   an earlier session's "both ends" assumption was wrong; the spreadsheet
  //   formula D15=G7*1.5 is the confirmed source of truth).
  // - Two separate buckets: a "per-traveler" bucket (airfare, parking/
  //   transport, baggage, per diem, hotel) that gets multiplied by
  //   number of trainers, and a "trip-level" bucket (rental car/gas/parking/
  //   tolls, mileage, shipping to/back) that does NOT — those costs don't
  //   scale with headcount. Previously rental car and mileage were wrongly
  //   included in the per-traveler (multiplied) bucket.
  function teCalc(inputs){
    var leave = inputs.leaveDate ? new Date(inputs.leaveDate) : null;
    var ret = inputs.returnDate ? new Date(inputs.returnDate) : null;
    var nights = (leave && ret) ? Math.round((ret - leave) / 86400000) : 0;
    if(nights < 0){ nights = 0; }

    var travelDaysCost = 1.5 * inputs.mealsRate;
    var fullDays = Math.max(nights - 1, 0);
    var fullDaysCost = fullDays * inputs.mealsRate;
    var perDiemMealsTotal = travelDaysCost + fullDaysCost;
    var hotelTotal = nights * inputs.lodgingRate;

    var perTravelerMarkupBucket = hotelTotal + inputs.airfare + inputs.parkingTransport + inputs.baggage;
    var tripLevelBucket = inputs.rentalCar + inputs.mileage + inputs.shippingTo + inputs.shippingBack;

    var perTravelerInternal = perDiemMealsTotal + perTravelerMarkupBucket;
    var tripLeadInternal = (perTravelerInternal * inputs.trainers) + tripLevelBucket;
    var odcInternal = tripLeadInternal;
    var ewwTotal = inputs.ewwRate * inputs.ewwHours * inputs.trainers;

    var multiplier = inputs.feeMultiplier;
    var perTravelerCustomer = perDiemMealsTotal + (perTravelerMarkupBucket * multiplier);
    var tripLeadCustomer = (perTravelerCustomer * inputs.trainers) + (tripLevelBucket * multiplier);
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
  // Layout and groupings deliberately mirror the source-of-truth
  // spreadsheet's "To Prime" tab (verified 2026-07-16): header/destination,
  // travel dates + per diem rates, trainer count, the per-traveler cost
  // group culminating in "Per Traveler"/"Subtotal", the trip-level cost
  // group culminating in "Trip lead total", the combined "Estimated Total
  // Travel Cost (ODC)", then the EWW group. The fee multiplier (Customer/
  // Prime only) is applied per-line here rather than only to the totals,
  // so every line item shown matches what the spreadsheet itself displays.
  function buildTePrintHtml(destination, isCustomer, inputs, calc){
    var multiplier = isCustomer ? inputs.feeMultiplier : 1;

    var airfareShown = inputs.airfare * multiplier;
    var parkingShown = inputs.parkingTransport * multiplier;
    var baggageShown = inputs.baggage * multiplier;
    var hotelShown = calc.hotelTotal * multiplier;
    var rentalCarShown = inputs.rentalCar * multiplier;
    var mileageShown = inputs.mileage * multiplier;
    var shippingToShown = inputs.shippingTo * multiplier;
    var shippingBackShown = inputs.shippingBack * multiplier;

    var perTravelerShown = isCustomer ? calc.perTravelerCustomer : calc.perTravelerInternal;
    var subtotalShown = perTravelerShown * inputs.trainers;
    var tripLevelShown = rentalCarShown + mileageShown + shippingToShown + shippingBackShown;
    var estimatedTotalOdc = subtotalShown + tripLevelShown;
    var ewwHoursTotal = inputs.ewwHours * inputs.trainers;
    var grand = estimatedTotalOdc + calc.ewwTotal;

    return '<div class="print-te-page">'
      + '<div class="print-te-title">Travel Estimate for trip to: ' + destination + '</div>'
      + '<div class="print-te-sub">' + (isCustomer ? 'Customer / Prime Copy' : 'Internal Copy') + '</div>'

      + '<table><tbody>'
      + '<tr><td>Leave On</td><td>' + formatDate(inputs.leaveDate) + '</td><td>Return On</td><td>' + formatDate(inputs.returnDate) + '</td></tr>'
      + '</tbody></table>'

      + '<table><thead><tr><th>Per Diem Rates</th><th>Lodging*</th><th>ME&amp;I</th></tr></thead><tbody>'
      + '<tr><td></td><td>$' + (parseFloat(inputs.lodgingRate) || 0).toFixed(2) + '</td><td>$' + (parseFloat(inputs.mealsRate) || 0).toFixed(2) + '</td></tr>'
      + '</tbody></table>'
      + '<div class="print-te-footnote">*includes taxes</div>'

      + '<table><tbody><tr><td>Number of Trainers</td><td>' + inputs.trainers + '</td></tr></tbody></table>'

      + '<div class="print-te-section-title">ODC (Per Traveler)</div>'
      + '<table><tbody>'
      + '<tr><td>Airfare (average)</td><td>$' + airfareShown.toFixed(2) + '</td></tr>'
      + '<tr><td>Airport Parking/Transport</td><td>$' + parkingShown.toFixed(2) + '</td></tr>'
      + '<tr><td>Baggage</td><td>$' + baggageShown.toFixed(2) + '</td></tr>'
      + '<tr><td>Per Diem (Travel Days)</td><td>$' + calc.travelDaysCost.toFixed(2) + '</td></tr>'
      + '<tr><td>Per Diem (Full Days)</td><td>$' + calc.fullDaysCost.toFixed(2) + '</td></tr>'
      + '<tr><td>Hotel</td><td>$' + hotelShown.toFixed(2) + '</td></tr>'
      + '<tr><td><strong>Per Traveler</strong></td><td><strong>$' + perTravelerShown.toFixed(2) + '</strong></td></tr>'
      + '<tr><td><strong>Subtotal</strong> (&times; ' + inputs.trainers + ' trainer' + (inputs.trainers === 1 ? '' : 's') + ')</td><td><strong>$' + subtotalShown.toFixed(2) + '</strong></td></tr>'
      + '</tbody></table>'

      + '<div class="print-te-section-title">Trip Lead Total</div>'
      + '<table><tbody>'
      + '<tr><td>Rental Cars/Gas/Parking/Tolls</td><td>$' + rentalCarShown.toFixed(2) + '</td></tr>'
      + '<tr><td>Mileage</td><td>$' + mileageShown.toFixed(2) + '</td></tr>'
      + '<tr><td>Shipping To</td><td>$' + shippingToShown.toFixed(2) + '</td></tr>'
      + '<tr><td>Shipping Back</td><td>$' + shippingBackShown.toFixed(2) + '</td></tr>'
      + '<tr><td><strong>Trip lead total</strong></td><td><strong>$' + tripLevelShown.toFixed(2) + '</strong></td></tr>'
      + '</tbody></table>'

      + '<div class="print-te-grand">Estimated Total Travel Cost (ODC): $' + estimatedTotalOdc.toFixed(2) + '</div>'

      + '<div class="print-te-section-title">EWW</div>'
      + '<table><tbody>'
      + '<tr><td>EWW Hours per Trainer</td><td>' + inputs.ewwHours + '</td></tr>'
      + '<tr><td>EWW Hours Total</td><td>' + ewwHoursTotal + '</td></tr>'
      + '<tr><td>EWW Total</td><td>$' + calc.ewwTotal.toFixed(2) + '</td></tr>'
      + '</tbody></table>'

      + '<div class="print-te-grand">Grand Total (ODC + EWW): $' + grand.toFixed(2) + '</div>'
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

  // ---------- Team Travel Estimate review (My Team = manager approval, Admin = full override) ----------
  // travel_estimates has a single approved_by/approved_at slot — both My
  // Team and Admin can Approve/Return/Deny it (Admin has full override
  // power over everything per user's explicit call 2026-07-16; only 2-3
  // people ever hold the Admin role, so a race between manager and Admin
  // deciding the same field is an accepted, unlikely-in-practice risk).
  var teamEstimateReportIds = { myteam: null, admin: null };

  async function loadTeamTravelEstimates(scope){
    var container = document.getElementById(scope + '-travel-estimate');
    var session = getSession();
    if(!session || !session.user){ return; }

    try{
      var ids;
      if(scope === 'admin'){
        ids = (await dbRequest('profiles?select=id')).map(function(p){ return p.id; });
      }else{
        ids = await getRecursiveReportIds(session.user.id);
      }
      teamEstimateReportIds[scope] = ids;

      if(!ids.length){
        container.innerHTML = '<div class="tk-empty">No team members found.</div>';
        return;
      }
      var idList = ids.join(',');

      var pendingRows = await dbRequest('travel_estimates?created_by=in.(' + idList + ')&status=eq.submitted&select=id,created_by,destination_event,leave_date,return_date,trip_lead_total,eww_total&order=created_at.asc');
      var allRows = await dbRequest('travel_estimates?created_by=in.(' + idList + ')&status=neq.draft&select=id,created_by,destination_event,leave_date,return_date,status,trip_lead_total,eww_total&order=created_at.desc');

      var namesById = {};
      var nameRows = await dbRequest('profiles?id=in.(' + idList + ')&select=id,full_name');
      nameRows.forEach(function(r){ namesById[r.id] = r.full_name; });

      var pendingHtml = '<div class="tk-entry-card">'
        + '<div class="tk-section-title">Needs Your Approval (' + pendingRows.length + ')</div>'
        + (pendingRows.length
            ? '<table class="tk-grid-table"><thead><tr><th>Employee</th><th>Destination / Event</th><th>Dates</th><th>Grand Total</th><th></th></tr></thead><tbody>'
              + pendingRows.map(function(r){
                  var grand = (parseFloat(r.trip_lead_total) || 0) + (parseFloat(r.eww_total) || 0);
                  return '<tr><td>' + (namesById[r.created_by] || '—') + '</td>'
                    + '<td>' + (r.destination_event || '—') + '</td>'
                    + '<td>' + formatDate(r.leave_date) + ' – ' + formatDate(r.return_date) + '</td>'
                    + '<td>$' + grand.toFixed(2) + '</td>'
                    + '<td><button class="tk-now-btn" type="button" onclick="openTeamEstimateDetail(\'' + scope + '\',\'' + r.id + '\')">Review</button></td></tr>';
                }).join('')
              + '</tbody></table>'
            : '<div class="tk-empty">Nothing pending.</div>')
        + '</div>';

      container.innerHTML = pendingHtml
        + '<div class="tk-entry-card">'
        + '<div class="tk-section-title">' + (scope === 'admin' ? 'All Company Travel Estimates' : 'All Team Travel Estimates') + '</div>'
        + (allRows.length
            ? '<table class="tk-grid-table"><thead><tr><th>Employee</th><th>Destination / Event</th><th>Dates</th><th>Status</th><th>Grand Total</th><th></th></tr></thead><tbody>'
              + allRows.map(function(r){
                  var grand = (parseFloat(r.trip_lead_total) || 0) + (parseFloat(r.eww_total) || 0);
                  return '<tr><td>' + (namesById[r.created_by] || '—') + '</td>'
                    + '<td>' + (r.destination_event || '—') + '</td>'
                    + '<td>' + formatDate(r.leave_date) + ' – ' + formatDate(r.return_date) + '</td>'
                    + '<td>' + tkStatusPill(r.status) + '</td>'
                    + '<td>$' + grand.toFixed(2) + '</td>'
                    + '<td><button class="tk-now-btn" type="button" onclick="openTeamEstimateDetail(\'' + scope + '\',\'' + r.id + '\')">View</button></td></tr>';
                }).join('')
              + '</tbody></table>'
            : '<div class="tk-empty">No submitted travel estimates yet.</div>')
        + '</div>'
        + '<div id="team-estimate-detail-' + scope + '"></div>';
    }catch(e){
      container.innerHTML = '<div class="placeholder-card"><div class="placeholder-title">Couldn\'t load travel estimates</div><div class="placeholder-sub">Try refreshing the page.</div></div>';
      console.error(e);
    }
  }

  async function openTeamEstimateDetail(scope, estimateId){
    var detailContainer = document.getElementById('team-estimate-detail-' + scope);
    detailContainer.innerHTML = '<div class="tk-entry-card"><div class="placeholder-sub">Loading estimate...</div></div>';
    detailContainer.scrollIntoView({ behavior: 'smooth', block: 'start' });

    try{
      var rows = await dbRequest('travel_estimates?id=eq.' + estimateId + '&select=*');
      if(!rows.length){ detailContainer.innerHTML = ''; return; }
      var r = rows[0];
      var nameRows = await dbRequest('profiles?id=eq.' + r.created_by + '&select=full_name');
      var employeeName = nameRows.length ? nameRows[0].full_name : '—';
      renderTeamEstimateDetail(detailContainer, scope, r, employeeName);
    }catch(e){
      detailContainer.innerHTML = '<div class="placeholder-card"><div class="placeholder-title">Couldn\'t load estimate</div><div class="placeholder-sub">Try refreshing the page.</div></div>';
      console.error(e);
    }
  }

  function renderTeamEstimateDetail(detailContainer, scope, r, employeeName){
    var grand = (parseFloat(r.trip_lead_total) || 0) + (parseFloat(r.eww_total) || 0);
    var canAct = r.status === 'submitted';
    var breakdownId = 'team-estimate-breakdown-' + scope;

    var actionsHtml = canAct
      ? '<button class="btn-save" onclick="teamEstimateAction(\'' + scope + '\',\'' + r.id + '\',\'approved\')">Approve</button>'
        + '<button class="btn-edit" onclick="teamEstimateAction(\'' + scope + '\',\'' + r.id + '\',\'returned\')">Return</button>'
        + '<button class="btn-cancel" style="color:var(--red);border-color:var(--red);" onclick="teamEstimateAction(\'' + scope + '\',\'' + r.id + '\',\'denied\')">Deny</button>'
      : '';

    detailContainer.innerHTML = '<div class="tk-entry-card">'
      + '<div class="tk-section-title">Travel Estimate — ' + employeeName + ' ' + tkStatusPill(r.status) + '</div>'
      + '<div class="profile-grid">'
      + teamTravelReadOnlyField('Destination / Event', r.destination_event)
      + teamTravelReadOnlyField('Dates', formatDate(r.leave_date) + ' – ' + formatDate(r.return_date))
      + teamTravelReadOnlyField('Number of Trainers', r.number_of_trainers)
      + teamTravelReadOnlyField('Per Traveler Subtotal', '$' + (parseFloat(r.per_traveler_subtotal) || 0).toFixed(2))
      + teamTravelReadOnlyField('Trip Lead Total', '$' + (parseFloat(r.trip_lead_total) || 0).toFixed(2))
      + teamTravelReadOnlyField('EWW Total', '$' + (parseFloat(r.eww_total) || 0).toFixed(2))
      + teamTravelReadOnlyField('Grand Total', '$' + grand.toFixed(2))
      + '</div>'
      + '<button type="button" class="btn-edit" style="margin-top:6px;" onclick="toggleDetailBreakdown(\'' + breakdownId + '\')">Show Full Cost Breakdown</button>'
      + '<div class="profile-grid" id="' + breakdownId + '" style="display:none;margin-top:12px;">'
      + teamTravelReadOnlyField('Lodging Rate (per night)', '$' + (parseFloat(r.per_diem_lodging_rate) || 0).toFixed(2))
      + teamTravelReadOnlyField('Meals (M&IE) Rate (per day)', '$' + (parseFloat(r.per_diem_meals_rate) || 0).toFixed(2))
      + teamTravelReadOnlyField('Airfare (avg)', '$' + (parseFloat(r.airfare_avg) || 0).toFixed(2))
      + teamTravelReadOnlyField('Airport Parking / Transport', '$' + (parseFloat(r.airport_parking_transport) || 0).toFixed(2))
      + teamTravelReadOnlyField('Baggage', '$' + (parseFloat(r.baggage) || 0).toFixed(2))
      + teamTravelReadOnlyField('Rental Car / Gas / Parking / Tolls', '$' + (parseFloat(r.rental_car_gas_parking_tolls) || 0).toFixed(2))
      + teamTravelReadOnlyField('Mileage', '$' + (parseFloat(r.mileage) || 0).toFixed(2))
      + teamTravelReadOnlyField('Shipping (to)', '$' + (parseFloat(r.shipping_to) || 0).toFixed(2))
      + teamTravelReadOnlyField('Shipping (back)', '$' + (parseFloat(r.shipping_back) || 0).toFixed(2))
      + teamTravelReadOnlyField('EWW Rate (per hour)', '$' + (parseFloat(r.eww_rate) || 0).toFixed(2))
      + teamTravelReadOnlyField('EWW Hours per Trainer', r.eww_hours_per_trainer)
      + '</div>'
      + (canAct
          ? '<div id="team-estimate-note-wrap-' + scope + '" style="display:none;margin-top:16px;">'
            + '<label class="field-label" for="team-estimate-note-' + scope + '">Note (required for Return or Deny)</label>'
            + '<textarea class="info-edit-input" id="team-estimate-note-' + scope + '" rows="2"></textarea>'
            + '</div>'
          : '')
      + '<div class="login-error" id="team-estimate-action-error-' + scope + '"></div>'
      + '<div class="profile-actions">' + actionsHtml + '<button class="btn-cancel" onclick="document.getElementById(\'team-estimate-detail-' + scope + '\').innerHTML=\'\'">Close</button></div>'
      + '</div>';
  }

  async function teamEstimateAction(scope, estimateId, decision){
    var noteWrap = document.getElementById('team-estimate-note-wrap-' + scope);
    var noteField = document.getElementById('team-estimate-note-' + scope);
    var errorEl = document.getElementById('team-estimate-action-error-' + scope);
    errorEl.textContent = '';

    if(decision !== 'approved'){
      noteWrap.style.display = '';
      if(!noteField.value.trim()){
        errorEl.textContent = 'A note is required to return or deny this estimate.';
        return;
      }
    }

    try{
      var session = getSession();
      var existing = await dbRequest('travel_estimates?id=eq.' + estimateId + '&select=status');
      var previousStatus = existing.length ? existing[0].status : null;

      var body = { status: decision };
      if(decision === 'approved'){
        body.approved_by = session.user.id;
        body.approved_at = new Date().toISOString();
      }

      await dbWrite('travel_estimates?id=eq.' + estimateId, 'PATCH', body);

      await dbWrite('travel_estimate_audit_log', 'POST', [{
        estimate_id: estimateId,
        changed_by: session.user.id,
        changed_at: new Date().toISOString(),
        action: 'status_change',
        field_changes: { status: { from: previousStatus, to: decision }, note: noteField ? noteField.value.trim() : null },
        previous_status: previousStatus,
        new_status: decision
      }]);

      document.getElementById('team-estimate-detail-' + scope).innerHTML = '';
      loadTeamTravelEstimates(scope);
    }catch(e){
      errorEl.textContent = 'Couldn\'t save decision. Try again.';
      console.error(e);
    }
  }
