/* COA Employee Portal — screen-burndown.js
   Admin-only Burndown data entry: Customers/Contracts/Contacts CRUD, the
   Billing Tree (billing_nodes, self-referencing) with SLIN detail (slin
   funding ledger + employee authorization ledger), and the SLIN Table
   (filterable existing-SLIN view + bulk multi-row SLIN/funding entry).
   Second increment (2026-08-06, driven by a real Task Order Mod document):
   added contract_contacts UI, slins.option_year (see
   add-slin-option-year.sql — run before this build's option-year fields do
   anything useful), option-year filtering on the tree and SLIN Table, and
   the reusable bulk SLIN-entry widget (bdBulk*) used standalone in the
   SLIN Table subtab and embedded inside Add Customer.
   Still NOT included: labor_categories, employee_rates, indirect_pools,
   indirect_rates, admin_audit_log, qbo_sync_mapping — later sessions.
   No delete UI anywhere in this file (create/edit only) — deferred.
   Depends on app-core.js: getSession, dbRequest, dbWrite, escAttr, isAdmin. */

  // ---------- Subtab switcher ----------
  function switchBurndownSubtab(name){
    document.querySelectorAll('#screen-burndown .bd-subscreen').forEach(function(s){ s.classList.remove('active'); });
    document.querySelectorAll('#screen-burndown [data-bdsubtab]').forEach(function(b){ b.classList.toggle('active', b.dataset.bdsubtab === name); });
    document.getElementById('bd-' + name).classList.add('active');
    if(name === 'customers'){ bdLoadCustomers(); }
    if(name === 'tree'){ bdLoadTreeContractPicker(); }
    if(name === 'slintable'){ bdLoadSlinTableContractPicker(); }
  }

  // ---------- Shared small render helpers ----------
  function bdInput(label, id, value, type){
    return '<div><label class="field-label">' + label + '</label><input type="' + (type||'text') + '" id="' + id + '" class="field-input" value="' + escAttr(value == null ? '' : value) + '"></div>';
  }
  function bdSelect(label, id, options, selected){
    return '<div><label class="field-label">' + label + '</label><select id="' + id + '" class="field-input">'
      + options.map(function(o){ return '<option value="' + escAttr(o.value) + '"' + (o.value === selected ? ' selected' : '') + '>' + o.label + '</option>'; }).join('')
      + '</select></div>';
  }
  function bdCheckboxRow(label, id, checked){
    return '<div style="display:flex;align-items:center;gap:8px;margin-bottom:18px;"><input type="checkbox" id="' + id + '"' + (checked ? ' checked' : '') + '><label class="field-label" style="margin:0;" for="' + id + '">' + label + '</label></div>';
  }
  function bdMoney(v){
    if(v == null || v === ''){ return '—'; }
    return '$' + Number(v).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }
  function bdVal(id){
    var el = document.getElementById(id);
    return el ? el.value : '';
  }
  function bdChecked(id){
    var el = document.getElementById(id);
    return el ? el.checked : false;
  }

  // ---------- Shared profiles cache (for the employee authorization picker) ----------
  var bdAllProfiles = null;
  async function bdFetchProfiles(){
    if(bdAllProfiles){ return bdAllProfiles; }
    bdAllProfiles = await dbRequest('profiles?select=id,full_name&order=full_name.asc');
    return bdAllProfiles;
  }

  // ---------- Shared constants (used across Customers, Tree, and SLIN Table) ----------
  var bdContractTypes = ['CPFF', 'COST', 'FFP', 'T&M'];
  var bdSlinCategories = ['Labor/Fee', 'ODC/Cost', 'Materials'];
  var bdContactRoles = ['Technical POC', 'Contractual POC', 'Security POC', 'Billing POC'];

  // ---------- Contract Contacts (shared by Add Contract, Edit Contract, and
  // the Add Customer "also add first contract" flow) ----------
  function bdContactFieldsGrid(prefix, existingByRole){
    return bdContactRoles.map(function(role){
      var c = (existingByRole && existingByRole[role]) || {};
      var key = prefix + '-' + role.replace(/\s+/g, '');
      return '<div class="bd-nested-section">'
        + '<div class="tk-section-title">' + role + '</div>'
        + '<input type="hidden" id="' + key + '-id" value="' + escAttr(c.contact_id || '') + '">'
        + '<div class="asset-form-grid">'
        + bdInput('Name', key + '-name', c.name)
        + bdInput('Email', key + '-email', c.email)
        + bdInput('Phone', key + '-phone', c.phone)
        + '</div></div>';
    }).join('');
  }

  async function bdFetchContactsForContract(contractId){
    var rows = await dbRequest('contract_contacts?contract_id=eq.' + contractId + '&select=*');
    var byRole = {};
    rows.forEach(function(r){ byRole[r.contact_role] = { contact_id: r.contact_id, name: r.name, email: r.email, phone: r.phone }; });
    return byRole;
  }

  // Upserts one row per role that has a Name filled in — PATCH if that role
  // already had a contact (hidden -id field populated), POST otherwise.
  // Blank roles are left alone (no delete UI, matching the rest of the app).
  async function bdSaveContactsForContract(contractId, prefix){
    var session = getSession();
    for(var i = 0; i < bdContactRoles.length; i++){
      var role = bdContactRoles[i];
      var key = prefix + '-' + role.replace(/\s+/g, '');
      var name = bdVal(key + '-name');
      if(!name){ continue; }
      var existingId = bdVal(key + '-id');
      var email = bdVal(key + '-email') || null;
      var phone = bdVal(key + '-phone') || null;
      if(existingId){
        await dbWrite('contract_contacts?contact_id=eq.' + existingId, 'PATCH', {
          name: name, email: email, phone: phone, updated_by: session.user.id
        });
      }else{
        await dbWrite('contract_contacts', 'POST', {
          contact_id: crypto.randomUUID(),
          contract_id: contractId,
          contact_role: role,
          name: name,
          email: email,
          phone: phone,
          created_by: session.user.id
        });
      }
    }
  }

  // =============================================================
  // CUSTOMERS + CONTRACTS
  // =============================================================

  var bdCustomers = [];
  var bdCustomerTypes = ['Prime', 'Sub-to', 'Gov direct', 'Internal'];

  async function bdLoadCustomers(){
    var container = document.getElementById('bd-customers-list');
    try{
      bdCustomers = await dbRequest('customers?select=*&order=name.asc');
      bdRenderCustomerList();
    }catch(e){
      container.innerHTML = '<div class="placeholder-card"><div class="placeholder-title">Couldn\'t load customers</div><div class="placeholder-sub">Try refreshing the page.</div></div>';
      console.error(e);
    }
  }

  function bdRenderCustomerList(){
    var container = document.getElementById('bd-customers-list');
    var addBtnHtml = '<div class="tk-grid-actions" style="justify-content:flex-start;margin-bottom:16px;"><button class="btn btn-primary" style="width:auto;padding:11px 20px;" onclick="bdShowAddCustomerForm()">+ Add Customer</button></div>'
      + '<div id="bd-add-customer-form-wrap"></div>';

    if(!bdCustomers.length){
      container.innerHTML = addBtnHtml + '<div class="tk-empty">No customers yet.</div>';
      return;
    }

    container.innerHTML = addBtnHtml + bdCustomers.map(function(c){
      return '<div class="tk-entry-card bd-row-card">'
        + '<div class="bd-row-summary" onclick="bdToggleCustomerRow(\'' + c.customer_id + '\')">'
        + '<div><div class="bd-row-title">' + escAttr(c.name) + '</div>'
        + '<div class="bd-row-sub">' + escAttr(c.customer_type) + (c.is_active ? '' : ' · Inactive') + '</div></div>'
        + '<div class="bd-status-pill' + (c.is_active ? ' bd-pill-active' : ' bd-pill-muted') + '">' + (c.is_active ? 'Active' : 'Inactive') + '</div>'
        + '</div>'
        + '<div class="bd-row-expand" id="bd-customer-expand-' + c.customer_id + '"></div>'
        + '</div>';
    }).join('');
  }

  function bdToggleCustomerRow(customerId){
    var wrap = document.getElementById('bd-customer-expand-' + customerId);
    if(!wrap){ return; }
    if(wrap.classList.contains('open')){
      wrap.classList.remove('open');
      wrap.innerHTML = '';
      return;
    }
    wrap.classList.add('open');
    bdRenderCustomerDetail(customerId);
  }

  function bdRenderCustomerDetail(customerId){
    var c = bdCustomers.find(function(x){ return x.customer_id === customerId; });
    var wrap = document.getElementById('bd-customer-expand-' + customerId);
    if(!c || !wrap){ return; }
    wrap.innerHTML = '<div class="bd-detail-inline">'
      + '<div class="asset-form-grid">'
      + bdInput('Name', 'bdc-name-' + customerId, c.name)
      + bdSelect('Customer Type', 'bdc-type-' + customerId, bdCustomerTypes.map(function(t){ return { value: t, label: t }; }), c.customer_type)
      + bdInput('CAGE Code', 'bdc-cage-' + customerId, c.cage_code)
      + bdInput('UEI', 'bdc-uei-' + customerId, c.uei)
      + bdInput('Address', 'bdc-address-' + customerId, c.address)
      + '</div>'
      + bdCheckboxRow('Active', 'bdc-active-' + customerId, c.is_active)
      + '<div class="tk-grid-actions">'
      + '<button class="btn-cancel" onclick="bdToggleCustomerRow(\'' + customerId + '\')">Close</button>'
      + '<button class="btn btn-primary" style="width:auto;padding:11px 20px;" onclick="bdSaveCustomer(\'' + customerId + '\')">Save</button>'
      + '</div>'
      + '<div class="login-error" id="bdc-error-' + customerId + '"></div>'
      + '<div class="bd-nested-section"><div class="tk-section-title">Contracts</div><div id="bd-contracts-for-' + customerId + '"><div class="tk-empty">Loading...</div></div></div>'
      + '</div>';
    bdLoadContractsForCustomer(customerId);
  }

  async function bdSaveCustomer(customerId){
    var errorEl = document.getElementById('bdc-error-' + customerId);
    var name = bdVal('bdc-name-' + customerId);
    if(!name){ errorEl.textContent = 'Name is required.'; return; }
    try{
      await dbWrite('customers?customer_id=eq.' + customerId, 'PATCH', {
        name: name,
        customer_type: bdVal('bdc-type-' + customerId),
        cage_code: bdVal('bdc-cage-' + customerId) || null,
        uei: bdVal('bdc-uei-' + customerId) || null,
        address: bdVal('bdc-address-' + customerId) || null,
        is_active: bdChecked('bdc-active-' + customerId),
        updated_by: getSession().user.id
      });
      await bdLoadCustomers();
    }catch(e){
      errorEl.textContent = 'Could not save — try again.';
      console.error(e);
    }
  }

  var bdPendingNewCustomerContractId = null;

  function bdShowAddCustomerForm(){
    var wrap = document.getElementById('bd-add-customer-form-wrap');
    wrap.innerHTML = '<div class="tk-entry-card bd-add-form">'
      + '<div class="asset-form-grid">'
      + bdInput('Name', 'bdc-new-name', '')
      + bdSelect('Customer Type', 'bdc-new-type', bdCustomerTypes.map(function(t){ return { value: t, label: t }; }), bdCustomerTypes[0])
      + bdInput('CAGE Code', 'bdc-new-cage', '')
      + bdInput('UEI', 'bdc-new-uei', '')
      + bdInput('Address', 'bdc-new-address', '')
      + '</div>'
      + bdCheckboxRow('Also add this customer\'s first contract now — POCs, and SLINs/funding straight from a Task Order or Mod document', 'bdc-new-includecontract', false)
      + '<div id="bdc-new-contract-wrap"></div>'
      + '<div class="tk-grid-actions">'
      + '<button class="btn-cancel" onclick="document.getElementById(\'bd-add-customer-form-wrap\').innerHTML=\'\';bdPendingNewCustomerContractId=null;delete bdBulk.newcust;">Cancel</button>'
      + '<button class="btn btn-primary" style="width:auto;padding:11px 20px;" onclick="bdSubmitAddCustomer()">Add Customer</button>'
      + '</div>'
      + '<div class="login-error" id="bdc-new-error"></div>'
      + '</div>';
    document.getElementById('bdc-new-includecontract').addEventListener('change', bdToggleNewCustomerContractSection);
  }

  function bdToggleNewCustomerContractSection(){
    var wrap = document.getElementById('bdc-new-contract-wrap');
    if(!bdChecked('bdc-new-includecontract')){
      wrap.innerHTML = '';
      bdPendingNewCustomerContractId = null;
      delete bdBulk.newcust;
      return;
    }
    bdPendingNewCustomerContractId = crypto.randomUUID();
    wrap.innerHTML = '<div class="bd-nested-section">'
      + '<div class="tk-section-title">Contract</div>'
      + '<div class="asset-form-grid">'
      + bdInput('Prime Contract #', 'bdc-new-k-pcn', '')
      + bdInput('Delivery Order #', 'bdc-new-k-don', '')
      + bdInput('Subcontract #', 'bdc-new-k-scn', '')
      + bdSelect('Contract Type', 'bdc-new-k-type', bdContractTypes.map(function(t){ return { value: t, label: t }; }), bdContractTypes[0])
      + bdInput('Fee Type', 'bdc-new-k-feetype', '')
      + bdInput('Fee % (default)', 'bdc-new-k-fee', '', 'number')
      + bdInput('DPAS Priority Rating', 'bdc-new-k-dpas', '')
      + bdInput('Payment Terms', 'bdc-new-k-terms', '')
      + '</div>'
      + '<div class="tk-section-title" style="margin-top:16px;">Contract Contacts</div>'
      + bdContactFieldsGrid('bdc-new-contacts', null)
      + '<div class="tk-section-title" style="margin-top:16px;">SLINs (optional — add now, straight off the document, or later from the Billing Tree / SLIN Table)</div>'
      + '<div id="bdc-new-bulk-wrap"></div>'
      + '</div>';
    bdBulkInit('newcust', 'bdc-new-bulk-wrap', bdPendingNewCustomerContractId, null, null, true);
  }

  async function bdSubmitAddCustomer(){
    var errorEl = document.getElementById('bdc-new-error');
    var name = bdVal('bdc-new-name');
    if(!name){ errorEl.textContent = 'Name is required.'; return; }
    var session = getSession();
    var customerId = crypto.randomUUID();
    var includeContract = bdChecked('bdc-new-includecontract');
    try{
      await dbWrite('customers', 'POST', {
        customer_id: customerId,
        name: name,
        customer_type: bdVal('bdc-new-type'),
        cage_code: bdVal('bdc-new-cage') || null,
        uei: bdVal('bdc-new-uei') || null,
        address: bdVal('bdc-new-address') || null,
        is_active: true,
        created_by: session.user.id
      });

      if(includeContract){
        var contractId = bdPendingNewCustomerContractId;
        await dbWrite('contracts', 'POST', {
          contract_id: contractId,
          customer_id: customerId,
          prime_contract_number: bdVal('bdc-new-k-pcn') || null,
          delivery_order_number: bdVal('bdc-new-k-don') || null,
          subcontract_number: bdVal('bdc-new-k-scn') || null,
          contract_type: bdVal('bdc-new-k-type'),
          fee_type: bdVal('bdc-new-k-feetype') || null,
          fee_percentage: bdVal('bdc-new-k-fee') ? parseFloat(bdVal('bdc-new-k-fee')) : null,
          dpas_priority_rating: bdVal('bdc-new-k-dpas') || null,
          payment_terms: bdVal('bdc-new-k-terms') || null,
          status: 'active',
          created_by: session.user.id
        });

        await bdSaveContactsForContract(contractId, 'bdc-new-contacts');

        if(bdBulk.newcust){
          bdBulkSyncFromDom('newcust');
          bdBulk.newcust.customerId = customerId;
          await bdBulkSaveRows('newcust');
        }
      }

      document.getElementById('bd-add-customer-form-wrap').innerHTML = '';
      bdPendingNewCustomerContractId = null;
      delete bdBulk.newcust;
      await bdLoadCustomers();
    }catch(e){
      errorEl.textContent = 'Could not add customer — some records may have been partially saved. Check the Customers list and Billing Tree before retrying.';
      console.error(e);
    }
  }

  // ---- Contracts (nested under a customer) ----

  async function bdLoadContractsForCustomer(customerId){
    var container = document.getElementById('bd-contracts-for-' + customerId);
    if(!container){ return; }
    try{
      var rows = await dbRequest('contracts?customer_id=eq.' + customerId + '&select=*&order=prime_contract_number.asc');
      bdRenderContractsForCustomer(customerId, rows);
    }catch(e){
      container.innerHTML = '<div class="tk-empty">Couldn\'t load contracts.</div>';
      console.error(e);
    }
  }

  function bdRenderContractsForCustomer(customerId, rows){
    var container = document.getElementById('bd-contracts-for-' + customerId);
    if(!container){ return; }
    var addBtn = '<button class="btn-edit" onclick="bdShowAddContractForm(\'' + customerId + '\')">+ Add Contract</button>'
      + '<div id="bd-add-contract-form-wrap-' + customerId + '"></div>';

    var listHtml = rows.length
      ? rows.map(function(k){
          return '<div class="bd-row-card-nested">'
            + '<div class="bd-row-summary" onclick="bdToggleContractRow(\'' + k.contract_id + '\')">'
            + '<div><div class="bd-row-title">' + escAttr(k.prime_contract_number || k.subcontract_number || '(unnumbered)') + '</div>'
            + '<div class="bd-row-sub">' + escAttr(k.contract_type) + ' · ' + escAttr(k.status) + '</div></div>'
            + '</div>'
            + '<div class="bd-row-expand" id="bd-contract-expand-' + k.contract_id + '"></div>'
            + '</div>';
        }).join('')
      : '<div class="tk-empty">No contracts for this customer yet.</div>';

    container.innerHTML = addBtn + listHtml;
    // Keep the fetched rows accessible to bdToggleContractRow/bdSaveContract without a second round trip.
    bdContractsByCustomer[customerId] = rows;
  }

  var bdContractsByCustomer = {};

  function bdShowAddContractForm(customerId){
    var wrap = document.getElementById('bd-add-contract-form-wrap-' + customerId);
    wrap.innerHTML = '<div class="bd-add-form">'
      + '<div class="asset-form-grid">'
      + bdInput('Prime Contract #', 'bdk-new-pcn-' + customerId, '')
      + bdInput('Delivery Order #', 'bdk-new-don-' + customerId, '')
      + bdInput('Subcontract #', 'bdk-new-scn-' + customerId, '')
      + bdSelect('Contract Type', 'bdk-new-type-' + customerId, bdContractTypes.map(function(t){ return { value: t, label: t }; }), bdContractTypes[0])
      + bdInput('Fee Type', 'bdk-new-feetype-' + customerId, '')
      + bdInput('Fee % (default)', 'bdk-new-fee-' + customerId, '', 'number')
      + bdInput('DPAS Priority Rating', 'bdk-new-dpas-' + customerId, '')
      + bdInput('Payment Terms', 'bdk-new-terms-' + customerId, '')
      + '</div>'
      + '<div class="tk-section-title" style="margin-top:16px;">Contract Contacts</div>'
      + bdContactFieldsGrid('bdk-new-contacts-' + customerId, null)
      + '<div class="tk-grid-actions">'
      + '<button class="btn-cancel" onclick="document.getElementById(\'bd-add-contract-form-wrap-' + customerId + '\').innerHTML=\'\'">Cancel</button>'
      + '<button class="btn btn-primary" style="width:auto;padding:11px 20px;" onclick="bdSubmitAddContract(\'' + customerId + '\')">Add Contract</button>'
      + '</div>'
      + '<div class="login-error" id="bdk-new-error-' + customerId + '"></div>'
      + '</div>';
  }

  async function bdSubmitAddContract(customerId){
    var errorEl = document.getElementById('bdk-new-error-' + customerId);
    var contractId = crypto.randomUUID();
    try{
      await dbWrite('contracts', 'POST', {
        contract_id: contractId,
        customer_id: customerId,
        prime_contract_number: bdVal('bdk-new-pcn-' + customerId) || null,
        delivery_order_number: bdVal('bdk-new-don-' + customerId) || null,
        subcontract_number: bdVal('bdk-new-scn-' + customerId) || null,
        contract_type: bdVal('bdk-new-type-' + customerId),
        fee_type: bdVal('bdk-new-feetype-' + customerId) || null,
        fee_percentage: bdVal('bdk-new-fee-' + customerId) ? parseFloat(bdVal('bdk-new-fee-' + customerId)) : null,
        dpas_priority_rating: bdVal('bdk-new-dpas-' + customerId) || null,
        payment_terms: bdVal('bdk-new-terms-' + customerId) || null,
        status: 'active',
        created_by: getSession().user.id
      });
      await bdSaveContactsForContract(contractId, 'bdk-new-contacts-' + customerId);
      document.getElementById('bd-add-contract-form-wrap-' + customerId).innerHTML = '';
      await bdLoadContractsForCustomer(customerId);
    }catch(e){
      errorEl.textContent = 'Could not add contract — try again.';
      console.error(e);
    }
  }

  async function bdToggleContractRow(contractId){
    var wrap = document.getElementById('bd-contract-expand-' + contractId);
    if(!wrap){ return; }
    if(wrap.classList.contains('open')){
      wrap.classList.remove('open');
      wrap.innerHTML = '';
      return;
    }
    wrap.classList.add('open');
    var k = null;
    Object.keys(bdContractsByCustomer).some(function(custId){
      var found = bdContractsByCustomer[custId].find(function(x){ return x.contract_id === contractId; });
      if(found){ k = found; }
      return !!found;
    });
    if(!k){ return; }
    wrap.innerHTML = '<div class="tk-empty">Loading...</div>';
    var contactsByRole = {};
    try{ contactsByRole = await bdFetchContactsForContract(contractId); }catch(e){ console.error(e); }
    wrap.innerHTML = '<div class="bd-detail-inline">'
      + '<div class="asset-form-grid">'
      + bdInput('Prime Contract #', 'bdk-pcn-' + contractId, k.prime_contract_number)
      + bdInput('Delivery Order #', 'bdk-don-' + contractId, k.delivery_order_number)
      + bdInput('Subcontract #', 'bdk-scn-' + contractId, k.subcontract_number)
      + bdSelect('Contract Type', 'bdk-type-' + contractId, bdContractTypes.map(function(t){ return { value: t, label: t }; }), k.contract_type)
      + bdInput('Fee Type', 'bdk-feetype-' + contractId, k.fee_type)
      + bdInput('Fee % (default)', 'bdk-fee-' + contractId, k.fee_percentage, 'number')
      + bdInput('DPAS Priority Rating', 'bdk-dpas-' + contractId, k.dpas_priority_rating)
      + bdInput('Payment Terms', 'bdk-terms-' + contractId, k.payment_terms)
      + bdSelect('Status', 'bdk-status-' + contractId, [{value:'active',label:'Active'},{value:'closed',label:'Closed'},{value:'on_hold',label:'On Hold'}], k.status)
      + '</div>'
      + '<div class="tk-section-title" style="margin-top:16px;">Contract Contacts</div>'
      + bdContactFieldsGrid('bdk-contacts-' + contractId, contactsByRole)
      + '<div class="tk-grid-actions">'
      + '<button class="btn-cancel" onclick="bdToggleContractRow(\'' + contractId + '\')">Close</button>'
      + '<button class="btn btn-primary" style="width:auto;padding:11px 20px;" onclick="bdSaveContract(\'' + contractId + '\',\'' + k.customer_id + '\')">Save</button>'
      + '</div>'
      + '<div class="login-error" id="bdk-error-' + contractId + '"></div>'
      + '</div>';
  }

  async function bdSaveContract(contractId, customerId){
    var errorEl = document.getElementById('bdk-error-' + contractId);
    try{
      await dbWrite('contracts?contract_id=eq.' + contractId, 'PATCH', {
        prime_contract_number: bdVal('bdk-pcn-' + contractId) || null,
        delivery_order_number: bdVal('bdk-don-' + contractId) || null,
        subcontract_number: bdVal('bdk-scn-' + contractId) || null,
        contract_type: bdVal('bdk-type-' + contractId),
        fee_type: bdVal('bdk-feetype-' + contractId) || null,
        fee_percentage: bdVal('bdk-fee-' + contractId) ? parseFloat(bdVal('bdk-fee-' + contractId)) : null,
        dpas_priority_rating: bdVal('bdk-dpas-' + contractId) || null,
        payment_terms: bdVal('bdk-terms-' + contractId) || null,
        status: bdVal('bdk-status-' + contractId),
        updated_by: getSession().user.id
      });
      await bdSaveContactsForContract(contractId, 'bdk-contacts-' + contractId);
      await bdLoadContractsForCustomer(customerId);
    }catch(e){
      errorEl.textContent = 'Could not save — try again.';
      console.error(e);
    }
  }

  // =============================================================
  // BILLING TREE (billing_nodes + slins + funding + authorization)
  // =============================================================

  var bdTreeContracts = [];
  var bdTreeSelectedContractId = null;
  var bdTreeContractCustomerId = null;
  var bdNodes = [];
  var bdNodesById = {};
  var bdNodeChildren = {};
  var bdExpandedNodeIds = {};
  var bdSelectedNodeId = null;
  var bdNodeTypesForAdd = ['Task Order', 'SLIN', 'Indirect Pool'];
  var bdSlinOptionYearByNode = {};
  var bdTreeOptionYearFilter = '';

  async function bdLoadTreeContractPicker(){
    var wrap = document.getElementById('bd-tree-contract-picker');
    try{
      bdTreeContracts = await dbRequest('contracts?select=contract_id,customer_id,prime_contract_number,subcontract_number,customers(name)&order=prime_contract_number.asc');
      var options = '<option value="">Select a contract...</option>' + bdTreeContracts.map(function(k){
        var custName = k.customers && k.customers.name ? k.customers.name : 'Unknown Customer';
        var label = custName + ' — ' + (k.prime_contract_number || k.subcontract_number || '(unnumbered)');
        return '<option value="' + k.contract_id + '">' + escAttr(label) + '</option>';
      }).join('');
      wrap.innerHTML = '<select class="field-input" id="bd-tree-contract-select" style="max-width:480px;" onchange="bdOnTreeContractChange()">' + options + '</select>';
    }catch(e){
      wrap.innerHTML = '<div class="tk-empty">Couldn\'t load contracts.</div>';
      console.error(e);
    }
  }

  function bdOnTreeContractChange(){
    var contractId = bdVal('bd-tree-contract-select');
    bdTreeSelectedContractId = contractId || null;
    var contractRow = bdTreeContracts.find(function(k){ return k.contract_id === contractId; });
    bdTreeContractCustomerId = contractRow ? contractRow.customer_id : null;
    bdSelectedNodeId = null;
    bdExpandedNodeIds = {};
    if(!contractId){
      document.getElementById('bd-tree-panel').innerHTML = '';
      document.getElementById('bd-detail-panel').innerHTML = '';
      return;
    }
    bdLoadTree(contractId);
  }

  async function bdLoadTree(contractId){
    var treePanel = document.getElementById('bd-tree-panel');
    treePanel.innerHTML = '<div class="tk-empty">Loading...</div>';
    try{
      bdNodes = await dbRequest('billing_nodes?contract_id=eq.' + contractId + '&select=*&order=sort_order.asc');
      bdNodesById = {};
      bdNodeChildren = {};
      bdNodes.forEach(function(n){ bdNodesById[n.node_id] = n; });
      bdNodes.forEach(function(n){
        var key = n.parent_node_id || '__root__';
        if(!bdNodeChildren[key]){ bdNodeChildren[key] = []; }
        bdNodeChildren[key].push(n);
      });

      var slinRows = await dbRequest('slins?contract_id=eq.' + contractId + '&select=billing_node_id,option_year');
      bdSlinOptionYearByNode = {};
      slinRows.forEach(function(s){ bdSlinOptionYearByNode[s.billing_node_id] = s.option_year; });
      bdTreeOptionYearFilter = '';

      bdRenderTree();
    }catch(e){
      treePanel.innerHTML = '<div class="tk-empty">Couldn\'t load the billing tree.</div>';
      console.error(e);
    }
  }

  // Filter is SLIN-level (option_year lives on slins, not billing_nodes) —
  // when active, a node is visible if it's a matching SLIN or an ancestor
  // of one, so the tree stays navigable instead of showing orphaned leaves.
  function bdComputeVisibleNodeIds(){
    if(!bdTreeOptionYearFilter){ return null; }
    var visible = {};
    bdNodes.forEach(function(n){
      if(n.node_type === 'SLIN' && bdSlinOptionYearByNode[n.node_id] === bdTreeOptionYearFilter){
        var cur = n;
        while(cur){
          visible[cur.node_id] = true;
          cur = cur.parent_node_id ? bdNodesById[cur.parent_node_id] : null;
        }
      }
    });
    return visible;
  }

  function bdRenderTree(){
    var treePanel = document.getElementById('bd-tree-panel');
    var roots = bdNodeChildren['__root__'] || [];
    var visibleSet = bdComputeVisibleNodeIds();

    var years = {};
    Object.keys(bdSlinOptionYearByNode).forEach(function(nodeId){ var y = bdSlinOptionYearByNode[nodeId]; if(y){ years[y] = true; } });
    var yearOptions = '<option value="">All Option Years</option>' + Object.keys(years).sort().map(function(y){
      return '<option value="' + escAttr(y) + '"' + (y === bdTreeOptionYearFilter ? ' selected' : '') + '>' + escAttr(y) + '</option>';
    }).join('');
    var filterHtml = Object.keys(years).length
      ? '<select class="field-input" style="margin-bottom:12px;" onchange="bdTreeOptionYearFilter=this.value;bdRenderTree();">' + yearOptions + '</select>'
      : '';

    var addRootBtn = '<button class="btn-edit" style="margin-bottom:12px;" onclick="bdShowAddNodeForm(null)">+ Add Top-Level Node</button>'
      + '<div id="bd-add-node-form-wrap-root"></div>';
    var visibleRoots = visibleSet ? roots.filter(function(n){ return visibleSet[n.node_id]; }) : roots;
    if(!visibleRoots.length){
      treePanel.innerHTML = filterHtml + addRootBtn + '<div class="tk-empty">' + (visibleSet ? 'No SLINs match that option year.' : 'No billing nodes under this contract yet.') + '</div>';
      return;
    }
    treePanel.innerHTML = filterHtml + addRootBtn + '<div class="bd-tree">' + visibleRoots.map(function(n){ return bdNodeRowHtml(n, 0, visibleSet); }).join('') + '</div>';
  }

  function bdNodeRowHtml(node, depth, visibleSet){
    var kids = bdNodeChildren[node.node_id] || [];
    if(visibleSet){ kids = kids.filter(function(k){ return visibleSet[k.node_id]; }); }
    var hasKids = kids.length > 0;
    var isOpen = !!bdExpandedNodeIds[node.node_id];
    var isSelected = node.node_id === bdSelectedNodeId;
    var caret = hasKids ? (isOpen ? '&#9662;' : '&#9656;') : '';
    var optionYear = bdSlinOptionYearByNode[node.node_id];
    var html = '<div class="bd-tree-row' + (isSelected ? ' selected' : '') + '" style="padding-left:' + (depth * 20 + 10) + 'px;">'
      + '<span class="bd-tree-caret" onclick="bdToggleNodeExpand(\'' + node.node_id + '\')">' + caret + '</span>'
      + '<span class="bd-tree-label" onclick="bdSelectNode(\'' + node.node_id + '\')">' + escAttr(node.label) + '</span>'
      + (optionYear ? '<span class="bd-tree-type-tag">' + escAttr(optionYear) + '</span>' : '')
      + '<span class="bd-tree-type-tag">' + escAttr(node.node_type) + '</span>'
      + '</div>';
    if(hasKids && isOpen){
      html += kids.map(function(k){ return bdNodeRowHtml(k, depth + 1, visibleSet); }).join('');
    }
    return html;
  }

  function bdToggleNodeExpand(nodeId){
    bdExpandedNodeIds[nodeId] = !bdExpandedNodeIds[nodeId];
    bdRenderTree();
  }

  function bdSelectNode(nodeId){
    bdSelectedNodeId = nodeId;
    bdExpandedNodeIds[nodeId] = true;
    bdRenderTree();
    bdRenderNodeDetail(nodeId);
  }

  // ---- Add node (+ SLIN fields inline when node_type === 'SLIN') ----

  function bdShowAddNodeForm(parentNodeId){
    var wrapId = parentNodeId ? ('bd-add-node-form-wrap-' + parentNodeId) : 'bd-add-node-form-wrap-root';
    var wrap = document.getElementById(wrapId);
    if(!wrap){ return; }
    wrap.innerHTML = '<div class="bd-add-form">'
      + bdSelect('Node Type', 'bdn-new-type', bdNodeTypesForAdd.map(function(t){ return { value: t, label: t }; }), 'Task Order')
      + '<div class="asset-form-grid">'
      + bdInput('Label', 'bdn-new-label', '')
      + bdInput('Code', 'bdn-new-code', '')
      + bdInput('Sort Order', 'bdn-new-sort', '0', 'number')
      + bdInput('Effective Start', 'bdn-new-effstart', '', 'date')
      + bdInput('Effective End', 'bdn-new-effend', '', 'date')
      + '</div>'
      + bdCheckboxRow('Billable', 'bdn-new-billable', true)
      + bdCheckboxRow('Leaf node (no children expected)', 'bdn-new-isleaf', false)
      + '<div id="bdn-new-slin-fields"></div>'
      + '<div class="tk-grid-actions">'
      + '<button class="btn-cancel" onclick="document.getElementById(\'' + wrapId + '\').innerHTML=\'\'">Cancel</button>'
      + '<button class="btn btn-primary" style="width:auto;padding:11px 20px;" onclick="bdSubmitAddNode(' + (parentNodeId ? ('\'' + parentNodeId + '\'') : 'null') + ')">Add Node</button>'
      + '</div>'
      + '<div class="login-error" id="bdn-new-error"></div>'
      + '</div>';
    document.getElementById('bdn-new-type').addEventListener('change', bdRenderSlinFieldsIfNeeded);
    bdRenderSlinFieldsIfNeeded();
  }

  function bdRenderSlinFieldsIfNeeded(){
    var slinWrap = document.getElementById('bdn-new-slin-fields');
    if(!slinWrap){ return; }
    if(bdVal('bdn-new-type') !== 'SLIN'){
      slinWrap.innerHTML = '';
      return;
    }
    slinWrap.innerHTML = '<div class="bd-nested-section"><div class="tk-section-title">SLIN Details</div>'
      + '<div class="asset-form-grid">'
      + bdInput('SLIN Code', 'bdn-new-slincode', '')
      + bdSelect('SLIN Category', 'bdn-new-slincat', bdSlinCategories.map(function(t){ return { value: t, label: t }; }), bdSlinCategories[0])
      + bdSelect('Contract Type (override)', 'bdn-new-slinctype', [{value:'',label:'(use contract default)'}].concat(bdContractTypes.map(function(t){ return { value: t, label: t }; })), '')
      + bdInput('Option Year', 'bdn-new-optionyear', '', 'text')
      + bdInput('Period of Performance — Start', 'bdn-new-popstart', '', 'date')
      + bdInput('Period of Performance — End', 'bdn-new-popend', '', 'date')
      + bdInput('Fee % (override)', 'bdn-new-slinfee', '', 'number')
      + '</div>'
      + '<div><label class="field-label">SLIN Description</label><input type="text" id="bdn-new-slindesc" class="field-input"></div>'
      + '</div>';
  }

  async function bdSubmitAddNode(parentNodeId){
    var errorEl = document.getElementById('bdn-new-error');
    var label = bdVal('bdn-new-label');
    var nodeType = bdVal('bdn-new-type');
    if(!label){ errorEl.textContent = 'Label is required.'; return; }
    if(nodeType === 'SLIN' && !bdVal('bdn-new-slincode')){ errorEl.textContent = 'SLIN Code is required for a SLIN node.'; return; }

    var parentNode = parentNodeId ? bdNodesById[parentNodeId] : null;
    var nodeId = crypto.randomUUID();
    var session = getSession();

    try{
      await dbWrite('billing_nodes', 'POST', {
        node_id: nodeId,
        parent_node_id: parentNodeId || null,
        customer_id: parentNode ? parentNode.customer_id : bdTreeContractCustomerId,
        contract_id: bdTreeSelectedContractId,
        node_type: nodeType,
        code: bdVal('bdn-new-code') || null,
        label: label,
        billable: bdChecked('bdn-new-billable'),
        is_leaf: bdChecked('bdn-new-isleaf'),
        status: 'active',
        sort_order: bdVal('bdn-new-sort') ? parseInt(bdVal('bdn-new-sort'), 10) : 0,
        effective_start: bdVal('bdn-new-effstart') || null,
        effective_end: bdVal('bdn-new-effend') || null,
        created_by: session.user.id
      });

      if(nodeType === 'SLIN'){
        await dbWrite('slins', 'POST', {
          slin_id: crypto.randomUUID(),
          billing_node_id: nodeId,
          contract_id: bdTreeSelectedContractId,
          slin_code: bdVal('bdn-new-slincode'),
          slin_description: bdVal('bdn-new-slindesc') || null,
          slin_category: bdVal('bdn-new-slincat'),
          contract_type: bdVal('bdn-new-slinctype') || null,
          option_year: bdVal('bdn-new-optionyear') || null,
          pop_start: bdVal('bdn-new-popstart') || null,
          pop_end: bdVal('bdn-new-popend') || null,
          fee_percentage: bdVal('bdn-new-slinfee') ? parseFloat(bdVal('bdn-new-slinfee')) : null,
          status: 'active',
          created_by: session.user.id
        });
      }

      if(parentNodeId){ bdExpandedNodeIds[parentNodeId] = true; }
      await bdLoadTree(bdTreeSelectedContractId);
    }catch(e){
      errorEl.textContent = 'Could not add node — try again.';
      console.error(e);
    }
  }

  // ---- Node detail panel (generic fields, + SLIN detail when applicable) ----

  async function bdRenderNodeDetail(nodeId){
    var panel = document.getElementById('bd-detail-panel');
    var node = bdNodesById[nodeId];
    if(!node){ panel.innerHTML = ''; return; }

    var html = '<div class="tk-entry-card">'
      + '<div class="tk-section-title">' + escAttr(node.node_type) + ' — ' + escAttr(node.label) + '</div>'
      + '<div class="asset-form-grid">'
      + bdInput('Label', 'bdn-label-' + nodeId, node.label)
      + bdInput('Code', 'bdn-code-' + nodeId, node.code)
      + bdInput('Sort Order', 'bdn-sort-' + nodeId, node.sort_order, 'number')
      + bdInput('Effective Start', 'bdn-effstart-' + nodeId, node.effective_start, 'date')
      + bdInput('Effective End', 'bdn-effend-' + nodeId, node.effective_end, 'date')
      + bdSelect('Status', 'bdn-status-' + nodeId, [{value:'active',label:'Active'},{value:'closed',label:'Closed'},{value:'on_hold',label:'On Hold'}], node.status)
      + '</div>'
      + bdCheckboxRow('Billable', 'bdn-billable-' + nodeId, node.billable)
      + bdCheckboxRow('Leaf node', 'bdn-isleaf-' + nodeId, node.is_leaf)
      + '<div class="tk-grid-actions">'
      + '<button class="btn-edit" onclick="bdShowAddNodeForm(\'' + nodeId + '\')">+ Add Child Node</button>'
      + '<button class="btn btn-primary" style="width:auto;padding:11px 20px;" onclick="bdSaveNode(\'' + nodeId + '\')">Save</button>'
      + '</div>'
      + '<div id="bd-add-node-form-wrap-' + nodeId + '"></div>'
      + '<div class="login-error" id="bdn-error-' + nodeId + '"></div>'
      + '</div>';

    panel.innerHTML = html;

    if(node.node_type === 'SLIN'){
      var slinWrap = document.createElement('div');
      slinWrap.id = 'bd-slin-detail-' + nodeId;
      slinWrap.innerHTML = '<div class="tk-empty">Loading SLIN details...</div>';
      panel.appendChild(slinWrap);
      bdRenderSlinDetail(nodeId);
    }
  }

  async function bdSaveNode(nodeId){
    var errorEl = document.getElementById('bdn-error-' + nodeId);
    var label = bdVal('bdn-label-' + nodeId);
    if(!label){ errorEl.textContent = 'Label is required.'; return; }
    try{
      await dbWrite('billing_nodes?node_id=eq.' + nodeId, 'PATCH', {
        label: label,
        code: bdVal('bdn-code-' + nodeId) || null,
        sort_order: bdVal('bdn-sort-' + nodeId) ? parseInt(bdVal('bdn-sort-' + nodeId), 10) : 0,
        effective_start: bdVal('bdn-effstart-' + nodeId) || null,
        effective_end: bdVal('bdn-effend-' + nodeId) || null,
        status: bdVal('bdn-status-' + nodeId),
        billable: bdChecked('bdn-billable-' + nodeId),
        is_leaf: bdChecked('bdn-isleaf-' + nodeId),
        updated_by: getSession().user.id
      });
      await bdLoadTree(bdTreeSelectedContractId);
      bdRenderNodeDetail(nodeId);
    }catch(e){
      errorEl.textContent = 'Could not save — try again.';
      console.error(e);
    }
  }

  // ---- SLIN detail: slins fields + funding history + employee authorization ----

  var bdCurrentSlin = null;

  async function bdRenderSlinDetail(nodeId){
    var wrap = document.getElementById('bd-slin-detail-' + nodeId);
    if(!wrap){ return; }
    try{
      var rows = await dbRequest('slins?billing_node_id=eq.' + nodeId + '&select=*');
      if(!rows.length){ wrap.innerHTML = '<div class="tk-empty">No SLIN record found for this node.</div>'; return; }
      bdCurrentSlin = rows[0];
      var s = bdCurrentSlin;

      wrap.innerHTML = '<div class="tk-entry-card">'
        + '<div class="tk-section-title">SLIN Details</div>'
        + '<div class="asset-form-grid">'
        + bdInput('SLIN Code', 'bds-code-' + s.slin_id, s.slin_code)
        + bdSelect('SLIN Category', 'bds-cat-' + s.slin_id, bdSlinCategories.map(function(t){ return { value: t, label: t }; }), s.slin_category)
        + bdSelect('Contract Type (override)', 'bds-ctype-' + s.slin_id, [{value:'',label:'(use contract default)'}].concat(bdContractTypes.map(function(t){ return { value: t, label: t }; })), s.contract_type || '')
        + bdInput('Option Year', 'bds-optionyear-' + s.slin_id, s.option_year, 'text')
        + bdInput('Period of Performance — Start', 'bds-popstart-' + s.slin_id, s.pop_start, 'date')
        + bdInput('Period of Performance — End', 'bds-popend-' + s.slin_id, s.pop_end, 'date')
        + bdInput('Fee % (override)', 'bds-fee-' + s.slin_id, s.fee_percentage, 'number')
        + bdSelect('Status', 'bds-status-' + s.slin_id, [{value:'active',label:'Active'},{value:'closed',label:'Closed'},{value:'on_hold',label:'On Hold'}], s.status)
        + '</div>'
        + '<div><label class="field-label">Description</label><input type="text" id="bds-desc-' + s.slin_id + '" class="field-input" value="' + escAttr(s.slin_description) + '"></div>'
        + '<div class="tk-grid-actions"><button class="btn btn-primary" style="width:auto;padding:11px 20px;" onclick="bdSaveSlin(\'' + s.slin_id + '\',\'' + nodeId + '\')">Save</button></div>'
        + '<div class="login-error" id="bds-error-' + s.slin_id + '"></div>'
        + '</div>'
        + '<div class="tk-entry-card">'
        + '<div class="tk-section-title">Funding History <span class="bd-inline-hint">(append-only ledger — current funded amount is the sum of all rows below)</span></div>'
        + '<div id="bd-funding-list-' + s.slin_id + '"><div class="tk-empty">Loading...</div></div>'
        + '<button class="btn-edit" style="margin-top:10px;" onclick="bdShowAddFundingForm(\'' + s.slin_id + '\')">+ Add Funding Mod</button>'
        + '<div id="bd-add-funding-form-wrap-' + s.slin_id + '"></div>'
        + '</div>'
        + '<div class="tk-entry-card">'
        + '<div class="tk-section-title">Employee Authorization <span class="bd-inline-hint">(append-only ledger — current status per employee is their most recent row)</span></div>'
        + '<div id="bd-auth-list-' + s.slin_id + '"><div class="tk-empty">Loading...</div></div>'
        + '<button class="btn-edit" style="margin-top:10px;" onclick="bdShowAddAuthForm(\'' + s.slin_id + '\')">+ Authorize Employee</button>'
        + '<div id="bd-add-auth-form-wrap-' + s.slin_id + '"></div>'
        + '</div>';

      bdLoadFundingHistory(s.slin_id);
      bdLoadAuthorizations(s.slin_id);
    }catch(e){
      wrap.innerHTML = '<div class="tk-empty">Couldn\'t load SLIN details.</div>';
      console.error(e);
    }
  }

  async function bdSaveSlin(slinId, nodeId){
    var errorEl = document.getElementById('bds-error-' + slinId);
    try{
      await dbWrite('slins?slin_id=eq.' + slinId, 'PATCH', {
        slin_code: bdVal('bds-code-' + slinId),
        slin_category: bdVal('bds-cat-' + slinId),
        contract_type: bdVal('bds-ctype-' + slinId) || null,
        option_year: bdVal('bds-optionyear-' + slinId) || null,
        pop_start: bdVal('bds-popstart-' + slinId) || null,
        pop_end: bdVal('bds-popend-' + slinId) || null,
        fee_percentage: bdVal('bds-fee-' + slinId) ? parseFloat(bdVal('bds-fee-' + slinId)) : null,
        status: bdVal('bds-status-' + slinId),
        slin_description: bdVal('bds-desc-' + slinId) || null,
        updated_by: getSession().user.id
      });
      bdRenderSlinDetail(nodeId);
    }catch(e){
      errorEl.textContent = 'Could not save — try again.';
      console.error(e);
    }
  }

  // ---- Funding history (append-only) ----

  async function bdLoadFundingHistory(slinId){
    var container = document.getElementById('bd-funding-list-' + slinId);
    try{
      var rows = await dbRequest('slin_funding_history?slin_id=eq.' + slinId + '&select=*&order=mod_date.desc');
      if(!rows.length){
        container.innerHTML = '<div class="tk-empty">No funding mods recorded yet.</div>';
        return;
      }
      container.innerHTML = '<div class="bd-ledger">' + rows.map(function(r){
        return '<div class="bd-ledger-row">'
          + '<div><div class="bd-row-title">Mod ' + escAttr(r.mod_number || '—') + ' — ' + formatDate(r.mod_date) + '</div>'
          + '<div class="bd-row-sub">Award ' + bdMoney(r.award_total) + ' · Cumulative ' + bdMoney(r.cumulative_total) + '</div></div>'
          + '</div>';
      }).join('') + '</div>';
    }catch(e){
      container.innerHTML = '<div class="tk-empty">Couldn\'t load funding history.</div>';
      console.error(e);
    }
  }

  async function bdShowAddFundingForm(slinId){
    var wrap = document.getElementById('bd-add-funding-form-wrap-' + slinId);
    var latestCumulative = 0;
    try{
      var rows = await dbRequest('slin_funding_history?slin_id=eq.' + slinId + '&select=cumulative_total&order=mod_date.desc&limit=1');
      if(rows.length){ latestCumulative = rows[0].cumulative_total; }
    }catch(e){ console.error(e); }

    wrap.innerHTML = '<div class="bd-add-form">'
      + '<div class="asset-form-grid">'
      + bdInput('Mod Number', 'bdf-new-modnum-' + slinId, '')
      + bdInput('Mod Date', 'bdf-new-moddate-' + slinId, '', 'date')
      + bdInput('Previous Funding', 'bdf-new-prev-' + slinId, latestCumulative, 'number')
      + bdInput('Award Total (this mod)', 'bdf-new-award-' + slinId, '', 'number')
      + bdInput('Cumulative Total', 'bdf-new-cum-' + slinId, latestCumulative, 'number')
      + bdInput('Source Document (Blob URL)', 'bdf-new-doc-' + slinId, '')
      + '</div>'
      + '<div class="tk-grid-actions">'
      + '<button class="btn-cancel" onclick="document.getElementById(\'bd-add-funding-form-wrap-' + slinId + '\').innerHTML=\'\'">Cancel</button>'
      + '<button class="btn btn-primary" style="width:auto;padding:11px 20px;" onclick="bdSubmitAddFunding(\'' + slinId + '\')">Add Mod</button>'
      + '</div>'
      + '<div class="login-error" id="bdf-new-error-' + slinId + '"></div>'
      + '</div>';

    document.getElementById('bdf-new-award-' + slinId).addEventListener('input', function(){
      var prev = parseFloat(bdVal('bdf-new-prev-' + slinId)) || 0;
      var award = parseFloat(bdVal('bdf-new-award-' + slinId)) || 0;
      document.getElementById('bdf-new-cum-' + slinId).value = (prev + award).toFixed(2);
    });
  }

  async function bdSubmitAddFunding(slinId){
    var errorEl = document.getElementById('bdf-new-error-' + slinId);
    if(!bdVal('bdf-new-moddate-' + slinId)){ errorEl.textContent = 'Mod Date is required.'; return; }
    if(!bdVal('bdf-new-award-' + slinId)){ errorEl.textContent = 'Award Total is required.'; return; }
    try{
      await dbWrite('slin_funding_history', 'POST', {
        funding_id: crypto.randomUUID(),
        slin_id: slinId,
        mod_number: bdVal('bdf-new-modnum-' + slinId) || null,
        mod_date: bdVal('bdf-new-moddate-' + slinId),
        previous_funding: parseFloat(bdVal('bdf-new-prev-' + slinId)) || 0,
        award_total: parseFloat(bdVal('bdf-new-award-' + slinId)),
        cumulative_total: parseFloat(bdVal('bdf-new-cum-' + slinId)),
        source_document: bdVal('bdf-new-doc-' + slinId) || null,
        entered_by_admin_id: getSession().user.id
      });
      document.getElementById('bd-add-funding-form-wrap-' + slinId).innerHTML = '';
      bdLoadFundingHistory(slinId);
    }catch(e){
      errorEl.textContent = 'Could not add funding mod — try again.';
      console.error(e);
    }
  }

  // ---- Employee authorization (append-only) ----

  async function bdLoadAuthorizations(slinId){
    var container = document.getElementById('bd-auth-list-' + slinId);
    try{
      var rows = await dbRequest('slin_employee_authorization?slin_id=eq.' + slinId + '&select=*&order=changed_at.desc');
      await bdFetchProfiles();
      var nameById = {};
      bdAllProfiles.forEach(function(p){ nameById[p.id] = p.full_name; });

      if(!rows.length){
        container.innerHTML = '<div class="tk-empty">No authorization history yet.</div>';
        return;
      }
      container.innerHTML = '<div class="bd-ledger">' + rows.map(function(r){
        var isActive = r.status === 'active';
        return '<div class="bd-ledger-row">'
          + '<div><div class="bd-row-title">' + escAttr(nameById[r.employee_id] || 'Unknown employee') + '</div>'
          + '<div class="bd-row-sub">Effective ' + formatDate(r.effective_date) + (r.reason ? ' · ' + escAttr(r.reason) : '') + '</div></div>'
          + '<div class="bd-status-pill' + (isActive ? ' bd-pill-active' : ' bd-pill-muted') + '">' + (isActive ? 'Active' : 'Revoked') + '</div>'
          + (isActive ? '<button class="btn-cancel" style="margin-left:10px;" onclick="bdRevokeAuthorization(\'' + slinId + '\',\'' + r.employee_id + '\')">Revoke</button>' : '')
          + '</div>';
      }).join('') + '</div>';
    }catch(e){
      container.innerHTML = '<div class="tk-empty">Couldn\'t load authorization history.</div>';
      console.error(e);
    }
  }

  async function bdShowAddAuthForm(slinId){
    var wrap = document.getElementById('bd-add-auth-form-wrap-' + slinId);
    await bdFetchProfiles();
    wrap.innerHTML = '<div class="bd-add-form">'
      + '<div class="asset-form-grid">'
      + bdSelect('Employee', 'bda-new-emp-' + slinId, bdAllProfiles.map(function(p){ return { value: p.id, label: p.full_name }; }), '')
      + bdInput('Effective Date', 'bda-new-effdate-' + slinId, new Date().toISOString().slice(0,10), 'date')
      + '</div>'
      + '<div><label class="field-label">Reason (optional)</label><input type="text" id="bda-new-reason-' + slinId + '" class="field-input"></div>'
      + '<div class="tk-grid-actions">'
      + '<button class="btn-cancel" onclick="document.getElementById(\'bd-add-auth-form-wrap-' + slinId + '\').innerHTML=\'\'">Cancel</button>'
      + '<button class="btn btn-primary" style="width:auto;padding:11px 20px;" onclick="bdSubmitAddAuth(\'' + slinId + '\')">Authorize</button>'
      + '</div>'
      + '<div class="login-error" id="bda-new-error-' + slinId + '"></div>'
      + '</div>';
  }

  async function bdSubmitAddAuth(slinId){
    var errorEl = document.getElementById('bda-new-error-' + slinId);
    var employeeId = bdVal('bda-new-emp-' + slinId);
    if(!employeeId){ errorEl.textContent = 'Select an employee.'; return; }
    try{
      await dbWrite('slin_employee_authorization', 'POST', {
        authorization_id: crypto.randomUUID(),
        slin_id: slinId,
        employee_id: employeeId,
        status: 'active',
        effective_date: bdVal('bda-new-effdate-' + slinId) || new Date().toISOString().slice(0,10),
        changed_by_admin_id: getSession().user.id,
        reason: bdVal('bda-new-reason-' + slinId) || null
      });
      document.getElementById('bd-add-auth-form-wrap-' + slinId).innerHTML = '';
      bdLoadAuthorizations(slinId);
    }catch(e){
      errorEl.textContent = 'Could not authorize employee — try again.';
      console.error(e);
    }
  }

  async function bdRevokeAuthorization(slinId, employeeId){
    try{
      await dbWrite('slin_employee_authorization', 'POST', {
        authorization_id: crypto.randomUUID(),
        slin_id: slinId,
        employee_id: employeeId,
        status: 'revoked',
        effective_date: new Date().toISOString().slice(0,10),
        changed_by_admin_id: getSession().user.id,
        reason: null
      });
      bdLoadAuthorizations(slinId);
    }catch(e){ console.error(e); }
  }

  // =============================================================
  // BULK SLIN ENTRY WIDGET (reusable — mounted standalone in the SLIN Table
  // subtab, and embedded inside Add Customer's "also add first contract"
  // flow). One "batch" = one billing_nodes/slins/slin_funding_history
  // insert per row, all sharing one mod_number/mod_date/source_document —
  // matches how a real Task Order Mod document lists many SLINs under one
  // mod. Keyed by an arbitrary instanceKey so two mounts never collide.
  // =============================================================

  var bdBulk = {};

  function bdBulkBlankRow(){
    return { slinCode: '', slinDesc: '', category: bdSlinCategories[0], contractType: bdContractTypes[0], optionYear: '', popStart: '', popEnd: '', prevFunding: '0', awardTotal: '', cumTotal: '0' };
  }

  // embedded=true (Add Customer flow) hides this widget's own Save button —
  // the outer form's submit collects bdBulk[instanceKey].rows itself so the
  // customer/contract/contacts/SLINs all commit from one Add Customer click.
  async function bdBulkInit(instanceKey, containerId, contractId, customerId, onSaved, embedded){
    var parentOptions = [{ value: '', label: '(Top level — no parent)' }];
    try{
      var nodes = await dbRequest('billing_nodes?contract_id=eq.' + contractId + '&select=node_id,label,node_type&order=sort_order.asc');
      nodes.forEach(function(n){
        if(n.node_type !== 'SLIN'){ parentOptions.push({ value: n.node_id, label: n.node_type + ': ' + n.label }); }
      });
    }catch(e){ console.error(e); }

    bdBulk[instanceKey] = {
      containerId: containerId,
      contractId: contractId,
      customerId: customerId,
      parentNodeId: '',
      modNumber: '',
      modDate: '',
      sourceDocument: '',
      rows: [bdBulkBlankRow()],
      reviewing: false,
      onSaved: onSaved,
      embedded: !!embedded,
      parentOptions: parentOptions
    };
    bdBulkRender(instanceKey);
  }

  function bdBulkSyncFromDom(instanceKey){
    var state = bdBulk[instanceKey];
    if(!state || state.reviewing){ return; }
    state.parentNodeId = bdVal('bdbulk-' + instanceKey + '-parent');
    state.modNumber = bdVal('bdbulk-' + instanceKey + '-modnum');
    state.modDate = bdVal('bdbulk-' + instanceKey + '-moddate');
    state.sourceDocument = bdVal('bdbulk-' + instanceKey + '-doc');
    state.rows.forEach(function(row, i){
      var p = 'bdbulk-' + instanceKey + '-' + i + '-';
      row.slinCode = bdVal(p + 'code');
      row.category = bdVal(p + 'cat');
      row.contractType = bdVal(p + 'ctype');
      row.optionYear = bdVal(p + 'oy');
      row.popStart = bdVal(p + 'popstart');
      row.popEnd = bdVal(p + 'popend');
      row.prevFunding = bdVal(p + 'prev');
      row.awardTotal = bdVal(p + 'award');
      row.cumTotal = bdVal(p + 'cum');
      row.slinDesc = bdVal(p + 'desc');
    });
  }

  function bdBulkAddRow(instanceKey){
    bdBulkSyncFromDom(instanceKey);
    bdBulk[instanceKey].rows.push(bdBulkBlankRow());
    bdBulkRender(instanceKey);
  }

  function bdBulkRemoveRow(instanceKey, index){
    bdBulkSyncFromDom(instanceKey);
    bdBulk[instanceKey].rows.splice(index, 1);
    bdBulkRender(instanceKey);
  }

  function bdBulkRowHtml(instanceKey, row, i){
    var p = 'bdbulk-' + instanceKey + '-' + i + '-';
    return '<div class="bd-add-form" style="margin-bottom:12px;">'
      + '<div class="tk-grid-actions" style="justify-content:space-between;margin-bottom:6px;">'
      + '<div class="tk-section-title" style="margin:0;">Row ' + (i + 1) + '</div>'
      + '<button class="btn-cancel" onclick="bdBulkRemoveRow(\'' + instanceKey + '\',' + i + ')">Remove</button>'
      + '</div>'
      + '<div class="asset-form-grid">'
      + bdInput('SLIN Code', p + 'code', row.slinCode)
      + bdSelect('Category', p + 'cat', bdSlinCategories.map(function(t){ return { value: t, label: t }; }), row.category)
      + bdSelect('Contract Type', p + 'ctype', bdContractTypes.map(function(t){ return { value: t, label: t }; }), row.contractType)
      + bdInput('Option Year', p + 'oy', row.optionYear)
      + bdInput('PoP Start', p + 'popstart', row.popStart, 'date')
      + bdInput('PoP End', p + 'popend', row.popEnd, 'date')
      + bdInput('Previous Funding', p + 'prev', row.prevFunding, 'number')
      + bdInput('Award Total', p + 'award', row.awardTotal, 'number')
      + bdInput('Cumulative Total', p + 'cum', row.cumTotal, 'number')
      + '</div>'
      + '<div><label class="field-label">Description</label><input type="text" id="' + p + 'desc" class="field-input" value="' + escAttr(row.slinDesc) + '"></div>'
      + '</div>';
  }

  function bdBulkRender(instanceKey){
    var state = bdBulk[instanceKey];
    var container = document.getElementById(state.containerId);
    if(!container){ return; }
    if(state.reviewing){ bdBulkRenderReview(instanceKey); return; }

    var header = '<div class="asset-form-grid">'
      + bdSelect('Attach Under', 'bdbulk-' + instanceKey + '-parent', state.parentOptions, state.parentNodeId)
      + bdInput('Mod Number', 'bdbulk-' + instanceKey + '-modnum', state.modNumber)
      + bdInput('Mod Date', 'bdbulk-' + instanceKey + '-moddate', state.modDate, 'date')
      + bdInput('Source Document (Blob URL, optional)', 'bdbulk-' + instanceKey + '-doc', state.sourceDocument)
      + '</div>';

    var rowsHtml = state.rows.map(function(row, i){ return bdBulkRowHtml(instanceKey, row, i); }).join('');
    var addRowHtml = '<div class="tk-grid-actions" style="justify-content:flex-start;"><button class="btn-edit" onclick="bdBulkAddRow(\'' + instanceKey + '\')">+ Add Row</button></div>';
    var saveHtml = state.embedded
      ? ''
      : '<div class="tk-grid-actions"><button class="btn btn-primary" style="width:auto;padding:11px 20px;" onclick="bdBulkShowReview(\'' + instanceKey + '\')">Review &amp; Save All</button></div>';

    container.innerHTML = header
      + '<div id="bdbulk-' + instanceKey + '-rows">' + rowsHtml + '</div>'
      + addRowHtml + saveHtml
      + '<div class="login-error" id="bdbulk-' + instanceKey + '-error"></div>';

    state.rows.forEach(function(row, i){
      var p = 'bdbulk-' + instanceKey + '-' + i + '-';
      var awardEl = document.getElementById(p + 'award');
      if(awardEl){
        awardEl.addEventListener('input', function(){
          var prev = parseFloat(bdVal(p + 'prev')) || 0;
          var award = parseFloat(bdVal(p + 'award')) || 0;
          document.getElementById(p + 'cum').value = (prev + award).toFixed(2);
        });
      }
    });
  }

  function bdBulkShowReview(instanceKey){
    bdBulkSyncFromDom(instanceKey);
    var state = bdBulk[instanceKey];
    var rowsWithCode = state.rows.filter(function(r){ return r.slinCode; });
    if(!rowsWithCode.length){
      bdBulkRender(instanceKey);
      document.getElementById('bdbulk-' + instanceKey + '-error').textContent = 'Add at least one row with a SLIN Code.';
      return;
    }
    state.reviewing = true;
    bdBulkRender(instanceKey);
  }

  function bdBulkRenderReview(instanceKey){
    var state = bdBulk[instanceKey];
    var container = document.getElementById(state.containerId);
    var rowsWithCode = state.rows.filter(function(r){ return r.slinCode; });
    var parentLabel = (state.parentOptions.find(function(o){ return o.value === state.parentNodeId; }) || {}).label || '(Top level)';
    var rowsHtml = rowsWithCode.map(function(r){
      return '<div class="bd-ledger-row"><div><div class="bd-row-title">' + escAttr(r.slinCode) + ' — ' + escAttr(r.slinDesc || '') + '</div>'
        + '<div class="bd-row-sub">' + escAttr(r.category) + ' · ' + escAttr(r.contractType) + ' · ' + (r.optionYear ? escAttr(r.optionYear) : '—') + ' · ' + (r.popStart || '—') + ' to ' + (r.popEnd || '—') + '</div></div>'
        + '<div class="bd-row-title">' + bdMoney(r.cumTotal) + '</div></div>';
    }).join('');

    container.innerHTML = '<div class="tk-section-title">Review — ' + rowsWithCode.length + ' SLIN' + (rowsWithCode.length === 1 ? '' : 's') + ', attaching under ' + escAttr(parentLabel) + '</div>'
      + '<div class="bd-row-sub" style="margin-bottom:10px;">Mod ' + escAttr(state.modNumber || '—') + ' · ' + (state.modDate || '—') + (state.sourceDocument ? ' · ' + escAttr(state.sourceDocument) : '') + '</div>'
      + '<div class="bd-ledger">' + rowsHtml + '</div>'
      + '<div class="tk-grid-actions">'
      + '<button class="btn-cancel" onclick="bdBulkBackToEdit(\'' + instanceKey + '\')">Back to Edit</button>'
      + '<button class="btn btn-primary" style="width:auto;padding:11px 20px;" onclick="bdBulkConfirmSave(\'' + instanceKey + '\')">Confirm &amp; Save All</button>'
      + '</div>'
      + '<div class="login-error" id="bdbulk-' + instanceKey + '-error"></div>';
  }

  function bdBulkBackToEdit(instanceKey){
    bdBulk[instanceKey].reviewing = false;
    bdBulkRender(instanceKey);
  }

  // Shared by the standalone SLIN Table "Confirm & Save All" and the
  // embedded Add Customer submit — one billing_nodes + slins row per row,
  // plus one slin_funding_history row when an Award Total was entered.
  async function bdBulkSaveRows(instanceKey){
    var state = bdBulk[instanceKey];
    var session = getSession();
    for(var i = 0; i < state.rows.length; i++){
      var r = state.rows[i];
      if(!r.slinCode){ continue; }
      var nodeId = crypto.randomUUID();
      await dbWrite('billing_nodes', 'POST', {
        node_id: nodeId,
        parent_node_id: state.parentNodeId || null,
        customer_id: state.customerId || null,
        contract_id: state.contractId,
        node_type: 'SLIN',
        code: r.slinCode,
        label: r.slinCode + (r.slinDesc ? ' — ' + r.slinDesc : ''),
        billable: true,
        is_leaf: true,
        status: 'active',
        sort_order: i,
        created_by: session.user.id
      });
      var slinId = crypto.randomUUID();
      await dbWrite('slins', 'POST', {
        slin_id: slinId,
        billing_node_id: nodeId,
        contract_id: state.contractId,
        slin_code: r.slinCode,
        slin_description: r.slinDesc || null,
        slin_category: r.category,
        contract_type: r.contractType || null,
        option_year: r.optionYear || null,
        pop_start: r.popStart || null,
        pop_end: r.popEnd || null,
        status: 'active',
        created_by: session.user.id
      });
      if(r.awardTotal){
        await dbWrite('slin_funding_history', 'POST', {
          funding_id: crypto.randomUUID(),
          slin_id: slinId,
          mod_number: state.modNumber || null,
          mod_date: state.modDate || new Date().toISOString().slice(0,10),
          previous_funding: parseFloat(r.prevFunding) || 0,
          award_total: parseFloat(r.awardTotal),
          cumulative_total: parseFloat(r.cumTotal) || ((parseFloat(r.prevFunding) || 0) + parseFloat(r.awardTotal)),
          source_document: state.sourceDocument || null,
          entered_by_admin_id: session.user.id
        });
      }
    }
  }

  async function bdBulkConfirmSave(instanceKey){
    var state = bdBulk[instanceKey];
    var errorEl = document.getElementById('bdbulk-' + instanceKey + '-error');
    try{
      await bdBulkSaveRows(instanceKey);
      var onSaved = state.onSaved;
      var containerId = state.containerId;
      var contractId = state.contractId;
      var customerId = state.customerId;
      var embedded = state.embedded;
      if(typeof onSaved === 'function'){ onSaved(); }
      await bdBulkInit(instanceKey, containerId, contractId, customerId, onSaved, embedded);
    }catch(e){
      errorEl.textContent = 'Something went wrong saving — some rows may already be saved. Check the SLIN Table before retrying.';
      console.error(e);
    }
  }

  // =============================================================
  // SLIN TABLE (filterable existing-SLIN view + standalone bulk entry)
  // =============================================================

  var bdStContracts = [];
  var bdStSelectedContractId = null;
  var bdStSelectedCustomerId = null;
  var bdStExistingSlins = [];
  var bdStLatestFundingBySlin = {};
  var bdStOptionYearFilter = '';

  async function bdLoadSlinTableContractPicker(){
    var wrap = document.getElementById('bd-st-contract-picker');
    try{
      bdStContracts = await dbRequest('contracts?select=contract_id,customer_id,prime_contract_number,subcontract_number,customers(name)&order=prime_contract_number.asc');
      var options = '<option value="">Select a contract...</option>' + bdStContracts.map(function(k){
        var custName = k.customers && k.customers.name ? k.customers.name : 'Unknown Customer';
        var label = custName + ' — ' + (k.prime_contract_number || k.subcontract_number || '(unnumbered)');
        return '<option value="' + k.contract_id + '">' + escAttr(label) + '</option>';
      }).join('');
      wrap.innerHTML = '<select class="field-input" id="bd-st-contract-select" style="max-width:480px;" onchange="bdOnStContractChange()">' + options + '</select>';
    }catch(e){
      wrap.innerHTML = '<div class="tk-empty">Couldn\'t load contracts.</div>';
      console.error(e);
    }
  }

  function bdOnStContractChange(){
    var contractId = bdVal('bd-st-contract-select');
    bdStSelectedContractId = contractId || null;
    var row = bdStContracts.find(function(k){ return k.contract_id === contractId; });
    bdStSelectedCustomerId = row ? row.customer_id : null;
    bdStOptionYearFilter = '';
    if(!contractId){
      document.getElementById('bd-st-existing-wrap').innerHTML = '';
      document.getElementById('bd-st-bulk-wrap').innerHTML = '';
      return;
    }
    bdLoadStExisting(contractId);
    bdBulkInit('slintable', 'bd-st-bulk-wrap', contractId, bdStSelectedCustomerId, function(){ bdLoadStExisting(contractId); }, false);
  }

  async function bdLoadStExisting(contractId){
    var wrap = document.getElementById('bd-st-existing-wrap');
    wrap.innerHTML = '<div class="tk-empty">Loading...</div>';
    try{
      var slinRows = await dbRequest('slins?contract_id=eq.' + contractId + '&select=*&order=slin_code.asc');
      var fundingRows = slinRows.length
        ? await dbRequest('slin_funding_history?slin_id=in.(' + slinRows.map(function(s){ return s.slin_id; }).join(',') + ')&select=slin_id,cumulative_total,mod_date&order=mod_date.desc')
        : [];
      var latestBySlin = {};
      fundingRows.forEach(function(f){ if(!latestBySlin[f.slin_id]){ latestBySlin[f.slin_id] = f; } });
      bdStExistingSlins = slinRows;
      bdStLatestFundingBySlin = latestBySlin;
      bdRenderStExistingTable();
    }catch(e){
      wrap.innerHTML = '<div class="tk-empty">Couldn\'t load SLIN data.</div>';
      console.error(e);
    }
  }

  function bdRenderStExistingTable(){
    var wrap = document.getElementById('bd-st-existing-wrap');
    var years = {};
    bdStExistingSlins.forEach(function(s){ if(s.option_year){ years[s.option_year] = true; } });
    var yearOptions = '<option value="">All Option Years</option>' + Object.keys(years).sort().map(function(y){
      return '<option value="' + escAttr(y) + '"' + (y === bdStOptionYearFilter ? ' selected' : '') + '>' + escAttr(y) + '</option>';
    }).join('');

    var filtered = bdStExistingSlins.filter(function(s){ return !bdStOptionYearFilter || s.option_year === bdStOptionYearFilter; });

    var rowsHtml = filtered.length
      ? filtered.map(function(s){
          var funding = bdStLatestFundingBySlin[s.slin_id];
          return '<div class="bd-ledger-row"><div><div class="bd-row-title">' + escAttr(s.slin_code) + ' — ' + escAttr(s.slin_description || '') + '</div>'
            + '<div class="bd-row-sub">' + escAttr(s.slin_category) + ' · ' + escAttr(s.contract_type || '—') + ' · ' + (s.option_year ? escAttr(s.option_year) : '—') + ' · ' + formatDate(s.pop_start) + ' – ' + formatDate(s.pop_end) + '</div></div>'
            + '<div class="bd-row-title">' + bdMoney(funding ? funding.cumulative_total : null) + '</div></div>';
        }).join('')
      : '<div class="tk-empty">No SLINs match this filter.</div>';

    wrap.innerHTML = '<div class="tk-entry-card">'
      + '<div class="tk-section-title">Existing SLINs</div>'
      + (Object.keys(years).length ? '<select class="field-input" style="max-width:260px;" onchange="bdStOptionYearFilter=this.value;bdRenderStExistingTable();">' + yearOptions + '</select>' : '')
      + '<div class="bd-ledger" style="margin-top:14px;">' + rowsHtml + '</div>'
      + '</div>';
  }
