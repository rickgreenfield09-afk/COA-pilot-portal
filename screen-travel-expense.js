/* COA Employee Portal — screen-travel-expense.js
   Travel Expense Report subtab (nested under Travel, alongside Travel
   Request (New) and Travel Estimate): reconcile actual trip costs against
   an approved travel_estimates row. 1:1 with the estimate (one report per
   estimate — multiple trainers on one trip are covered by number_of_trainers,
   not separate reports).
   Depends on app-core.js: getSession, dbRequest, dbWrite, escAttr, formatDate,
   SUPABASE_URL, SUPABASE_ANON_KEY. Depends on screen-travel.js's
   teamTravelReadOnlyField and screen-timekeeping.js's tkStatusPill.

   Rules (confirmed with user):
   - Internal-only document — no Customer/Prime markup concept here.
   - Per diem/EWW stay formula-based (same 1.5x/1x M&IE, rate x hours x
     trainers as the Estimate) but recomputed off actual travel dates.
     Every other cost bucket (airfare, lodging, parking/transport, baggage,
     rental car, mileage, shipping) is a direct actual-dollar entry.
   - Approval is two-stage (supervisor_status, principal_status) rolling
     into current_status — mirrors travel_requests' manager_status/
     travel_status pattern. Only the employee-facing create/submit/view
     screen is built here; the supervisor/principal approval-review UI is a
     follow-up session.
   - Submitting sets the linked travel_estimates.status to 'expensed';
     principal approval (once that follow-up UI exists) sets it to 'paid'.
     This was the intended purpose of those two statuses on travel_estimates.
   - Receipts: one shared upload area for the whole report (not per line
     item), stored in the 'travel-receipts' Supabase Storage bucket —
     simulating what will be Azure Blob Storage post-migration. Uploading
     requires an existing expense_id, so receipts unlock after the first
     Save Draft. */

  var texEditingId = null;
  var texEditingRow = null;
  var texAvailableEstimates = [];
  var texSelectedEstimate = null;
  var texLinkedEstimateTotals = { tripLead: 0, eww: 0 };

  async function loadTravelExpenseScreen(editId){
    var container = document.getElementById('travelexpense-content');
    var session = getSession();
    if(!session || !session.user){ return; }
    texEditingId = editId || null;
    texEditingRow = null;
    texSelectedEstimate = null;

    try{
      if(texEditingId){
        var rows = await dbRequest('travel_expenses?id=eq.' + texEditingId + '&select=*,travel_estimates(destination_event,leave_date,return_date,trip_lead_total,eww_total,number_of_trainers,per_diem_meals_rate,eww_rate,eww_hours_per_trainer)');
        if(rows.length){ texEditingRow = rows[0]; }
      }

      if(texEditingRow && texEditingRow.current_status !== 'draft'){
        container.innerHTML = '<div id="tex-detail-wrap"></div><div class="tk-entry-card"><div class="tk-section-title">My Expense Reports</div>' + (await texRenderMyReportsTable(session.user.id)) + '</div>';
        renderTexReadOnlyDetail(texEditingRow);
        return;
      }

      if(!texEditingRow){
        var approvedEstimates = await dbRequest('travel_estimates?created_by=eq.' + session.user.id + '&status=eq.approved&select=id,destination_event,leave_date,return_date,trip_lead_total,eww_total,number_of_trainers,per_diem_meals_rate,eww_rate,eww_hours_per_trainer');
        var existingRows = await dbRequest('travel_expenses?created_by=eq.' + session.user.id + '&select=estimate_id');
        var takenIds = existingRows.map(function(r){ return r.estimate_id; });
        texAvailableEstimates = approvedEstimates.filter(function(e){ return takenIds.indexOf(e.id) === -1; });
      }

      container.innerHTML = texFormHtml(texEditingRow)
        + '<div class="tk-entry-card">'
        + '<div class="tk-section-title">My Expense Reports</div>'
        + (await texRenderMyReportsTable(session.user.id))
        + '</div>';

      if(texEditingRow){
        texLinkedEstimateTotals = {
          tripLead: parseFloat(texEditingRow.travel_estimates && texEditingRow.travel_estimates.trip_lead_total) || 0,
          eww: parseFloat(texEditingRow.travel_estimates && texEditingRow.travel_estimates.eww_total) || 0
        };
        texPrefillForm(texEditingRow);
        texLoadReceipts(texEditingRow.id, false);
      }
      texRecalc();
    }catch(e){
      container.innerHTML = '<div class="placeholder-card"><div class="placeholder-title">Couldn\'t load travel expense report</div><div class="placeholder-sub">Try refreshing the page.</div></div>';
      console.error(e);
    }
  }

  function texFormHtml(row){
    var isNew = !row;
    var estimateOptionsHtml = texAvailableEstimates.map(function(e){
      return '<option value="' + e.id + '">' + (e.destination_event || '—') + ' (' + formatDate(e.leave_date) + ' – ' + formatDate(e.return_date) + ')</option>';
    }).join('');

    var estimatePickerHtml = isNew
      ? (texAvailableEstimates.length
          ? '<div style="margin-bottom:14px;"><label class="field-label" for="tex-estimate-select">Approved Estimate</label>'
            + '<select class="field-input" id="tex-estimate-select" onchange="texEstimateSelected()">'
            + '<option value="">— Select an approved estimate —</option>' + estimateOptionsHtml + '</select></div>'
          : '<div class="placeholder-sub" style="margin-bottom:14px;">No approved estimates available to expense. Submit a Travel Estimate and get it approved first.</div>')
      : '<div class="profile-grid" style="margin-bottom:14px;">'
        + teamTravelReadOnlyField('Destination / Event', row.travel_estimates ? row.travel_estimates.destination_event : '—')
        + teamTravelReadOnlyField('Estimated Trip Lead + EWW Total', '$' + ((parseFloat(row.travel_estimates && row.travel_estimates.trip_lead_total) || 0) + (parseFloat(row.travel_estimates && row.travel_estimates.eww_total) || 0)).toFixed(2))
        + '</div>';

    return '<div class="tk-entry-card">'
      + '<div class="tk-section-title">' + (row ? 'Edit Draft Expense Report' : 'New Travel Expense Report') + '</div>'
      + estimatePickerHtml
      + '<div id="tex-form-body" style="' + (isNew ? 'display:none;' : '') + '">'
      + '<div class="tk-pto-form-grid" style="grid-template-columns:1fr 1fr;">'
      + '<div><label class="field-label" for="tex-actual-leave-date">Actual Leave Date</label><input type="date" class="field-input" id="tex-actual-leave-date" oninput="texRecalc()"></div>'
      + '<div><label class="field-label" for="tex-actual-return-date">Actual Return Date</label><input type="date" class="field-input" id="tex-actual-return-date" oninput="texRecalc()"></div>'
      + '<div><label class="field-label" for="tex-trainers">Number of Trainers</label><input type="number" min="1" step="1" class="field-input" id="tex-trainers" value="1" oninput="texRecalc()"></div>'
      + '</div>'
      + '<div class="resume-section"><div class="resume-section-title">Per Diem / EWW (formula-based)</div>'
      + '<div class="tk-pto-form-grid" style="grid-template-columns:1fr 1fr 1fr;">'
      + '<div><label class="field-label" for="tex-meals-rate">Meals (M&IE) Rate (per day)</label><input type="number" step="0.01" class="field-input" id="tex-meals-rate" value="0" oninput="texRecalc()"></div>'
      + '<div><label class="field-label" for="tex-eww-rate">EWW Rate (per hour)</label><input type="number" step="0.01" class="field-input" id="tex-eww-rate" value="0" oninput="texRecalc()"></div>'
      + '<div><label class="field-label" for="tex-eww-hours">EWW Hours per Trainer</label><input type="number" step="0.01" class="field-input" id="tex-eww-hours" value="0" oninput="texRecalc()"></div>'
      + '</div>'
      + '<div class="profile-grid" style="margin-top:4px;">'
      + '<div class="info-box"><div class="info-label">Nights</div><div class="info-val" id="tex-calc-nights">0</div></div>'
      + '<div class="info-box"><div class="info-label">Per Diem Meals Total</div><div class="info-val" id="tex-calc-perdiem">$0.00</div></div>'
      + '</div>'
      + '</div>'
      + '<div class="resume-section"><div class="resume-section-title">Actual Costs (receipt-backed)</div>'
      + '<div class="tk-pto-form-grid" style="grid-template-columns:1fr 1fr 1fr;">'
      + '<div><label class="field-label" for="tex-airfare">Airfare</label><input type="number" step="0.01" class="field-input" id="tex-airfare" value="0" oninput="texRecalc()"></div>'
      + '<div><label class="field-label" for="tex-parking-transport">Airport Parking / Transport</label><input type="number" step="0.01" class="field-input" id="tex-parking-transport" value="0" oninput="texRecalc()"></div>'
      + '<div><label class="field-label" for="tex-baggage">Baggage</label><input type="number" step="0.01" class="field-input" id="tex-baggage" value="0" oninput="texRecalc()"></div>'
      + '<div><label class="field-label" for="tex-lodging-total">Lodging (actual total)</label><input type="number" step="0.01" class="field-input" id="tex-lodging-total" value="0" oninput="texRecalc()"></div>'
      + '<div><label class="field-label" for="tex-rental-car">Rental Car / Gas / Parking / Tolls</label><input type="number" step="0.01" class="field-input" id="tex-rental-car" value="0" oninput="texRecalc()"></div>'
      + '<div><label class="field-label" for="tex-mileage">Mileage</label><input type="number" step="0.01" class="field-input" id="tex-mileage" value="0" oninput="texRecalc()"></div>'
      + '</div>'
      + '<div class="tk-pto-form-grid" style="grid-template-columns:1fr 1fr;">'
      + '<div><label class="field-label" for="tex-shipping-to">Shipping (to)</label><input type="number" step="0.01" class="field-input" id="tex-shipping-to" value="0" oninput="texRecalc()"></div>'
      + '<div><label class="field-label" for="tex-shipping-back">Shipping (back)</label><input type="number" step="0.01" class="field-input" id="tex-shipping-back" value="0" oninput="texRecalc()"></div>'
      + '</div>'
      + '</div>'
      + '<div class="resume-section"><div class="resume-section-title">Receipts</div>'
      + (texEditingId
          ? '<input type="file" id="tex-receipt-input" multiple onchange="texUploadReceipts(this.files)">'
          : '<div class="placeholder-sub">Save as Draft first to attach receipts.</div>')
      + '<div id="tex-receipts-list" style="margin-top:10px;"></div>'
      + '</div>'
      + '<div class="tk-entry-card" style="margin-top:14px;margin-bottom:0;">'
      + '<div class="tk-pto-summary-row" style="grid-template-columns:repeat(5,1fr);">'
      + '<div class="tk-pto-stat-box"><div class="tk-pto-stat-label">Per Traveler Subtotal</div><div class="tk-pto-stat-val" id="tex-total-per-traveler">$0.00</div></div>'
      + '<div class="tk-pto-stat-box"><div class="tk-pto-stat-label">Trip Lead Total</div><div class="tk-pto-stat-val" id="tex-total-trip-lead">$0.00</div></div>'
      + '<div class="tk-pto-stat-box"><div class="tk-pto-stat-label">EWW Total</div><div class="tk-pto-stat-val" id="tex-total-eww">$0.00</div></div>'
      + '<div class="tk-pto-stat-box"><div class="tk-pto-stat-label">Actual Grand Total</div><div class="tk-pto-stat-val" id="tex-total-grand">$0.00</div></div>'
      + '<div class="tk-pto-stat-box"><div class="tk-pto-stat-label">Variance vs. Estimate</div><div class="tk-pto-stat-val" id="tex-total-variance">$0.00</div></div>'
      + '</div></div>'
      + '<div style="display:flex;gap:10px;margin-top:14px;">'
      + '<button class="btn btn-primary" style="width:auto;padding:12px 20px;" onclick="submitTravelExpense(\'submitted\')">Submit Expense Report</button>'
      + '<button class="btn-cancel" onclick="submitTravelExpense(\'draft\')">Save as Draft</button>'
      + '<button class="btn-cancel" onclick="loadTravelExpenseScreen()">Cancel</button>'
      + '</div>'
      + '</div>'
      + '<div class="login-error" id="tex-form-error"></div>'
      + '</div>';
  }

  function texEstimateSelected(){
    var id = document.getElementById('tex-estimate-select').value;
    var formBody = document.getElementById('tex-form-body');
    if(!id){ formBody.style.display = 'none'; texSelectedEstimate = null; return; }
    texSelectedEstimate = texAvailableEstimates.filter(function(e){ return e.id === id; })[0] || null;
    if(!texSelectedEstimate){ return; }
    texLinkedEstimateTotals = {
      tripLead: parseFloat(texSelectedEstimate.trip_lead_total) || 0,
      eww: parseFloat(texSelectedEstimate.eww_total) || 0
    };
    formBody.style.display = '';
    document.getElementById('tex-actual-leave-date').value = texSelectedEstimate.leave_date || '';
    document.getElementById('tex-actual-return-date').value = texSelectedEstimate.return_date || '';
    document.getElementById('tex-trainers').value = texSelectedEstimate.number_of_trainers || 1;
    document.getElementById('tex-meals-rate').value = texSelectedEstimate.per_diem_meals_rate || 0;
    document.getElementById('tex-eww-rate').value = texSelectedEstimate.eww_rate || 0;
    document.getElementById('tex-eww-hours').value = texSelectedEstimate.eww_hours_per_trainer || 0;
    texRecalc();
  }

  function texPrefillForm(row){
    document.getElementById('tex-actual-leave-date').value = row.actual_leave_date || '';
    document.getElementById('tex-actual-return-date').value = row.actual_return_date || '';
    document.getElementById('tex-trainers').value = row.number_of_trainers || 1;
    document.getElementById('tex-meals-rate').value = row.per_diem_meals_rate || 0;
    document.getElementById('tex-eww-rate').value = row.eww_rate || 0;
    document.getElementById('tex-eww-hours').value = row.eww_hours_per_trainer || 0;
    document.getElementById('tex-airfare').value = row.actual_airfare || 0;
    document.getElementById('tex-parking-transport').value = row.actual_airport_parking_transport || 0;
    document.getElementById('tex-baggage').value = row.actual_baggage || 0;
    document.getElementById('tex-lodging-total').value = row.actual_lodging_total || 0;
    document.getElementById('tex-rental-car').value = row.actual_rental_car_gas_parking_tolls || 0;
    document.getElementById('tex-mileage').value = row.actual_mileage || 0;
    document.getElementById('tex-shipping-to').value = row.actual_shipping_to || 0;
    document.getElementById('tex-shipping-back').value = row.actual_shipping_back || 0;
  }

  // Purely internal — no fee-multiplier concept, unlike teCalc() in
  // screen-travel-estimate.js. Lodging is an actual total, not rate x
  // nights, since it's receipt-reimbursed rather than formulaic.
  function texCalc(inputs){
    var leave = inputs.leaveDate ? new Date(inputs.leaveDate) : null;
    var ret = inputs.returnDate ? new Date(inputs.returnDate) : null;
    var nights = (leave && ret) ? Math.round((ret - leave) / 86400000) : 0;
    if(nights < 0){ nights = 0; }

    var travelDaysCost = 2 * 1.5 * inputs.mealsRate;
    var fullDaysCost = Math.max(nights - 1, 0) * inputs.mealsRate;
    var perDiemMealsTotal = travelDaysCost + fullDaysCost;

    var costBucket = inputs.lodgingTotal + inputs.airfare + inputs.parkingTransport + inputs.baggage + inputs.rentalCar + inputs.mileage;
    var perTravelerSubtotal = perDiemMealsTotal + costBucket;
    var shipping = inputs.shippingTo + inputs.shippingBack;
    var tripLeadTotal = perTravelerSubtotal * inputs.trainers + shipping;
    var ewwTotal = inputs.ewwRate * inputs.ewwHours * inputs.trainers;

    return {
      nights: nights, perDiemMealsTotal: perDiemMealsTotal,
      perTravelerSubtotal: perTravelerSubtotal, tripLeadTotal: tripLeadTotal,
      totalOdc: tripLeadTotal, ewwTotal: ewwTotal
    };
  }

  function texReadFormInputs(){
    return {
      leaveDate: document.getElementById('tex-actual-leave-date').value,
      returnDate: document.getElementById('tex-actual-return-date').value,
      trainers: parseInt(document.getElementById('tex-trainers').value, 10) || 1,
      mealsRate: parseFloat(document.getElementById('tex-meals-rate').value) || 0,
      ewwRate: parseFloat(document.getElementById('tex-eww-rate').value) || 0,
      ewwHours: parseFloat(document.getElementById('tex-eww-hours').value) || 0,
      airfare: parseFloat(document.getElementById('tex-airfare').value) || 0,
      parkingTransport: parseFloat(document.getElementById('tex-parking-transport').value) || 0,
      baggage: parseFloat(document.getElementById('tex-baggage').value) || 0,
      lodgingTotal: parseFloat(document.getElementById('tex-lodging-total').value) || 0,
      rentalCar: parseFloat(document.getElementById('tex-rental-car').value) || 0,
      mileage: parseFloat(document.getElementById('tex-mileage').value) || 0,
      shippingTo: parseFloat(document.getElementById('tex-shipping-to').value) || 0,
      shippingBack: parseFloat(document.getElementById('tex-shipping-back').value) || 0
    };
  }

  function texRecalc(){
    var inputs = texReadFormInputs();
    var calc = texCalc(inputs);
    var grand = calc.totalOdc + calc.ewwTotal;
    var estimateGrand = texLinkedEstimateTotals.tripLead + texLinkedEstimateTotals.eww;
    var variance = grand - estimateGrand;

    document.getElementById('tex-calc-nights').textContent = calc.nights;
    document.getElementById('tex-calc-perdiem').textContent = '$' + calc.perDiemMealsTotal.toFixed(2);
    document.getElementById('tex-total-per-traveler').textContent = '$' + calc.perTravelerSubtotal.toFixed(2);
    document.getElementById('tex-total-trip-lead').textContent = '$' + calc.tripLeadTotal.toFixed(2);
    document.getElementById('tex-total-eww').textContent = '$' + calc.ewwTotal.toFixed(2);
    document.getElementById('tex-total-grand').textContent = '$' + grand.toFixed(2);
    document.getElementById('tex-total-variance').textContent = (variance >= 0 ? '+$' : '-$') + Math.abs(variance).toFixed(2);

    return calc;
  }

  async function texRenderMyReportsTable(employeeId){
    var rows = await dbRequest('travel_expenses?created_by=eq.' + employeeId + '&order=created_at.desc&select=id,current_status,actual_trip_lead_total,actual_eww_total,variance_total,travel_estimates(destination_event,leave_date,return_date)');
    if(!rows.length){
      return '<div class="tk-empty">No expense reports yet.</div>';
    }
    return '<table class="tk-grid-table"><thead><tr><th>Destination / Event</th><th>Dates</th><th>Status</th><th>Actual Grand Total</th><th>Variance</th><th></th></tr></thead><tbody>'
      + rows.map(function(r){
          var est = r.travel_estimates || {};
          var grand = (parseFloat(r.actual_trip_lead_total) || 0) + (parseFloat(r.actual_eww_total) || 0);
          var variance = parseFloat(r.variance_total) || 0;
          var action = r.current_status === 'draft'
            ? '<button class="tk-now-btn" type="button" onclick="loadTravelExpenseScreen(\'' + r.id + '\')">Edit Draft</button>'
            : '<button class="tk-now-btn" type="button" onclick="loadTravelExpenseScreen(\'' + r.id + '\')">View</button>';
          return '<tr><td>' + (est.destination_event || '—') + '</td>'
            + '<td>' + formatDate(est.leave_date) + ' – ' + formatDate(est.return_date) + '</td>'
            + '<td>' + tkStatusPill(r.current_status) + '</td>'
            + '<td>$' + grand.toFixed(2) + '</td>'
            + '<td>' + (variance >= 0 ? '+$' : '-$') + Math.abs(variance).toFixed(2) + '</td>'
            + '<td>' + action + '</td></tr>';
        }).join('')
      + '</tbody></table>';
  }

  function renderTexReadOnlyDetail(r){
    var wrap = document.getElementById('tex-detail-wrap');
    var est = r.travel_estimates || {};
    var grand = (parseFloat(r.actual_trip_lead_total) || 0) + (parseFloat(r.actual_eww_total) || 0);
    var variance = parseFloat(r.variance_total) || 0;

    wrap.innerHTML = '<div class="tk-entry-card">'
      + '<div class="tk-section-title">Expense Report — ' + (est.destination_event || '—') + ' ' + tkStatusPill(r.current_status) + '</div>'
      + '<div class="placeholder-sub" style="margin-bottom:14px;">This report is ' + r.current_status + ' and can no longer be edited here.</div>'
      + '<div class="profile-grid">'
      + teamTravelReadOnlyField('Actual Dates', formatDate(r.actual_leave_date) + ' – ' + formatDate(r.actual_return_date))
      + teamTravelReadOnlyField('Number of Trainers', r.number_of_trainers)
      + teamTravelReadOnlyField('Per Traveler Subtotal', '$' + (parseFloat(r.actual_per_traveler_subtotal) || 0).toFixed(2))
      + teamTravelReadOnlyField('Trip Lead Total', '$' + (parseFloat(r.actual_trip_lead_total) || 0).toFixed(2))
      + teamTravelReadOnlyField('EWW Total', '$' + (parseFloat(r.actual_eww_total) || 0).toFixed(2))
      + teamTravelReadOnlyField('Actual Grand Total', '$' + grand.toFixed(2))
      + teamTravelReadOnlyField('Variance vs. Estimate', (variance >= 0 ? '+$' : '-$') + Math.abs(variance).toFixed(2))
      + teamTravelReadOnlyField('Supervisor Decision', tkStatusPill(r.supervisor_status))
      + teamTravelReadOnlyField('Principal Decision', tkStatusPill(r.principal_status))
      + '</div>'
      + '<div class="resume-section"><div class="resume-section-title">Receipts</div><div id="tex-receipts-list"></div></div>'
      + '<div class="profile-actions"><button class="btn-cancel" onclick="loadTravelExpenseScreen()">Back</button></div>'
      + '</div>';

    texLoadReceipts(r.id, true);
  }

  async function texLoadReceipts(expenseId, readOnly){
    var listEl = document.getElementById('tex-receipts-list');
    if(!listEl){ return; }
    try{
      var rows = await dbRequest('travel_expense_receipts?expense_id=eq.' + expenseId + '&order=uploaded_at.asc&select=*');
      if(!rows.length){
        listEl.innerHTML = '<div class="tk-empty">No receipts attached yet.</div>';
        return;
      }
      listEl.innerHTML = rows.map(function(rec){
        var removeBtn = readOnly ? '' : ' <button type="button" class="btn-remove-row" style="display:inline;margin-top:0;" onclick="texRemoveReceipt(\'' + rec.id + '\',\'' + escAttr(rec.file_url) + '\')">Remove</button>';
        return '<div class="resume-cart-item"><a href="' + rec.file_url + '" target="_blank" style="color:var(--teal);">' + (rec.file_name || 'Receipt') + '</a>' + removeBtn + '</div>';
      }).join('');
    }catch(e){
      listEl.innerHTML = '<div class="tk-empty">Couldn\'t load receipts.</div>';
      console.error(e);
    }
  }

  async function texUploadReceipts(files){
    if(!texEditingId || !files || !files.length){ return; }
    var session = getSession();
    var errorEl = document.getElementById('tex-form-error');
    for(var i = 0; i < files.length; i++){
      var file = files[i];
      var path = texEditingId + '/' + Date.now() + '-' + file.name;
      try{
        var res = await fetch(SUPABASE_URL + '/storage/v1/object/travel-receipts/' + encodeURIComponent(path), {
          method: 'POST',
          headers: {
            'apikey': SUPABASE_ANON_KEY,
            'Authorization': 'Bearer ' + session.access_token,
            'Content-Type': file.type || 'application/octet-stream'
          },
          body: file
        });
        if(!res.ok){ throw new Error('Upload failed: ' + res.status); }
        var publicUrl = SUPABASE_URL + '/storage/v1/object/public/travel-receipts/' + path;
        await dbWrite('travel_expense_receipts', 'POST', [{
          expense_id: texEditingId, file_url: publicUrl, file_name: file.name, uploaded_by: session.user.id
        }]);
      }catch(e){
        errorEl.textContent = 'Couldn\'t upload ' + file.name + '. Try again.';
        console.error(e);
      }
    }
    document.getElementById('tex-receipt-input').value = '';
    texLoadReceipts(texEditingId, false);
  }

  async function texRemoveReceipt(receiptId, fileUrl){
    try{
      await dbWrite('travel_expense_receipts?id=eq.' + receiptId, 'DELETE', {});
      var path = fileUrl.split('/storage/v1/object/public/travel-receipts/')[1];
      if(path){
        var session = getSession();
        await fetch(SUPABASE_URL + '/storage/v1/object/travel-receipts/' + encodeURIComponent(path), {
          method: 'DELETE',
          headers: { 'apikey': SUPABASE_ANON_KEY, 'Authorization': 'Bearer ' + session.access_token }
        });
      }
      texLoadReceipts(texEditingId, false);
    }catch(e){ console.error(e); }
  }

  async function submitTravelExpense(targetStatus){
    var errorEl = document.getElementById('tex-form-error');
    var session = getSession();
    errorEl.textContent = '';

    var estimateId = texEditingRow ? texEditingRow.estimate_id : (document.getElementById('tex-estimate-select') ? document.getElementById('tex-estimate-select').value : '');
    if(!estimateId){
      errorEl.textContent = 'Select an approved estimate first.';
      return;
    }

    var inputs = texReadFormInputs();
    if(targetStatus === 'submitted'){
      if(!inputs.leaveDate || !inputs.returnDate){
        errorEl.textContent = 'Actual leave and return dates are required to submit.';
        return;
      }
      if(new Date(inputs.returnDate) < new Date(inputs.leaveDate)){
        errorEl.textContent = 'Actual return date must be on or after leave date.';
        return;
      }
    }

    var calc = texCalc(inputs);
    var grand = calc.totalOdc + calc.ewwTotal;
    var estimateGrand = texLinkedEstimateTotals.tripLead + texLinkedEstimateTotals.eww;

    var body = {
      estimate_id: estimateId,
      number_of_trainers: inputs.trainers,
      actual_leave_date: inputs.leaveDate || null,
      actual_return_date: inputs.returnDate || null,
      actual_airfare: inputs.airfare,
      actual_airport_parking_transport: inputs.parkingTransport,
      actual_baggage: inputs.baggage,
      actual_lodging_total: inputs.lodgingTotal,
      actual_rental_car_gas_parking_tolls: inputs.rentalCar,
      actual_mileage: inputs.mileage,
      actual_shipping_to: inputs.shippingTo,
      actual_shipping_back: inputs.shippingBack,
      per_diem_meals_rate: inputs.mealsRate,
      eww_rate: inputs.ewwRate,
      eww_hours_per_trainer: inputs.ewwHours,
      actual_per_diem_meals_total: calc.perDiemMealsTotal,
      actual_per_traveler_subtotal: calc.perTravelerSubtotal,
      actual_trip_lead_total: calc.tripLeadTotal,
      actual_total_odc: calc.totalOdc,
      actual_eww_total: calc.ewwTotal,
      variance_total: grand - estimateGrand,
      current_status: targetStatus
    };
    if(targetStatus === 'submitted'){
      body.supervisor_status = 'pending';
      body.principal_status = 'pending';
    }

    try{
      var previousStatus = texEditingRow ? texEditingRow.current_status : null;
      var fieldChanges = texDiffFields(texEditingRow, body);
      var wasNew = !texEditingId;

      if(texEditingId){
        await dbWrite('travel_expenses?id=eq.' + texEditingId, 'PATCH', body);
      }else{
        body.created_by = session.user.id;
        await dbWrite('travel_expenses', 'POST', [body]);
        var created = await dbRequest('travel_expenses?created_by=eq.' + session.user.id + '&estimate_id=eq.' + estimateId + '&order=created_at.desc&limit=1&select=id');
        texEditingId = created.length ? created[0].id : null;
      }

      await dbWrite('travel_expense_audit_log', 'POST', [{
        expense_id: texEditingId,
        changed_by: session.user.id,
        changed_at: new Date().toISOString(),
        action: (previousStatus && previousStatus !== targetStatus) ? 'status_change' : 'edit',
        field_changes: fieldChanges,
        previous_status: previousStatus,
        new_status: targetStatus
      }]);

      if(targetStatus === 'submitted'){
        await dbWrite('travel_estimates?id=eq.' + estimateId, 'PATCH', { status: 'expensed' });
      }

      if(targetStatus === 'draft' && wasNew){
        // First save of a brand-new draft — reload the same record (now has
        // an id) so the Receipts section unlocks, instead of resetting to a
        // blank new-report form.
        loadTravelExpenseScreen(texEditingId);
      }else{
        texEditingId = null;
        texEditingRow = null;
        loadTravelExpenseScreen();
      }
    }catch(e){
      errorEl.textContent = 'Couldn\'t save expense report. Try again.';
      console.error(e);
    }
  }

  // Field-level before/after diff for the audit log — mirrors teDiffFields()
  // in screen-travel-estimate.js.
  function texDiffFields(previousRow, newBody){
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

  // ---------- Team Expense Report review (My Team = supervisor stage, Admin = principal stage) ----------
  // Two-stage: supervisor_status must clear first (My Team's queue), then
  // principal_status decides (Admin's queue) — mirrors travel_requests'
  // manager_status/travel_status pattern. Supervisor 'approved' passes the
  // report to the principal's queue without changing current_status;
  // principal 'approved' is terminal ('paid') and also flips the linked
  // estimate to 'paid' (the intended purpose of that estimate status, per
  // user). Either stage's deny/return is terminal immediately. "Principal"
  // may need to become "Admin" formally later per user's note — flagged in
  // coa_travel_backlog, kept as a label only so no schema change is needed.
  var teamExpenseReportIds = { myteam: null, admin: null };

  async function loadTeamTravelExpenses(scope){
    var container = document.getElementById(scope + '-travel-expense');
    var session = getSession();
    if(!session || !session.user){ return; }

    try{
      var ids;
      if(scope === 'admin'){
        ids = (await dbRequest('profiles?select=id')).map(function(p){ return p.id; });
      }else{
        ids = await getRecursiveReportIds(session.user.id);
      }
      teamExpenseReportIds[scope] = ids;

      if(!ids.length){
        container.innerHTML = '<div class="tk-empty">No team members found.</div>';
        return;
      }
      var idList = ids.join(',');
      var pendingFilter = scope === 'admin'
        ? '&supervisor_status=eq.approved&principal_status=eq.pending&current_status=eq.submitted'
        : '&supervisor_status=eq.pending&current_status=eq.submitted';

      var pendingRows = await dbRequest('travel_expenses?created_by=in.(' + idList + ')' + pendingFilter + '&select=id,created_by,actual_trip_lead_total,actual_eww_total,variance_total,travel_estimates(destination_event,leave_date,return_date)&order=created_at.asc');
      var allRows = await dbRequest('travel_expenses?created_by=in.(' + idList + ')&current_status=neq.draft&select=id,created_by,current_status,supervisor_status,principal_status,actual_trip_lead_total,actual_eww_total,variance_total,travel_estimates(destination_event,leave_date,return_date)&order=created_at.desc');

      var namesById = {};
      var nameRows = await dbRequest('profiles?id=in.(' + idList + ')&select=id,full_name');
      nameRows.forEach(function(r){ namesById[r.id] = r.full_name; });

      function rowHtml(r, isPendingTable){
        var est = r.travel_estimates || {};
        var grand = (parseFloat(r.actual_trip_lead_total) || 0) + (parseFloat(r.actual_eww_total) || 0);
        var variance = parseFloat(r.variance_total) || 0;
        var statusCell = isPendingTable ? '' : '<td>' + tkStatusPill(r.current_status) + '</td>';
        return '<tr><td>' + (namesById[r.created_by] || '—') + '</td>'
          + '<td>' + (est.destination_event || '—') + '</td>'
          + '<td>' + formatDate(est.leave_date) + ' – ' + formatDate(est.return_date) + '</td>'
          + statusCell
          + '<td>$' + grand.toFixed(2) + '</td>'
          + '<td>' + (variance >= 0 ? '+$' : '-$') + Math.abs(variance).toFixed(2) + '</td>'
          + '<td><button class="tk-now-btn" type="button" onclick="openTeamExpenseDetail(\'' + scope + '\',\'' + r.id + '\')">' + (isPendingTable ? 'Review' : 'View') + '</button></td></tr>';
      }

      container.innerHTML = '<div class="tk-entry-card">'
        + '<div class="tk-section-title">Needs Your Approval (' + pendingRows.length + ')</div>'
        + (pendingRows.length
            ? '<table class="tk-grid-table"><thead><tr><th>Employee</th><th>Destination / Event</th><th>Dates</th><th>Actual Total</th><th>Variance</th><th></th></tr></thead><tbody>'
              + pendingRows.map(function(r){ return rowHtml(r, true); }).join('')
              + '</tbody></table>'
            : '<div class="tk-empty">Nothing pending.</div>')
        + '</div>'
        + '<div class="tk-entry-card">'
        + '<div class="tk-section-title">' + (scope === 'admin' ? 'All Company Expense Reports' : 'All Team Expense Reports') + '</div>'
        + (allRows.length
            ? '<table class="tk-grid-table"><thead><tr><th>Employee</th><th>Destination / Event</th><th>Dates</th><th>Status</th><th>Actual Total</th><th>Variance</th><th></th></tr></thead><tbody>'
              + allRows.map(function(r){ return rowHtml(r, false); }).join('')
              + '</tbody></table>'
            : '<div class="tk-empty">No submitted expense reports yet.</div>')
        + '</div>'
        + '<div id="team-expense-detail-' + scope + '"></div>';
    }catch(e){
      container.innerHTML = '<div class="placeholder-card"><div class="placeholder-title">Couldn\'t load expense reports</div><div class="placeholder-sub">Try refreshing the page.</div></div>';
      console.error(e);
    }
  }

  async function openTeamExpenseDetail(scope, expenseId){
    var detailContainer = document.getElementById('team-expense-detail-' + scope);
    detailContainer.innerHTML = '<div class="tk-entry-card"><div class="placeholder-sub">Loading report...</div></div>';
    detailContainer.scrollIntoView({ behavior: 'smooth', block: 'start' });

    try{
      var rows = await dbRequest('travel_expenses?id=eq.' + expenseId + '&select=*,travel_estimates(destination_event,leave_date,return_date,trip_lead_total,eww_total)');
      if(!rows.length){ detailContainer.innerHTML = ''; return; }
      var r = rows[0];
      var nameRows = await dbRequest('profiles?id=eq.' + r.created_by + '&select=full_name');
      var employeeName = nameRows.length ? nameRows[0].full_name : '—';
      await renderTeamExpenseDetail(detailContainer, scope, r, employeeName);
    }catch(e){
      detailContainer.innerHTML = '<div class="placeholder-card"><div class="placeholder-title">Couldn\'t load report</div><div class="placeholder-sub">Try refreshing the page.</div></div>';
      console.error(e);
    }
  }

  async function renderTeamExpenseDetail(detailContainer, scope, r, employeeName){
    var est = r.travel_estimates || {};
    var grand = (parseFloat(r.actual_trip_lead_total) || 0) + (parseFloat(r.actual_eww_total) || 0);
    var variance = parseFloat(r.variance_total) || 0;

    var canAct = scope === 'admin'
      ? (r.current_status === 'submitted' && r.supervisor_status === 'approved' && r.principal_status === 'pending')
      : (r.current_status === 'submitted' && r.supervisor_status === 'pending');

    var actionsHtml = canAct
      ? '<button class="btn-save" onclick="teamExpenseAction(\'' + scope + '\',\'' + r.id + '\',\'approved\')">Approve</button>'
        + '<button class="btn-edit" onclick="teamExpenseAction(\'' + scope + '\',\'' + r.id + '\',\'returned\')">Return</button>'
        + '<button class="btn-cancel" style="color:var(--red);border-color:var(--red);" onclick="teamExpenseAction(\'' + scope + '\',\'' + r.id + '\',\'denied\')">Deny</button>'
      : '';

    var receiptsRows = await dbRequest('travel_expense_receipts?expense_id=eq.' + r.id + '&order=uploaded_at.asc&select=*');
    var receiptsHtml = receiptsRows.length
      ? receiptsRows.map(function(rec){ return '<div class="resume-cart-item"><a href="' + rec.file_url + '" target="_blank" style="color:var(--teal);">' + (rec.file_name || 'Receipt') + '</a></div>'; }).join('')
      : '<div class="tk-empty">No receipts attached.</div>';

    detailContainer.innerHTML = '<div class="tk-entry-card">'
      + '<div class="tk-section-title">Expense Report — ' + employeeName + ' ' + tkStatusPill(r.current_status) + '</div>'
      + '<div class="profile-grid">'
      + teamTravelReadOnlyField('Destination / Event', est.destination_event)
      + teamTravelReadOnlyField('Actual Dates', formatDate(r.actual_leave_date) + ' – ' + formatDate(r.actual_return_date))
      + teamTravelReadOnlyField('Number of Trainers', r.number_of_trainers)
      + teamTravelReadOnlyField('Per Traveler Subtotal', '$' + (parseFloat(r.actual_per_traveler_subtotal) || 0).toFixed(2))
      + teamTravelReadOnlyField('Trip Lead Total', '$' + (parseFloat(r.actual_trip_lead_total) || 0).toFixed(2))
      + teamTravelReadOnlyField('EWW Total', '$' + (parseFloat(r.actual_eww_total) || 0).toFixed(2))
      + teamTravelReadOnlyField('Actual Grand Total', '$' + grand.toFixed(2))
      + teamTravelReadOnlyField('Variance vs. Estimate', (variance >= 0 ? '+$' : '-$') + Math.abs(variance).toFixed(2))
      + teamTravelReadOnlyField('Supervisor Decision', tkStatusPill(r.supervisor_status))
      + teamTravelReadOnlyField('Principal Decision', tkStatusPill(r.principal_status))
      + '</div>'
      + '<div class="resume-section"><div class="resume-section-title">Receipts</div>' + receiptsHtml + '</div>'
      + (canAct
          ? '<div id="team-expense-note-wrap-' + scope + '" style="display:none;margin-top:16px;">'
            + '<label class="field-label" for="team-expense-note-' + scope + '">Note (required for Return or Deny)</label>'
            + '<textarea class="info-edit-input" id="team-expense-note-' + scope + '" rows="2"></textarea>'
            + '</div>'
          : '')
      + '<div class="login-error" id="team-expense-action-error-' + scope + '"></div>'
      + '<div class="profile-actions">' + actionsHtml + '<button class="btn-cancel" onclick="document.getElementById(\'team-expense-detail-' + scope + '\').innerHTML=\'\'">Close</button></div>'
      + '</div>';
  }

  async function teamExpenseAction(scope, expenseId, decision){
    var noteWrap = document.getElementById('team-expense-note-wrap-' + scope);
    var noteField = document.getElementById('team-expense-note-' + scope);
    var errorEl = document.getElementById('team-expense-action-error-' + scope);
    errorEl.textContent = '';

    if(decision !== 'approved'){
      noteWrap.style.display = '';
      if(!noteField.value.trim()){
        errorEl.textContent = 'A note is required to return or deny this report.';
        return;
      }
    }

    try{
      var session = getSession();
      var existing = await dbRequest('travel_expenses?id=eq.' + expenseId + '&select=current_status,supervisor_status,principal_status,estimate_id');
      if(!existing.length){ return; }
      var prev = existing[0];

      var statusField = scope === 'admin' ? 'principal_status' : 'supervisor_status';
      var body = {};
      body[statusField] = decision;

      if(scope === 'admin'){
        body.current_status = decision === 'approved' ? 'paid' : decision;
      }else{
        body.current_status = decision === 'approved' ? 'submitted' : decision;
      }

      await dbWrite('travel_expenses?id=eq.' + expenseId, 'PATCH', body);

      if(scope === 'admin' && decision === 'approved'){
        await dbWrite('travel_estimates?id=eq.' + prev.estimate_id, 'PATCH', { status: 'paid' });
      }

      await dbWrite('travel_expense_audit_log', 'POST', [{
        expense_id: expenseId,
        changed_by: session.user.id,
        changed_at: new Date().toISOString(),
        action: 'status_change',
        field_changes: {
          current_status: { from: prev.current_status, to: body.current_status },
          note: noteField ? noteField.value.trim() : null
        },
        previous_status: prev.current_status,
        new_status: body.current_status
      }]);

      document.getElementById('team-expense-detail-' + scope).innerHTML = '';
      loadTeamTravelExpenses(scope);
    }catch(e){
      errorEl.textContent = 'Couldn\'t save decision. Try again.';
      console.error(e);
    }
  }
