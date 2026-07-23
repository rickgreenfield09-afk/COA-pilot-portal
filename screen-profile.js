/* COA Employee Portal — screen-profile.js
   Profile overview, travel-info card, resume, and asset tracker (base file
   for all three). Includes the resume/asset team-panel functions
   (loadTeamResumes, renderTeamPanel, loadTeamAssets, etc.) which take a
   `scope` param ('myteam' | 'admin') and are called from screen-myteam.js
   and screen-admin.js rather than being duplicated there.
   Depends on app-core.js: getSession, dbRequest, dbWrite, isAdmin,
   getInitials, formatDate, escAttr, getRecursiveReportIds(AsRows). */

  async function loadProfile(){
    var container = document.getElementById('profile-content');
    var session = getSession();
    if(!session || !session.user){ return; }

    try{
      var rows = await dbRequest('profiles?id=eq.' + session.user.id + '&select=*,departments(name)');
      if(!rows.length){
        container.innerHTML = '<div class="placeholder-card"><div class="placeholder-title">No profile found</div><div class="placeholder-sub">This account has no profile record yet.</div></div>';
        return;
      }
      var p = rows[0];
      currentProfile = p;

      var supervisorName = '—';
      if(p.manager_id){
        try{
          var mgrRows = await dbRequest('profiles?id=eq.' + p.manager_id + '&select=full_name,job_title');
          if(mgrRows.length){ supervisorName = mgrRows[0].full_name + (mgrRows[0].job_title ? ' - ' + mgrRows[0].job_title : ''); }
        }catch(e){ console.error(e); }
      }
      currentSupervisorName = supervisorName;
      isEditingProfile = false;

      renderProfile(p, supervisorName, false);
    }catch(e){
      container.innerHTML = '<div class="placeholder-card"><div class="placeholder-title">Couldn\'t load profile</div><div class="placeholder-sub">Try refreshing the page.</div></div>';
      console.error(e);
    }
  }

  function renderProfile(p, supervisorName, editMode){
    var container = document.getElementById('profile-content');
    var admin = isAdmin();
    var editableList = admin ? adminEditableFields : employeeEditableFields;

    function isEditable(key){
      return editMode && editableList.indexOf(key) !== -1;
    }

    function textField(key, label, value){
      if(isEditable(key)){
        return '<div class="info-box"><div class="info-label">' + label + '</div><input class="info-edit-input" id="edit-' + key + '" value="' + (value || '').toString().replace(/"/g, '&quot;') + '"></div>';
      }
      return '<div class="info-box"><div class="info-label">' + label + '</div><div class="info-val">' + (value || '—') + '</div></div>';
    }

    function dateField(key, label, value){
      if(isEditable(key)){
        return '<div class="info-box"><div class="info-label">' + label + '</div><input type="date" class="info-edit-input" id="edit-' + key + '" value="' + (value || '') + '"></div>';
      }
      return '<div class="info-box"><div class="info-label">' + label + '</div><div class="info-val">' + formatDate(value) + '</div></div>';
    }

    var nameBlock = isEditable('full_name')
      ? '<input class="info-edit-input" id="edit-full_name" value="' + (p.full_name || '').replace(/"/g, '&quot;') + '" style="font-family:\'Bebas Neue\',sans-serif;font-size:20px;margin-bottom:4px;">'
      : '<div class="profile-name">' + (p.full_name || '—') + '</div>';

    var titleBlock = isEditable('job_title')
      ? '<input class="info-edit-input" id="edit-job_title" value="' + (p.job_title || '').replace(/"/g, '&quot;') + '">'
      : '<div class="profile-role">' + (p.job_title || '—') + ' · Employee #' + p.employee_number + '</div>';

    var bioBlock = isEditable('bio')
      ? '<div class="bio-box"><div class="info-label">Bio</div><textarea class="info-edit-input" id="edit-bio" rows="3">' + (p.bio || '') + '</textarea></div>'
      : '<div class="bio-box"><div class="info-label">Bio</div><div class="info-val">' + (p.bio || 'No bio added yet.') + '</div></div>';

    var photoBlock = p.photo_url
      ? '<img src="' + escAttr(p.photo_url) + '" class="profile-photo-img" alt="">'
      : '<div class="profile-photo-initials">' + getInitials(p.full_name) + '</div>';

    var photoControlsBlock = '<label class="photo-upload-btn" for="profile-photo-input" title="Change photo">&#9998;</label>'
      + '<input type="file" id="profile-photo-input" accept="image/*" style="display:none;" onchange="uploadProfilePhoto(this.files)">'
      + (p.photo_url ? '<button type="button" class="photo-remove-btn" title="Remove photo" onclick="removeProfilePhoto()">&times;</button>' : '');

    container.innerHTML =
      '<div class="profile-card">'
      + '<div class="profile-top">'
      + '<div class="photo-wrap">' + photoBlock + photoControlsBlock + '</div>'
      + '<div>' + nameBlock + titleBlock + '<span class="save-status" id="photo-upload-status"></span></div>'
      + '</div>'
      + '<div class="profile-grid">'
      + '<div class="info-box"><div class="info-label">Work Email</div><div class="info-val">' + (p.email || '—') + '</div></div>'
      + textField('preferred_name', 'Preferred Name', p.preferred_name)
      + textField('phone', 'Work Phone', p.phone)
      + textField('home_email', 'Home Email', p.home_email)
      + textField('home_phone', 'Home Phone', p.home_phone)
      + textField('department', 'Department', p.departments && p.departments.name)
      + textField('location', 'Location', p.location)
      + '<div class="info-box"><div class="info-label">Supervisor</div><div class="info-val">' + supervisorName + '</div></div>'
      + dateField('start_date', 'Start Date', p.start_date)
      + textField('employment_status', 'Status', p.employment_status)
      + '</div>'
      + bioBlock
      + '<div class="clearance-section">'
      + '<div class="profile-grid">'
      + textField('clearance_level', 'Clearance Level', p.clearance_level)
      + textField('clearance_investigation_type', 'Investigation Type', p.clearance_investigation_type)
      + dateField('clearance_granted_date', 'Granted', p.clearance_granted_date)
      + dateField('clearance_expiration_date', 'Expires', p.clearance_expiration_date)
      + '</div></div>'
      + '<div class="profile-actions">'
      + (editMode
          ? '<button class="btn-save" onclick="saveProfile()">Save</button><button class="btn-cancel" onclick="requestCancelEdit()">Cancel</button><span class="save-status" id="save-status"></span>'
          : '<button class="btn-edit" onclick="editProfile()">Edit Profile</button>')
      + '</div>'
      + '</div>'
      + '<div class="profile-card" id="travel-info-card"><div class="placeholder-sub">Loading travel info...</div></div>';

    loadTravelInfo(p);


    // Track unsaved changes once fields render
    if(editMode){
      isEditingProfile = true;
      container.querySelectorAll('input, textarea').forEach(function(el){
        el.addEventListener('input', function(){ isEditingProfile = true; });
      });
    }
  }

  function editProfile(){
    renderProfile(currentProfile, currentSupervisorName, true);
  }

  // ---------- Profile photo upload (Supabase Storage 'profile-photos' bucket) ----------
  var PROFILE_PHOTO_MAX_BYTES = 5 * 1024 * 1024;

  // Best-effort cleanup of the previous photo file after a replace/remove —
  // failures are swallowed (console-logged only) so a storage hiccup never
  // blocks the profiles.photo_url update the user is actually waiting on.
  function deleteProfilePhotoFile(fileUrl){
    var path = fileUrl && fileUrl.split('/storage/v1/object/public/profile-photos/')[1];
    if(!path){ return; }
    var session = getSession();
    fetch(SUPABASE_URL + '/storage/v1/object/profile-photos/' + encodeURIComponent(path), {
      method: 'DELETE',
      headers: { 'apikey': SUPABASE_ANON_KEY, 'Authorization': 'Bearer ' + session.access_token }
    }).catch(function(e){ console.error(e); });
  }

  async function uploadProfilePhoto(files){
    if(!files || !files.length || !currentProfile){ return; }
    var file = files[0];
    var statusEl = document.getElementById('photo-upload-status');
    if(file.type.indexOf('image/') !== 0){
      if(statusEl){ statusEl.textContent = 'Please choose an image file.'; }
      return;
    }
    if(file.size > PROFILE_PHOTO_MAX_BYTES){
      if(statusEl){ statusEl.textContent = 'Image must be smaller than 5MB.'; }
      return;
    }

    var session = getSession();
    var oldUrl = currentProfile.photo_url;
    // Path is prefixed with the uploader's own user id — required by the
    // Storage RLS policy (self can only write under their own id/ folder;
    // admin policy allows any path). Timestamp avoids collisions/caching
    // issues if the same filename is uploaded twice.
    var path = session.user.id + '/' + Date.now() + '-' + file.name;
    if(statusEl){ statusEl.textContent = 'Uploading...'; }
    try{
      var res = await fetch(SUPABASE_URL + '/storage/v1/object/profile-photos/' + encodeURIComponent(path), {
        method: 'POST',
        headers: {
          'apikey': SUPABASE_ANON_KEY,
          'Authorization': 'Bearer ' + session.access_token,
          'Content-Type': file.type
        },
        body: file
      });
      if(!res.ok){ throw new Error('Upload failed: ' + res.status); }
      var publicUrl = SUPABASE_URL + '/storage/v1/object/public/profile-photos/' + path;
      await dbWrite('profiles?id=eq.' + currentProfile.id, 'PATCH', { photo_url: publicUrl });
      // Old file is only deleted after the new URL is safely saved, so a
      // failed PATCH never leaves the profile pointing at a deleted file.
      if(oldUrl){ deleteProfilePhotoFile(oldUrl); }
      loadProfile();
    }catch(e){
      if(statusEl){ statusEl.textContent = 'Upload failed — try again.'; }
      console.error(e);
    }
  }

  // Reverts to the initials fallback (clears photo_url) rather than just
  // deleting the storage file, so the UI has a defined empty state.
  async function removeProfilePhoto(){
    if(!currentProfile || !currentProfile.photo_url){ return; }
    var oldUrl = currentProfile.photo_url;
    try{
      await dbWrite('profiles?id=eq.' + currentProfile.id, 'PATCH', { photo_url: null });
      deleteProfilePhotoFile(oldUrl);
      loadProfile();
    }catch(e){ console.error(e); }
  }

  function requestCancelEdit(){
    isEditingProfile = false;
    loadProfile();
  }

  // ---------- Travel Info card (own table: employee_travel_programs; KTN stays on profiles) ----------
  var isEditingTravelInfo = false;
  var currentTravelPrograms = [];
  var travelInfoProfileRef = null;

  async function loadTravelInfo(p){
    travelInfoProfileRef = p;
    var card = document.getElementById('travel-info-card');
    if(!card){ return; }
    try{
      var rows = await dbRequest('employee_travel_programs?employee_id=eq.' + p.id + '&select=id,program_type,provider_name,membership_number&order=created_at.asc');
      currentTravelPrograms = rows;
      renderTravelInfo(p, false);
    }catch(e){
      card.innerHTML = '<div class="placeholder-title">Couldn\'t load travel info</div><div class="placeholder-sub">Try refreshing the page.</div>';
      console.error(e);
    }
  }

  function travelProgramRowHtml(row){
    row = row || {};
    var type = row.program_type || 'airline';
    return '<div class="resume-row">'
      + '<div class="resume-row-grid">'
      + '<div class="field-mini-wrap"><span class="field-mini-label">Program Type *</span>'
      + '<select class="info-edit-input" data-field="program_type">'
      + '<option value="airline"' + (type === 'airline' ? ' selected' : '') + '>Airline</option>'
      + '<option value="hotel"' + (type === 'hotel' ? ' selected' : '') + '>Hotel</option>'
      + '<option value="car_rental"' + (type === 'car_rental' ? ' selected' : '') + '>Car Rental</option>'
      + '</select></div>'
      + '<div class="field-mini-wrap"><span class="field-mini-label">Provider *</span><input class="info-edit-input" placeholder="e.g. Delta, Marriott, Hertz" data-field="provider_name" value="' + escAttr(row.provider_name) + '"></div>'
      + '<div class="field-mini-wrap"><span class="field-mini-label">Membership Number *</span><input class="info-edit-input" data-field="membership_number" value="' + escAttr(row.membership_number) + '"></div>'
      + '</div>'
      + '<button type="button" class="btn-remove-row" onclick="this.closest(\'.resume-row\').remove()">Remove</button>'
      + '</div>';
  }

  function addTravelProgramRow(){
    document.getElementById('travel-program-rows').insertAdjacentHTML('beforeend', travelProgramRowHtml());
  }

  function renderTravelInfo(p, editMode){
    var card = document.getElementById('travel-info-card');
    if(!card){ return; }
    var editable = isAdmin() ? adminEditableFields.indexOf('known_traveler_number') !== -1 : true;

    var ktnBlock = (editMode && editable)
      ? '<div class="info-box"><div class="info-label">Known Traveler Number</div><input class="info-edit-input" id="edit-travel-ktn" value="' + escAttr(p.known_traveler_number) + '"></div>'
      : '<div class="info-box"><div class="info-label">Known Traveler Number</div><div class="info-val">' + (p.known_traveler_number || '—') + '</div></div>';

    var programsBlock = editMode
      ? '<div class="resume-section"><div class="resume-section-title">Loyalty Programs</div><div id="travel-program-rows">'
        + currentTravelPrograms.map(travelProgramRowHtml).join('')
        + '</div><button type="button" class="btn-add-row" onclick="addTravelProgramRow()">+ Add program</button></div>'
      : '<div class="resume-section"><div class="resume-section-title">Loyalty Programs</div>'
        + (currentTravelPrograms.length
            ? currentTravelPrograms.map(function(t){
                var typeLabel = t.program_type === 'car_rental' ? 'Car Rental' : (t.program_type.charAt(0).toUpperCase() + t.program_type.slice(1));
                return '<div class="resume-view-row"><div class="resume-row-header">' + typeLabel + '</div><div class="resume-view-row-title">' + (t.provider_name || '—') + '</div><div class="resume-view-row-dates">' + (t.membership_number || '—') + '</div></div>';
              }).join('')
            : '<div class="info-val" style="color:var(--muted);">None added yet.</div>')
        + '</div>';

    card.innerHTML =
      '<div class="resume-section-title" style="margin-bottom:14px;">Travel Info</div>'
      + '<div class="profile-grid">' + ktnBlock + '</div>'
      + programsBlock
      + '<div class="profile-actions">'
      + (editMode
          ? '<button class="btn-save" onclick="saveTravelInfo()">Save</button><button class="btn-cancel" onclick="cancelTravelInfoEdit()">Cancel</button><span class="save-status" id="travel-info-save-status"></span>'
          : '<button class="btn-edit" onclick="editTravelInfo()">Edit Travel Info</button>')
      + '</div>';

    if(editMode){
      isEditingTravelInfo = true;
      card.querySelectorAll('input, select').forEach(function(el){
        el.addEventListener('input', function(){ isEditingTravelInfo = true; });
        el.addEventListener('change', function(){ isEditingTravelInfo = true; });
      });
    }
  }

  function editTravelInfo(){
    renderTravelInfo(travelInfoProfileRef, true);
  }

  function cancelTravelInfoEdit(){
    isEditingTravelInfo = false;
    loadTravelInfo(travelInfoProfileRef);
  }

  async function saveTravelInfo(){
    var statusEl = document.getElementById('travel-info-save-status');
    var p = travelInfoProfileRef;
    try{
      var ktnInput = document.getElementById('edit-travel-ktn');
      if(ktnInput){
        await dbWrite('profiles?id=eq.' + p.id, 'PATCH', { known_traveler_number: ktnInput.value.trim() });
      }

      var newRows = harvestRows('travel-program-rows', ['program_type', 'provider_name', 'membership_number']);
      var existingIds = currentTravelPrograms.map(function(r){ return r.id; });

      await dbWrite('employee_travel_programs?employee_id=eq.' + p.id, 'DELETE', {});

      if(newRows.length){
        var inserts = newRows.map(function(r){
          return { employee_id: p.id, program_type: r.program_type, provider_name: r.provider_name, membership_number: r.membership_number };
        });
        await dbWrite('employee_travel_programs', 'POST', inserts);
      }

      isEditingTravelInfo = false;
      if(statusEl){ statusEl.textContent = 'Saved'; }
      loadTravelInfo(p);
    }catch(e){
      if(statusEl){ statusEl.textContent = 'Error saving'; }
      console.error(e);
    }
  }

  async function saveProfile(){
    var statusEl = document.getElementById('save-status');
    var editableList = isAdmin() ? adminEditableFields : employeeEditableFields;
    var updates = {};
    editableList.forEach(function(key){
      var el = document.getElementById('edit-' + key);
      if(el){ updates[key] = el.value; }
    });

    statusEl.textContent = 'Saving...';
    var session = getSession();
    var targetId = currentProfile.id;
    try{
      var res = await fetch(SUPABASE_URL + '/rest/v1/profiles?id=eq.' + targetId, {
        method: 'PATCH',
        headers: {
          'apikey': SUPABASE_ANON_KEY,
          'Authorization': 'Bearer ' + session.access_token,
          'Content-Type': 'application/json',
          'Prefer': 'return=minimal'
        },
        body: JSON.stringify(updates)
      });
      if(!res.ok){ throw new Error('Save failed'); }
      statusEl.textContent = 'Saved';
      isEditingProfile = false;
      setTimeout(loadProfile, 600);
    }catch(e){
      statusEl.textContent = 'Save failed — try again';
      console.error(e);
    }
  }

  // ---------- Resume screen ----------
  var currentResume = null;
  var currentResumeOwner = null;
  var isEditingResume = false;

  function canEditResume(){
    var session = getSession();
    return currentResumeOwner && (currentResumeOwner.id === session.user.id || isAdmin());
  }


  function bulletListHtml(text, style){
    if(!text){ return ''; }
    var lines = text.split('\n').map(function(l){ return l.trim(); }).filter(Boolean);
    if(!lines.length){ return ''; }
    var liStyle = style || '';
    return '<ul style="margin:6px 0 0 18px;padding:0;' + liStyle + '">' + lines.map(function(l){ return '<li>' + l + '</li>'; }).join('') + '</ul>';
  }

  function workHistoryRowHtml(w, idx){
    w = w || {};
    var headerLabel = (idx === 0) ? 'Current Job' : ('Job ' + (idx + 1));
    var checked = w.current ? 'checked' : '';
    var checkboxHtml = (idx === 0)
      ? '<label class="resume-row-checkbox"><input type="checkbox" data-field="current" ' + checked + ' onchange="this.closest(\'.resume-row\').querySelector(\'[data-field=end]\').disabled = this.checked; if(this.checked){ this.closest(\'.resume-row\').querySelector(\'[data-field=end]\').value=\'\'; }">I currently work here</label>'
      : '';
    return '<div class="resume-row">'
      + '<div class="resume-row-header">' + headerLabel + '</div>'
      + '<div class="resume-row-grid">'
      + '<div class="field-mini-wrap"><span class="field-mini-label">Job Title</span><input class="info-edit-input" placeholder="Job title" data-field="title" value="' + escAttr(w.title) + '"></div>'
      + '<div class="field-mini-wrap"><span class="field-mini-label">Company</span><input class="info-edit-input" placeholder="Company" data-field="company" value="' + escAttr(w.company) + '"></div>'
      + '<div class="field-mini-wrap"><span class="field-mini-label">Location</span><input class="info-edit-input" placeholder="City, State" data-field="location" value="' + escAttr(w.location) + '"></div>'
      + '<div class="field-mini-wrap"><span class="field-mini-label">Start Date</span><input type="date" class="info-edit-input" data-field="start" value="' + escAttr(w.start) + '"></div>'
      + '<div class="field-mini-wrap"><span class="field-mini-label">End Date</span><input type="date" class="info-edit-input" data-field="end" value="' + escAttr(w.end) + '" ' + (idx === 0 && w.current ? 'disabled' : '') + '></div>'
      + '</div>'
      + checkboxHtml
      + '<span class="field-mini-label">Description (one achievement per line — each becomes a bullet point)</span>'
      + '<textarea class="info-edit-input" placeholder="One achievement per line" data-field="description" rows="8">' + escAttr(w.description) + '</textarea>'
      + '<button type="button" class="btn-remove-row" onclick="this.closest(\'.resume-row\').remove(); renumberWorkRows();">Remove</button>'
      + '</div>';
  }

  function renumberWorkRows(){
    var rows = document.querySelectorAll('#work-history-rows .resume-row');
    rows.forEach(function(row, i){
      row.querySelector('.resume-row-header').textContent = (i === 0) ? 'Current Job' : ('Job ' + (i + 1));
      var existingCheckbox = row.querySelector('.resume-row-checkbox');
      if(i === 0 && !existingCheckbox){
        row.querySelector('.resume-row-grid').insertAdjacentHTML('afterend',
          '<label class="resume-row-checkbox"><input type="checkbox" data-field="current" onchange="this.closest(\'.resume-row\').querySelector(\'[data-field=end]\').disabled = this.checked; if(this.checked){ this.closest(\'.resume-row\').querySelector(\'[data-field=end]\').value=\'\'; }">I currently work here</label>');
      }else if(i !== 0 && existingCheckbox){
        var endInput = row.querySelector('[data-field=end]');
        endInput.disabled = false;
        existingCheckbox.remove();
      }
    });
  }

  function eduRowHtml(ed){
    ed = ed || {};
    return '<div class="resume-row">'
      + '<div class="resume-row-grid">'
      + '<div class="field-mini-wrap"><span class="field-mini-label">Degree *</span><input class="info-edit-input" placeholder="Degree" data-field="degree" value="' + escAttr(ed.degree) + '"></div>'
      + '<div class="field-mini-wrap"><span class="field-mini-label">School *</span><input class="info-edit-input" placeholder="School" data-field="school" value="' + escAttr(ed.school) + '"></div>'
      + '<div class="field-mini-wrap"><span class="field-mini-label">Location</span><input class="info-edit-input" placeholder="City, State" data-field="location" value="' + escAttr(ed.location) + '"></div>'
      + '<div class="field-mini-wrap"><span class="field-mini-label">Date Earned *</span><input class="info-edit-input" placeholder="e.g. 2018" data-field="year" value="' + escAttr(ed.year) + '"></div>'
      + '</div>'
      + '<div class="field-mini-wrap"><span class="field-mini-label">GPA (optional)</span><input class="info-edit-input" placeholder="GPA" data-field="gpa" value="' + escAttr(ed.gpa) + '" style="margin-bottom:8px;"></div>'
      + '<span class="field-mini-label">Honors, coursework, activities, or other achievements (optional)</span>'
      + '<textarea class="info-edit-input" placeholder="Honors, coursework, activities, or other achievements" data-field="honors" rows="2">' + escAttr(ed.honors) + '</textarea>'
      + '<button type="button" class="btn-remove-row" onclick="this.closest(\'.resume-row\').remove()">Remove</button>'
      + '</div>';
  }

  function certRowHtml(c){
    c = c || {};
    return '<div class="resume-row">'
      + '<div class="resume-row-grid">'
      + '<div class="field-mini-wrap"><span class="field-mini-label">Certification Name *</span><input class="info-edit-input" placeholder="Certification name" data-field="name" value="' + escAttr(c.name) + '"></div>'
      + '<div class="field-mini-wrap"><span class="field-mini-label">Issuer *</span><input class="info-edit-input" placeholder="Issuer" data-field="issuer" value="' + escAttr(c.issuer) + '"></div>'
      + '<div class="field-mini-wrap"><span class="field-mini-label">Date Earned *</span><input type="date" class="info-edit-input" data-field="date" value="' + escAttr(c.date) + '"></div>'
      + '<div class="field-mini-wrap"><span class="field-mini-label">Expiration (optional)</span><input type="date" class="info-edit-input" data-field="expiration" value="' + escAttr(c.expiration) + '"></div>'
      + '</div>'
      + '<button type="button" class="btn-remove-row" onclick="this.closest(\'.resume-row\').remove()">Remove</button>'
      + '</div>';
  }

  function addWorkRow(){ document.getElementById('work-history-rows').insertAdjacentHTML('beforeend', workHistoryRowHtml(null, document.querySelectorAll('#work-history-rows .resume-row').length)); }
  function addEduRow(){ document.getElementById('education-rows').insertAdjacentHTML('beforeend', eduRowHtml()); }
  function addCertRow(){ document.getElementById('cert-rows').insertAdjacentHTML('beforeend', certRowHtml()); }

  function harvestRows(containerId, fields, checkboxFields){
    checkboxFields = checkboxFields || [];
    var rows = document.querySelectorAll('#' + containerId + ' .resume-row');
    var out = [];
    rows.forEach(function(row){
      var obj = {};
      var any = false;
      fields.forEach(function(f){
        var el = row.querySelector('[data-field="' + f + '"]');
        var v = el ? el.value.trim() : '';
        obj[f] = v;
        if(v){ any = true; }
      });
      checkboxFields.forEach(function(f){
        var el = row.querySelector('[data-field="' + f + '"]');
        obj[f] = el ? el.checked : false;
      });
      if(any){ out.push(obj); }
    });
    return out;
  }

  async function loadResume(ownerId, containerId, bannerId){
    containerId = containerId || 'resume-content';
    bannerId = bannerId || 'resume-viewing-banner';
    var container = document.getElementById(containerId);
    container.innerHTML = '<div class="placeholder-card"><div class="placeholder-sub">Loading resume...</div></div>';
    try{
      var rows = await dbRequest('resumes?id=eq.' + ownerId + '&select=*,profiles(full_name,job_title)');
      if(!rows.length){
        container.innerHTML = '<div class="placeholder-card"><div class="placeholder-title">No resume found</div><div class="placeholder-sub">This employee has no resume record yet.</div></div>';
        return;
      }
      currentResume = rows[0];
      currentResumeOwner = rows[0].profiles || {};
      currentResumeOwner.id = ownerId;
      isEditingResume = false;
      renderResumeBanner(bannerId);
      renderResume(currentResume, currentResumeOwner, false, containerId);
    }catch(e){
      container.innerHTML = '<div class="placeholder-card"><div class="placeholder-title">Couldn\'t load resume</div><div class="placeholder-sub">Try refreshing the page.</div></div>';
      console.error(e);
    }
  }

  function renderResumeBanner(bannerId){
    bannerId = bannerId || 'resume-viewing-banner';
    var el = document.getElementById(bannerId);
    var session = getSession();
    if(currentResumeOwner.id !== session.user.id){
      el.innerHTML = '<div class="resume-viewing-banner">Viewing <strong>' + (currentResumeOwner.full_name || '—') + '</strong>\'s resume &nbsp;·&nbsp; <a href="#" onclick="requestViewResume(\'' + session.user.id + '\');return false;">Back to mine</a></div>';
    }else{
      el.innerHTML = '';
    }
  }

  function renderResume(r, owner, editMode, containerId){
    var container = document.getElementById(containerId || 'resume-content');
    var editable = editMode && canEditResume();

    function listView(label, items, formatter){
      if(!items || !items.length){
        return '<div class="resume-section"><div class="resume-section-title">' + label + '</div><div class="info-val" style="color:var(--muted);">None added yet.</div></div>';
      }
      return '<div class="resume-section"><div class="resume-section-title">' + label + '</div>' + items.map(formatter).join('') + '</div>';
    }

    var summaryBlock = editable
      ? '<div class="resume-section"><div class="resume-section-title">Summary</div><textarea class="info-edit-input" id="edit-summary" rows="5">' + escAttr(r.summary) + '</textarea></div>'
      : '<div class="resume-section"><div class="resume-section-title">Summary</div><div class="info-val">' + (r.summary || 'No summary added yet.') + '</div></div>';

    var contactBlock = editable
      ? '<div class="resume-section"><div class="resume-section-title">Contact</div><div class="profile-grid">'
        + '<div class="info-box"><div class="info-label">Email</div><input type="email" class="info-edit-input" id="edit-email" value="' + escAttr(r.email) + '"></div>'
        + '<div class="info-box"><div class="info-label">LinkedIn</div><input type="url" class="info-edit-input" id="edit-linkedin_url" placeholder="https://linkedin.com/in/..." value="' + escAttr(r.linkedin_url) + '"></div>'
        + '<div class="info-box"><div class="info-label">Years Experience</div><input type="text" class="info-edit-input" id="edit-years_experience" value="' + escAttr(r.years_experience) + '"></div>'
        + '<div class="info-box"><div class="info-label">Personal Phone</div><input type="tel" class="info-edit-input" id="edit-personal_phone" value="' + escAttr(r.personal_phone) + '"></div>'
        + '</div></div>'
      : '<div class="resume-section"><div class="resume-section-title">Contact</div><div class="profile-grid">'
        + '<div class="info-box"><div class="info-label">Email</div><div class="info-val">' + (r.email || '—') + '</div></div>'
        + '<div class="info-box"><div class="info-label">LinkedIn</div><div class="info-val">' + (r.linkedin_url ? '<a href="' + r.linkedin_url + '" target="_blank" style="color:var(--teal);">' + r.linkedin_url + '</a>' : '—') + '</div></div>'
        + '<div class="info-box"><div class="info-label">Years Experience</div><div class="info-val">' + (r.years_experience != null && r.years_experience !== '' ? r.years_experience : '—') + '</div></div>'
        + '<div class="info-box"><div class="info-label">Personal Phone</div><div class="info-val">' + (r.personal_phone || '—') + '</div></div>'
        + '</div></div>';


    var workBlock = editable
      ? '<div class="resume-section"><div class="resume-section-title">Work History</div><div id="work-history-rows">' + (r.work_history || []).map(function(w, i){ return workHistoryRowHtml(w, i); }).join('') + '</div><button type="button" class="btn-add-row" onclick="addWorkRow()">+ Add position</button></div>'
      : listView('Work History', r.work_history, function(w, i){
          var label = (i === 0) ? 'Current Job' : ('Job ' + (i + 1));
          return '<div class="resume-view-row"><div class="resume-row-header">' + label + '</div><div class="resume-view-row-title">' + (w.title || '—') + '</div>'
            + '<div class="resume-view-row-dates">' + (w.company || '—') + (w.location ? ', ' + w.location : '') + '</div>'
            + '<div class="resume-view-row-dates">' + formatDate(w.start) + ' – ' + (w.current ? 'Present' : formatDate(w.end)) + '</div>'
            + bulletListHtml(w.description)
            + '</div>';
        });

    var eduBlock = editable
      ? '<div class="resume-section"><div class="resume-section-title">Education</div><div id="education-rows">' + (r.education || []).map(eduRowHtml).join('') + '</div><button type="button" class="btn-add-row" onclick="addEduRow()">+ Add education</button></div>'
      : listView('Education', r.education, function(ed){
          return '<div class="resume-view-row"><div class="resume-view-row-title">' + (ed.degree || '—') + ' · ' + (ed.school || '—') + (ed.location ? ' · ' + ed.location : '') + '</div>'
            + '<div class="resume-view-row-dates">' + (ed.year || '') + (ed.gpa ? ' · GPA ' + ed.gpa : '') + '</div>'
            + (ed.honors ? '<div class="resume-view-row-desc">' + ed.honors + '</div>' : '')
            + '</div>';
        });

    var certBlock = editable
      ? '<div class="resume-section"><div class="resume-section-title">Certifications</div><div id="cert-rows">' + (r.certifications || []).map(certRowHtml).join('') + '</div><button type="button" class="btn-add-row" onclick="addCertRow()">+ Add certification</button></div>'
      : listView('Certifications', r.certifications, function(c){
          return '<div class="resume-view-row"><div class="resume-view-row-title">' + (c.name || '—') + ' · ' + (c.issuer || '—') + '</div>'
            + '<div class="resume-view-row-dates">Earned ' + formatDate(c.date) + (c.expiration ? ' · Expires ' + formatDate(c.expiration) : '') + '</div></div>';
        });

    var skillsBlock = editable
      ? '<div class="resume-section"><div class="resume-section-title">Skills</div>'
        + '<div class="skill-pill-list" id="skill-pill-list">' + (r.skills || []).map(function(s){ return skillPillHtml(s); }).join('') + '</div>'
        + '<div class="skill-pill-input-wrap">'
        + '<span class="save-status" id="skill-counter"></span>'
        + '<div class="skill-bank-panel" id="skill-bank-dropdown">'
        + '<input class="info-edit-input" id="skill-bank-filter" placeholder="Filter skills or type a new one..." autocomplete="off" style="margin:8px;width:calc(100% - 16px);" oninput="renderSkillDropdownList(this.value)">'
        + '<div class="skill-bank-options-list" id="skill-bank-options"></div>'
        + '</div></div>'
        + '</div>'
      : '<div class="resume-section"><div class="resume-section-title">Skills</div>'
        + (r.skills && r.skills.length
            ? '<div class="skills-tags">' + r.skills.map(function(s){ return '<span class="skill-tag">' + s + '</span>'; }).join('') + '</div>'
            : '<div class="info-val" style="color:var(--muted);">None added yet.</div>')
        + '</div>';

    container.innerHTML =
      '<div class="profile-card">'
      + '<div class="profile-top"><div><div class="profile-name">' + (owner.full_name || '—') + '</div><div class="profile-role">' + (owner.job_title || '—') + '</div></div></div>'
      + summaryBlock
      + contactBlock
      + workBlock + eduBlock + certBlock + skillsBlock
      + '<div class="profile-actions">'
      + (editMode
          ? '<button class="btn-save" onclick="saveResume()">Save</button><button class="btn-cancel" onclick="requestCancelResumeEdit()">Cancel</button><span class="save-status" id="resume-save-status"></span>'
          : (canEditResume() ? '<button class="btn-edit" onclick="editResume()">Edit Resume</button>' : ''))
      + '</div>'
      + '</div>';

    if(editMode){
      isEditingResume = true;
      loadSkillsBank();
      container.querySelectorAll('input, textarea').forEach(function(el){
        el.addEventListener('input', function(){ isEditingResume = true; });
      });
    }
  }

  var skillsBankCache = [];
  var currentSkills = [];
  var SKILLS_MAX = 12;

  function skillPillHtml(s){
    return '<span class="skill-pill" data-skill="' + escAttr(s) + '">' + s + '<button type="button" onclick="removeSkillPill(this, \'' + escAttr(s).replace(/'/g, "\\'") + '\')">×</button></span>';
  }

  async function loadSkillsBank(){
    currentSkills = (currentResume.skills || []).slice();
    try{
      skillsBankCache = await dbRequest('skills_bank?select=label&order=label.asc');
    }catch(e){
      skillsBankCache = [];
      console.error(e);
    }
    renderSkillCounter();
    renderSkillDropdownList('');
  }

  function renderSkillCounter(){
    var el = document.getElementById('skill-counter');
    if(el){ el.textContent = currentSkills.length + '/' + SKILLS_MAX + ' selected'; }
  }

  function renderSkillDropdownList(filterText){
    var optionsEl = document.getElementById('skill-bank-options');
    var query = (filterText || '').trim().toLowerCase();
    var atMax = currentSkills.length >= SKILLS_MAX;
    var matches = skillsBankCache.filter(function(s){ return !query || s.label.toLowerCase().indexOf(query) !== -1; });
    var html = matches.map(function(s){
      var picked = currentSkills.indexOf(s.label) !== -1;
      var disabled = (!picked && atMax) ? 'disabled' : '';
      return '<label class="skill-bank-option" style="display:flex;align-items:center;gap:8px;' + (disabled ? 'opacity:0.4;' : '') + '">'
        + '<input type="checkbox" ' + (picked ? 'checked' : '') + ' ' + disabled + ' onchange="toggleSkillSelection(\'' + escAttr(s.label).replace(/'/g, "\\'") + '\', this.checked)">'
        + s.label + '</label>';
    }).join('');
    if(query && !skillsBankCache.some(function(s){ return s.label.toLowerCase() === query; }) && !atMax){
      html += '<div class="skill-bank-option add-new" onclick="addNewSkillToBank(document.getElementById(\'skill-bank-filter\').value.trim())">+ Add "' + filterText + '" to skills bank</div>';
    }
    optionsEl.innerHTML = html || '<div class="skill-bank-option" style="color:var(--muted);">No matches.</div>';
  }

  function toggleSkillSelection(label, isChecked){
    if(isChecked){
      if(currentSkills.length >= SKILLS_MAX){ return; }
      currentSkills.push(label);
      document.getElementById('skill-pill-list').insertAdjacentHTML('beforeend', skillPillHtml(label));
    }else{
      currentSkills = currentSkills.filter(function(s){ return s !== label; });
      var pill = document.querySelector('#skill-pill-list .skill-pill[data-skill="' + escAttr(label) + '"]');
      if(pill){ pill.remove(); }
    }
    isEditingResume = true;
    renderSkillCounter();
    renderSkillDropdownList(document.getElementById('skill-bank-filter').value);
  }

  async function addNewSkillToBank(label){
    if(!label || currentSkills.length >= SKILLS_MAX){ return; }
    skillsBankCache.push({ label: label });
    skillsBankCache.sort(function(a, b){ return a.label.localeCompare(b.label); });
    toggleSkillSelection(label, true);
    document.getElementById('skill-bank-filter').value = '';
    renderSkillDropdownList('');
    try{
      var session = getSession();
      await fetch(SUPABASE_URL + '/rest/v1/skills_bank', {
        method: 'POST',
        headers: {
          'apikey': SUPABASE_ANON_KEY,
          'Authorization': 'Bearer ' + session.access_token,
          'Content-Type': 'application/json',
          'Prefer': 'return=minimal'
        },
        body: JSON.stringify({ label: label, created_by: session.user.id })
      });
    }catch(e){ console.error(e); }
  }

  function removeSkillPill(btn, label){
    currentSkills = currentSkills.filter(function(s){ return s !== label; });
    btn.closest('.skill-pill').remove();
    isEditingResume = true;
    renderSkillCounter();
    renderSkillDropdownList(document.getElementById('skill-bank-filter').value);
  }

  function getActiveResumeContext(){
    if(document.getElementById('screen-admin') && document.getElementById('screen-admin').classList.contains('active')){
      return { containerId: 'admin-resume-content', bannerId: 'admin-resume-viewing-banner' };
    }
    if(document.getElementById('screen-myteam') && document.getElementById('screen-myteam').classList.contains('active')){
      return { containerId: 'myteam-resume-content', bannerId: 'myteam-resume-viewing-banner' };
    }
    return { containerId: 'resume-content', bannerId: 'resume-viewing-banner' };
  }

  function editResume(){
    var ctx = getActiveResumeContext();
    renderResume(currentResume, currentResumeOwner, true, ctx.containerId);
  }

  function requestCancelResumeEdit(){
    isEditingResume = false;
    var ctx = getActiveResumeContext();
    loadResume(currentResumeOwner.id, ctx.containerId, ctx.bannerId);
  }

  function validateRequiredRows(containerId, requiredFields, rowLabel){
    var rows = document.querySelectorAll('#' + containerId + ' .resume-row');
    for(var i = 0; i < rows.length; i++){
      var row = rows[i];
      var values = {};
      row.querySelectorAll('[data-field]').forEach(function(el){
        values[el.dataset.field] = el.value ? el.value.trim() : '';
      });
      var hasAny = Object.keys(values).some(function(k){ return values[k]; });
      if(!hasAny){ continue; }
      var missing = requiredFields.filter(function(f){ return !values[f]; });
      if(missing.length){
        return rowLabel + ' #' + (i + 1) + ' is missing: ' + missing.join(', ');
      }
    }
    return null;
  }

  async function saveResume(){
    var statusEl = document.getElementById('resume-save-status');

    var eduError = validateRequiredRows('education-rows', ['degree','school','year'], 'Education entry');
    if(eduError){ statusEl.textContent = eduError; return; }
    var certError = validateRequiredRows('cert-rows', ['name','issuer','date'], 'Certification entry');
    if(certError){ statusEl.textContent = certError; return; }

    var yearsVal = document.getElementById('edit-years_experience').value.trim();
    var updates = {
      summary: document.getElementById('edit-summary').value,
      email: document.getElementById('edit-email').value.trim(),
      linkedin_url: document.getElementById('edit-linkedin_url').value.trim(),
      personal_phone: document.getElementById('edit-personal_phone').value.trim(),
      years_experience: yearsVal === '' ? null : yearsVal,
      work_history: harvestRows('work-history-rows', ['title','company','location','start','end','description'], ['current']),
      education: harvestRows('education-rows', ['degree','school','location','year','gpa','honors']),
      certifications: harvestRows('cert-rows', ['name','issuer','date','expiration']),
      skills: currentSkills
    };
    statusEl.textContent = 'Saving...';
    var session = getSession();
    try{
      var res = await fetch(SUPABASE_URL + '/rest/v1/resumes?id=eq.' + currentResumeOwner.id, {
        method: 'PATCH',
        headers: {
          'apikey': SUPABASE_ANON_KEY,
          'Authorization': 'Bearer ' + session.access_token,
          'Content-Type': 'application/json',
          'Prefer': 'return=minimal'
        },
        body: JSON.stringify(updates)
      });
      if(!res.ok){ throw new Error('Save failed'); }
      statusEl.textContent = 'Saved';
      isEditingResume = false;
      var ctx = getActiveResumeContext();
      setTimeout(function(){ loadResume(currentResumeOwner.id, ctx.containerId, ctx.bannerId); }, 600);
    }catch(e){
      statusEl.textContent = 'Save failed — try again';
      console.error(e);
    }
  }

  function requestViewResume(ownerId){
    var ctx = getActiveResumeContext();
    if(isEditingResume){
      pendingNavTarget = function(){ loadResume(ownerId, ctx.containerId, ctx.bannerId); };
      document.getElementById('unsaved-modal').classList.add('active');
      return;
    }
    loadResume(ownerId, ctx.containerId, ctx.bannerId);
  }

  var resumeSearchDebounce = null;
  var resumeCart = [];

  function debounceSearchResumes(){
    clearTimeout(resumeSearchDebounce);
    resumeSearchDebounce = setTimeout(searchResumes, 250);
  }

  function onResumeSearchInput(){
    var input = document.getElementById('resume-search-input');
    var clearBtn = document.getElementById('resume-search-clear-btn');
    if(clearBtn){ clearBtn.style.display = input.value ? '' : 'none'; }
    debounceSearchResumes();
  }

  function clearResumeSearch(){
    var input = document.getElementById('resume-search-input');
    input.value = '';
    document.getElementById('resume-search-results').innerHTML = '';
    var clearBtn = document.getElementById('resume-search-clear-btn');
    if(clearBtn){ clearBtn.style.display = 'none'; }
    input.focus();
  }

  async function searchResumes(){
    var q = document.getElementById('resume-search-input').value.trim().toLowerCase();
    var resultsEl = document.getElementById('resume-search-results');
    if(!q){ resultsEl.innerHTML = ''; return; }
    resultsEl.innerHTML = '<div class="info-val" style="color:var(--muted);">Searching...</div>';
    try{
      var deptRows = await dbRequest('departments?select=id,name');
      var deptNameById = {};
      deptRows.forEach(function(d){ deptNameById[d.id] = d.name; });

      var rows = await dbRequest('resumes?select=id,summary,skills,profiles(full_name,job_title,department_id)');
      var matches = rows.filter(function(r){
        var name = (r.profiles && r.profiles.full_name || '').toLowerCase();
        var department = ((r.profiles && deptNameById[r.profiles.department_id]) || '').toLowerCase();
        var summary = (r.summary || '').toLowerCase();
        var skills = (r.skills || []).join(' ').toLowerCase();
        return name.indexOf(q) !== -1 || department.indexOf(q) !== -1 || summary.indexOf(q) !== -1 || skills.indexOf(q) !== -1;
      });
      if(!matches.length){
        resultsEl.innerHTML = '<div class="info-val" style="color:var(--muted);">No matches.</div>';
        return;
      }
      resultsEl.innerHTML = matches.map(function(r){
        var name = (r.profiles && r.profiles.full_name) || 'Unknown';
        var title = (r.profiles && r.profiles.job_title) || '';
        var inCart = resumeCart.indexOf(r.id) !== -1;
        return '<div class="search-result-row">'
          + '<div onclick="selectTeamResumeEmployee(\'admin\',\'' + r.id + '\')" style="cursor:pointer;flex:1;"><div class="resume-view-row-title">' + name + (title ? ' · ' + title : '') + '</div></div>'
          + '<button type="button" class="btn-cart-add" ' + (inCart ? 'disabled' : '') + ' onclick="event.stopPropagation();addToResumeCart(\'' + r.id + '\',\'' + escAttr(name).replace(/'/g, "\\'") + '\')">' + (inCart ? 'Added' : '+ Add to cart') + '</button>'
          + '</div>';
      }).join('');
    }catch(e){
      resultsEl.innerHTML = '<div class="info-val" style="color:var(--red);">Search failed.</div>';
      console.error(e);
    }
  }

  var resumeCartMeta = {};

  function addToResumeCart(id, name){
    if(resumeCart.indexOf(id) !== -1){ return; }
    resumeCart.push(id);
    resumeCartMeta[id] = name;
    renderResumeCart();
    searchResumes();
  }

  function removeFromResumeCart(id){
    resumeCart = resumeCart.filter(function(c){ return c !== id; });
    renderResumeCart();
    searchResumes();
  }

  function renderResumeCart(){
    var listEl = document.getElementById('resume-cart-list');
    var btn = document.getElementById('print-cart-btn');
    var clearBtn = document.getElementById('clear-cart-btn');
    if(!resumeCart.length){
      listEl.innerHTML = '<div class="resume-cart-empty">No resumes added yet.</div>';
    }else{
      listEl.innerHTML = resumeCart.map(function(id){
        return '<div class="resume-cart-item"><span>' + (resumeCartMeta[id] || 'Unknown') + '</span><button type="button" onclick="removeFromResumeCart(\'' + id + '\')">Remove</button></div>';
      }).join('');
    }
    btn.textContent = 'Print Selected (' + resumeCart.length + ')';
    btn.disabled = resumeCart.length === 0;
    clearBtn.disabled = resumeCart.length === 0;
  }

  function clearResumeCart(){
    resumeCart = [];
    resumeCartMeta = {};
    renderResumeCart();
    searchResumes();
  }

  function printableResumeHtml(r, owner){
    function pSection(label, html){
      return '<div style="margin-top:18px;"><div style="font-size:11px;letter-spacing:1.5px;text-transform:uppercase;color:#5C607E;margin-bottom:8px;">' + label + '</div>' + html + '</div>';
    }
    var work = (r.work_history || []).map(function(w){
      return '<div style="margin-bottom:10px;">'
        + '<div style="font-weight:600;">' + (w.title || '—') + '</div>'
        + '<div style="font-size:13px;">' + (w.company || '—') + (w.location ? ', ' + w.location : '') + '</div>'
        + '<div style="font-size:12px;color:#555;">' + formatDate(w.start) + ' – ' + (w.current ? 'Present' : formatDate(w.end)) + '</div>'
        + bulletListHtml(w.description, 'font-size:13px;')
        + '</div>';
    }).join('') || '<div style="color:#999;">None added.</div>';
    var edu = (r.education || []).map(function(ed){
      return '<div style="margin-bottom:8px;"><div style="font-weight:600;">' + (ed.degree || '—') + ' · ' + (ed.school || '—') + (ed.location ? ' · ' + ed.location : '') + '</div>'
        + '<div style="font-size:12px;color:#555;">' + (ed.year || '') + (ed.gpa ? ' · GPA ' + ed.gpa : '') + '</div>'
        + (ed.honors ? '<div style="font-size:13px;">' + ed.honors + '</div>' : '')
        + '</div>';
    }).join('') || '<div style="color:#999;">None added.</div>';
    var certs = (r.certifications || []).map(function(c){
      return '<div style="margin-bottom:6px;"><span style="font-weight:600;">' + (c.name || '—') + '</span> · ' + (c.issuer || '—')
        + '<div style="font-size:12px;color:#555;">Earned ' + formatDate(c.date) + (c.expiration ? ' · Expires ' + formatDate(c.expiration) : '') + '</div></div>';
    }).join('') || '<div style="color:#999;">None added.</div>';
    var skills = (r.skills && r.skills.length)
      ? '<div style="font-size:13px;">' + r.skills.join(', ') + '</div>'
      : '<div style="color:#999;">None added.</div>';
    var clearance = (owner.clearance_level || owner.clearance_investigation_type || owner.clearance_expiration_date)
      ? '<div style="font-size:13px;">' + (owner.clearance_level || '—') + (owner.clearance_investigation_type ? ' (' + owner.clearance_investigation_type + ')' : '') + (owner.clearance_expiration_date ? ' · Expires ' + formatDate(owner.clearance_expiration_date) : '') + '</div>'
      : '';

    return '<div class="print-resume-page" style="color:#111;font-family:Arial,sans-serif;">'
      + '<div style="text-align:center;font-size:26px;font-weight:700;">' + (owner.full_name || '—') + '</div>'
      + '<div style="text-align:center;font-size:14px;color:#555;margin-bottom:6px;">' + (owner.job_title || '—') + '</div>'
      + '<div style="text-align:center;font-size:12px;color:#555;">' + (r.email || '') + (r.linkedin_url ? ' · ' + r.linkedin_url : '') + (r.personal_phone ? ' · ' + r.personal_phone : '') + (r.years_experience ? ' · ' + r.years_experience + ' yrs experience' : '') + '</div>'
      + (r.summary ? pSection('Summary', '<div style="font-size:13px;">' + r.summary + '</div>') : '')
      + pSection('Work History', work)
      + pSection('Education', edu)
      + pSection('Certifications', certs)
      + pSection('Skills', skills)
      + (clearance ? pSection('Security Clearance', clearance) : '')
      + '</div>';
  }

  async function printResumeCart(){
    if(!resumeCart.length){ return; }
    var container = document.getElementById('print-resume-batch');
    container.innerHTML = '';
    for(var i = 0; i < resumeCart.length; i++){
      var rows = await dbRequest('resumes?id=eq.' + resumeCart[i] + '&select=*,profiles(full_name,job_title,clearance_level,clearance_investigation_type,clearance_expiration_date)');
      if(rows.length){
        container.insertAdjacentHTML('beforeend', printableResumeHtml(rows[0], rows[0].profiles || {}));
      }
    }
    window.print();
  }

  function switchProfileSubtab(name){
    document.querySelectorAll('#screen-profile .prof-subscreen').forEach(function(s){ s.classList.remove('active'); });
    document.querySelectorAll('#screen-profile [data-profsubtab]').forEach(function(b){ b.classList.toggle('active', b.dataset.profsubtab === name); });
    document.getElementById('prof-' + name).classList.add('active');
    if(name === 'overview'){ loadProfile(); }
    if(name === 'resume'){
      loadResume(getSession().user.id);
    }
    if(name === 'assets'){ loadProfileAssets(); }
  }

  // ---------- Resume / Assets team panel (shared by My Team + Admin, scope param) ----------
  var teamDeptFilter = { admin: { resumes: '', assets: '' } };

  function resumeScopeIds(scope){
    return {
      searchInputId: scope === 'admin' ? 'resume-search-input' : null,
      searchResultsId: scope === 'admin' ? 'resume-search-results' : null,
      bannerId: scope + '-resume-viewing-banner',
      contentId: scope + '-resume-content'
    };
  }

  async function loadTeamResumes(scope){
    var ids = resumeScopeIds(scope);
    if(scope === 'admin'){
      document.getElementById(ids.searchInputId).value = '';
      document.getElementById(ids.searchResultsId).innerHTML = '';
      var clearBtn = document.getElementById('resume-search-clear-btn');
      if(clearBtn){ clearBtn.style.display = 'none'; }
    }
    document.getElementById(ids.bannerId).innerHTML = '';
    document.getElementById(ids.contentId).innerHTML = '';
    await renderTeamPanel('resumes', scope);
  }

  // Shared team-panel renderer: employee list (+ department filter, admin
  // scope only) used by My Team / Admin > Resumes and Assets, so both stay
  // consistent. scope is 'myteam' (recursive reports) or 'admin' (all
  // employees company-wide).
  async function renderTeamPanel(context, scope){
    var session = getSession();
    var filterWrapId = scope + '-' + context + '-dept-filter-wrap';
    var listId = scope + '-' + context + '-employee-list';
    var listEl = document.getElementById(listId);
    var filterWrap = document.getElementById(filterWrapId);

    var employeeIds;
    if(scope === 'admin'){
      if(filterWrap){
        var depts = await dbRequest('departments?order=sort_order.asc&select=id,name');
        var currentFilter = teamDeptFilter.admin[context] || '';
        filterWrap.innerHTML = '<select class="field-input" id="' + filterWrapId + '-select" onchange="teamDeptFilterChanged(\'' + context + '\',this.value)" style="margin-bottom:12px;">'
          + '<option value="" ' + (currentFilter === '' ? 'selected' : '') + '>All Divisions</option>'
          + depts.map(function(d){ return '<option value="' + d.id + '" ' + (currentFilter === d.id ? 'selected' : '') + '>' + d.name + '</option>'; }).join('')
          + '</select>';
      }
      var query = 'profiles?select=id,full_name,job_title&order=full_name.asc' + (teamDeptFilter.admin[context] ? '&department_id=eq.' + teamDeptFilter.admin[context] : '');
      var employees = await dbRequest(query);
      renderTeamPanelList(listEl, employees, context, scope);
      return;
    }

    if(filterWrap){ filterWrap.innerHTML = ''; }
    employeeIds = await getRecursiveReportIds(session.user.id);
    var teamEmployees = employeeIds.length
      ? await dbRequest('profiles?id=in.(' + employeeIds.join(',') + ')&select=id,full_name,job_title&order=full_name.asc')
      : [];
    renderTeamPanelList(listEl, teamEmployees, context, scope);
  }

  function renderTeamPanelList(listEl, employees, context, scope){
    if(!employees.length){
      listEl.innerHTML = '<div class="tk-empty">No employees found.</div>';
      return;
    }
    listEl.innerHTML = employees.map(function(e){
      var action = context === 'resumes'
        ? 'selectTeamResumeEmployee(\'' + scope + '\',\'' + e.id + '\')'
        : 'teamViewEmployeeAssets(\'' + scope + '\',\'' + e.id + '\')';
      return '<div class="news-item" onclick="' + action + '"><div class="news-item-title">' + (e.full_name||'Unknown') + '</div><div class="news-item-date">' + (e.job_title||'—') + '</div></div>';
    }).join('');
  }

  // Selecting an employee from the My Team/Admin resume panel collapses the
  // panel to a narrow strip (with a Clear Selection button to reopen it)
  // and scrolls the resume into view, so reviewers don't have to scroll
  // past a long employee list to see what they just picked.
  function selectTeamResumeEmployee(scope, employeeId){
    requestViewResume(employeeId);
    var panel = document.getElementById(scope + '-resumes-team-panel');
    if(panel){ panel.classList.add('team-panel-collapsed'); }
    var ctx = getActiveResumeContext();
    var contentEl = document.getElementById(ctx.containerId);
    if(contentEl){ contentEl.scrollIntoView({ behavior: 'smooth', block: 'start' }); }
  }

  function clearTeamResumeSelection(scope){
    var panel = document.getElementById(scope + '-resumes-team-panel');
    if(!panel){ return; }
    panel.classList.remove('team-panel-collapsed');
    panel.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function teamDeptFilterChanged(context, deptId){
    teamDeptFilter.admin[context] = deptId;
    renderTeamPanel(context, 'admin');
  }

  // ---------- Asset Tracker ----------
  var ASSET_CONDITIONS = ['excellent','good','fair','needs_repair','poor'];
  var ASSET_CONDITION_LABELS = { excellent:'Excellent', good:'Good', fair:'Fair', needs_repair:'Needs Repair', poor:'Poor' };

  function assetFieldRow(label, value){
    return '<div class="asset-field"><div class="asset-field-label">' + label + '</div><div class="asset-field-val">' + (value || '—') + '</div></div>';
  }

  // ---- Profile → Assets (employee, read-only) ----
  async function loadProfileAssets(){
    var container = document.getElementById('profile-assets-content');
    var session = getSession();
    if(!session || !session.user){ return; }

    try{
      var rows = await dbRequest('assets?assigned_to=eq.' + session.user.id + '&order=issued_date.desc&select=*');
      var assetsHtml = rows.length
        ? rows.map(function(a){
            return '<div class="tk-entry-card">'
              + (a.photo_url ? '<img src="' + a.photo_url + '" class="asset-photo" alt="">' : '')
              + '<div class="asset-grid">'
              + assetFieldRow('Asset Name', a.asset_name)
              + assetFieldRow('Type', a.asset_type)
              + assetFieldRow('Serial Number', a.serial_number)
              + assetFieldRow('Vendor', a.vendor)
              + assetFieldRow('Model', a.model)
              + assetFieldRow('Condition', ASSET_CONDITION_LABELS[a.condition] || a.condition)
              + assetFieldRow('Issued Date', a.issued_date ? formatDate(a.issued_date) : '—')
              + assetFieldRow('Returned Date', a.returned_date ? formatDate(a.returned_date) : '—')
              + assetFieldRow('Notes', a.notes)
              + '</div>'
              + '</div>';
          }).join('')
        : '<div class="tk-empty">No equipment currently assigned to you.</div>';

      var requestRows = await dbRequest('asset_requests?requested_by=eq.' + session.user.id + '&order=created_at.desc&select=id,asset_name,status,created_at');
      var requestLogHtml = requestRows.length
        ? '<table class="tk-grid-table"><thead><tr><th>Submitted</th><th>Asset</th><th>Status</th></tr></thead><tbody>'
          + requestRows.map(function(r){
              return '<tr><td>' + formatDate(r.created_at.slice(0,10)) + '</td><td>' + r.asset_name + '</td><td>' + tkStatusPill(r.status) + '</td></tr>';
            }).join('')
          + '</tbody></table>'
        : '<div class="tk-empty">No equipment requests submitted.</div>';

      container.innerHTML = '<div class="tk-entry-card">'
        + '<div class="tk-section-title">My Equipment</div>'
        + '</div>'
        + assetsHtml
        + '<div class="tk-entry-card">'
        + '<div class="tk-section-title">Request Equipment</div>'
        + '<div class="placeholder-sub" style="margin-bottom:12px;">Use this if you were issued equipment by an outside party, or were approved to purchase your own — enter the details below for manager approval.</div>'
        + '<button class="btn-edit" onclick="showAssetRequestForm()">New Equipment Request</button>'
        + '<div id="asset-request-form-wrap"></div>'
        + '</div>'
        + '<div class="tk-entry-card">'
        + '<div class="tk-section-title">My Equipment Requests</div>'
        + requestLogHtml
        + '</div>';
    }catch(e){
      container.innerHTML = '<div class="placeholder-card"><div class="placeholder-title">Couldn\'t load assets</div><div class="placeholder-sub">Try refreshing the page.</div></div>';
      console.error(e);
    }
  }

  function showAssetRequestForm(){
    var wrap = document.getElementById('asset-request-form-wrap');
    wrap.innerHTML = '<div class="myteam-return-box" style="margin-top:14px;">'
      + '<div class="asset-form-grid">'
      + '<div><label class="field-label">Asset Name</label><input type="text" id="ar-name" class="field-input"></div>'
      + '<div><label class="field-label">Asset Type</label><input type="text" id="ar-type" class="field-input"></div>'
      + '<div><label class="field-label">Serial Number</label><input type="text" id="ar-serial" class="field-input"></div>'
      + '<div><label class="field-label">Vendor</label><input type="text" id="ar-vendor" class="field-input"></div>'
      + '<div><label class="field-label">Model</label><input type="text" id="ar-model" class="field-input"></div>'
      + '<div><label class="field-label">Condition</label><select id="ar-condition" class="field-input">'
      + ASSET_CONDITIONS.map(function(c){ return '<option value="' + c + '">' + ASSET_CONDITION_LABELS[c] + '</option>'; }).join('')
      + '</select></div>'
      + '<div><label class="field-label">Issued By (external party)</label><input type="text" id="ar-issuedby" class="field-input" placeholder="e.g. agency, vendor, government office"></div>'
      + '<div><label class="field-label">Issued Date</label><input type="date" id="ar-issueddate" class="field-input"></div>'
      + '<div><label class="field-label">Purchased From</label><input type="text" id="ar-purchasedfrom" class="field-input"></div>'
      + '<div><label class="field-label">Purchase Price</label><input type="text" inputmode="decimal" id="ar-price" class="field-input"></div>'
      + '<div><label class="field-label">Purchase Date</label><input type="date" id="ar-purchasedate" class="field-input"></div>'
      + '<div><label class="field-label">Warranty Expiry</label><input type="date" id="ar-warranty" class="field-input"></div>'
      + '<div><label class="field-label">Photo URL</label><input type="text" id="ar-photo" class="field-input" placeholder="Link to a photo (upload coming soon)"></div>'
      + '</div>'
      + '<div style="margin-top:10px;"><label class="field-label">Notes</label><input type="text" id="ar-notes" class="field-input"></div>'
      + '<div style="display:flex;gap:10px;margin-top:10px;">'
      + '<button class="btn btn-primary" style="width:auto;padding:11px 20px;" onclick="submitAssetRequest(\'pending\')">Submit Request</button>'
      + '<button class="btn-cancel" onclick="submitAssetRequest(\'draft\')">Save as Draft</button>'
      + '<button class="btn-cancel" onclick="document.getElementById(\'asset-request-form-wrap\').innerHTML=\'\'">Cancel</button>'
      + '</div>'
      + '<div class="login-error" id="asset-request-error"></div>'
      + '</div>';
  }

  async function submitAssetRequest(targetStatus){
    var errorEl = document.getElementById('asset-request-error');
    var session = getSession();
    var name = document.getElementById('ar-name').value;
    if(!name){
      errorEl.textContent = 'Asset name is required.';
      return;
    }
    try{
      await dbWrite('asset_requests', 'POST', {
        requested_by: session.user.id,
        asset_name: name,
        asset_type: document.getElementById('ar-type').value || null,
        serial_number: document.getElementById('ar-serial').value || null,
        vendor: document.getElementById('ar-vendor').value || null,
        model: document.getElementById('ar-model').value || null,
        condition: document.getElementById('ar-condition').value,
        issued_by_external: document.getElementById('ar-issuedby').value || null,
        issued_date: document.getElementById('ar-issueddate').value || null,
        purchased_from: document.getElementById('ar-purchasedfrom').value || null,
        purchase_price: document.getElementById('ar-price').value ? parseFloat(document.getElementById('ar-price').value) : null,
        purchase_date: document.getElementById('ar-purchasedate').value || null,
        warranty_expiry: document.getElementById('ar-warranty').value || null,
        photo_url: document.getElementById('ar-photo').value || null,
        notes: document.getElementById('ar-notes').value || null,
        status: targetStatus
      });
      loadProfileAssets();
    }catch(e){
      errorEl.textContent = 'Could not submit request — try again.';
      console.error(e);
    }
  }

  // ---- Admin → Assets (manager issue/edit, employee-navigable like My Team) ----
  var assetTeamReports = { admin: [], myteam: [] };
  var assetTeamIndex = { admin: 0, myteam: 0 };

  function assetScopeIds(scope){
    return {
      contentId: scope + '-assets-content',
      teamPanelId: scope + '-assets-team-panel',
      listId: scope + '-assets-employee-list',
      searchInputId: (scope === 'admin' ? 'asset-search-input' : 'myteam-asset-search-input'),
      searchResultsId: (scope === 'admin' ? 'asset-search-results' : 'myteam-asset-search-results'),
      exportEmpId: (scope === 'admin' ? 'asset-export-employees' : 'myteam-asset-export-employees'),
      exportTypeId: (scope === 'admin' ? 'asset-export-types' : 'myteam-asset-export-types'),
      exportMsgId: (scope === 'admin' ? 'asset-export-message' : 'myteam-asset-export-message')
    };
  }

  async function loadTeamAssets(scope){
    var ids = assetScopeIds(scope);
    var session = getSession();
    if(!session || !session.user){ return; }

    var teamPanel = document.getElementById(ids.teamPanelId);
    var container = document.getElementById(ids.contentId);

    try{
      var employeeIds = scope === 'admin'
        ? (await dbRequest('profiles?id=neq.' + session.user.id + '&select=id')).map(function(r){ return r.id; })
        : await getRecursiveReportIds(session.user.id);
      assetTeamReports[scope] = employeeIds.length
        ? await dbRequest('profiles?id=in.(' + employeeIds.join(',') + ')&select=id,full_name,job_title&order=full_name.asc')
        : [];

      await renderTeamPanel('assets', scope);
      await populateAssetExportDropdowns(scope);
      document.getElementById(ids.searchInputId).value = '';
      document.getElementById(ids.searchResultsId).innerHTML = '';

      // No employee pre-selected on load — roster stays visible until
      // someone is clicked; card area shows pending requests (if any)
      // plus a prompt rather than auto-loading the first employee.
      assetTeamIndex[scope] = -1;
      teamPanel.style.display = '';

      var pendingHtml = await renderPendingAssetRequests(scope);
      container.innerHTML = pendingHtml;
    }catch(e){
      container.innerHTML = '<div class="placeholder-card"><div class="placeholder-title">Couldn\'t load assets</div><div class="placeholder-sub">Try refreshing the page.</div></div>';
      console.error(e);
    }
  }

  // Pending equipment requests are team-wide, not tied to whichever
  // employee card is open, so they're rendered separately and stay
  // visible whether or not a card is showing.
  async function renderPendingAssetRequests(scope){
    var reportIds = assetTeamReports[scope].map(function(r){ return r.id; });
    if(!reportIds.length){ return ''; }
    var pendingRequests = await dbRequest('asset_requests?requested_by=in.(' + reportIds.join(',') + ')&status=eq.pending&select=*,profiles!asset_requests_requested_by_fkey(full_name)');
    if(!pendingRequests.length){ return ''; }
    return '<div class="tk-section-title">Asset Requests</div>' + pendingRequests.map(function(r){
      return '<div class="tk-entry-card">'
        + '<div class="myteam-employee-header"><div class="myteam-employee-name">' + (r.profiles ? r.profiles.full_name : 'Unknown') + '</div>'
        + '<div class="myteam-employee-title">Requested: ' + r.asset_name + '</div></div>'
        + '<div class="asset-grid">'
        + assetFieldRow('Type', r.asset_type)
        + assetFieldRow('Serial Number', r.serial_number)
        + assetFieldRow('Vendor', r.vendor)
        + assetFieldRow('Issued By', r.issued_by_external)
        + assetFieldRow('Purchased From', r.purchased_from)
        + assetFieldRow('Purchase Price', r.purchase_price ? '$' + r.purchase_price : '—')
        + '</div>'
        + '<div class="tk-grid-actions">'
        + '<button class="btn-logout" style="width:auto;" onclick="reviewAssetRequest(\'' + r.id + '\',\'rejected\',\'' + scope + '\')">Reject</button>'
        + '<button class="btn btn-primary" style="width:auto;padding:11px 20px;" onclick="reviewAssetRequest(\'' + r.id + '\',\'approved\',\'' + scope + '\')">Approve &amp; Add to Assets</button>'
        + '</div>'
        + '</div>';
    }).join('');
  }

  async function showTeamEmployeeAssets(scope, employeeId){
    var ids = assetScopeIds(scope);
    var idx = assetTeamReports[scope].findIndex(function(r){ return r.id === employeeId; });
    if(idx === -1){ return; } // employee isn't in the current set
    assetTeamIndex[scope] = idx;

    var teamPanel = document.getElementById(ids.teamPanelId);
    var container = document.getElementById(ids.contentId);
    teamPanel.style.display = 'none';

    var pendingHtml = await renderPendingAssetRequests(scope);
    container.innerHTML = pendingHtml + '<div class="placeholder-card"><div class="placeholder-sub">Loading...</div></div>';

    var cardHtml = await assetTeamRenderEmployeeCard(assetTeamReports[scope][idx], scope);
    container.innerHTML = pendingHtml + cardHtml;
  }

  function cancelTeamEmployeeAssets(scope){
    var ids = assetScopeIds(scope);
    assetTeamIndex[scope] = -1;
    document.getElementById(ids.teamPanelId).style.display = '';
    renderPendingAssetRequests(scope).then(function(pendingHtml){
      document.getElementById(ids.contentId).innerHTML = pendingHtml;
    });
  }

  function teamViewEmployeeAssets(scope, employeeId){
    showTeamEmployeeAssets(scope, employeeId);
  }

  async function populateAssetExportDropdowns(scope){
    var ids = assetScopeIds(scope);
    var empSelect = document.getElementById(ids.exportEmpId);
    var typeSelect = document.getElementById(ids.exportTypeId);
    empSelect.innerHTML = assetTeamReports[scope].map(function(r){ return '<option value="' + r.id + '">' + (r.full_name||'Unknown') + '</option>'; }).join('');

    var reportIds = assetTeamReports[scope].map(function(r){ return r.id; });
    var typesHtml = '<div class="tk-empty">No equipment on file.</div>';
    if(reportIds.length){
      var assetRows = await dbRequest('assets?assigned_to=in.(' + reportIds.join(',') + ')&select=asset_type');
      var uniqueTypes = Array.from(new Set(assetRows.map(function(a){ return a.asset_type; }).filter(Boolean)));
      typeSelect.innerHTML = uniqueTypes.length
        ? uniqueTypes.map(function(t){ return '<option value="' + t + '">' + t + '</option>'; }).join('')
        : '<option disabled>No asset types on file</option>';
    }
  }

  var assetSearchDebounce = null;
  function debounceSearchAssets(scope){
    clearTimeout(assetSearchDebounce);
    assetSearchDebounce = setTimeout(function(){ searchAssets(scope); }, 250);
  }

  async function searchAssets(scope){
    var ids = assetScopeIds(scope);
    var q = document.getElementById(ids.searchInputId).value.trim().toLowerCase();
    var resultsEl = document.getElementById(ids.searchResultsId);
    if(!q){ resultsEl.innerHTML = ''; return; }
    resultsEl.innerHTML = '<div class="tk-empty">Searching...</div>';
    try{
      var reportIds = assetTeamReports[scope].map(function(r){ return r.id; });
      if(!reportIds.length){ resultsEl.innerHTML = '<div class="tk-empty">No employees in your team.</div>'; return; }
      var rows = await dbRequest('assets?assigned_to=in.(' + reportIds.join(',') + ')&select=*,profiles!assets_assigned_to_fkey(full_name)');
      var nameById = {};
      assetTeamReports[scope].forEach(function(r){ nameById[r.id] = r.full_name; });

      var matches = rows.filter(function(a){
        var haystack = [
          a.asset_name, a.asset_type, a.serial_number, a.vendor, a.model,
          a.notes, a.purchased_from, a.location, a.department,
          nameById[a.assigned_to]
        ].filter(Boolean).join(' ').toLowerCase();
        return haystack.indexOf(q) !== -1;
      });

      resultsEl.innerHTML = matches.length
        ? '<table class="tk-grid-table"><thead><tr><th>Employee</th><th>Asset</th><th>Type</th><th>Serial</th><th>Condition</th></tr></thead><tbody>'
          + matches.map(function(a){
              return '<tr><td>' + (nameById[a.assigned_to]||'Unknown') + '</td><td>' + a.asset_name + '</td><td>' + (a.asset_type||'—') + '</td><td>' + (a.serial_number||'—') + '</td><td>' + (ASSET_CONDITION_LABELS[a.condition]||a.condition||'—') + '</td></tr>';
            }).join('')
          + '</tbody></table>'
        : '<div class="tk-empty">No matches.</div>';
    }catch(e){
      resultsEl.innerHTML = '<div class="tk-empty">Search failed.</div>';
      console.error(e);
    }
  }

  function csvEscape(val){
    if(val == null){ return ''; }
    var s = String(val);
    if(s.indexOf(',') !== -1 || s.indexOf('"') !== -1 || s.indexOf('\n') !== -1){
      return '"' + s.replace(/"/g, '""') + '"';
    }
    return s;
  }

  async function exportAssetsToCsv(scope){
    var ids = assetScopeIds(scope);
    var empSelect = document.getElementById(ids.exportEmpId);
    var typeSelect = document.getElementById(ids.exportTypeId);
    var selectedEmployees = Array.from(empSelect.selectedOptions).map(function(o){ return o.value; });
    var selectedTypes = Array.from(typeSelect.selectedOptions).map(function(o){ return o.value; });
    var msgEl = document.getElementById(ids.exportMsgId);

    if(!selectedEmployees.length){
      msgEl.textContent = 'Select at least one employee.';
      return;
    }
    msgEl.textContent = '';

    try{
      var query = 'assets?assigned_to=in.(' + selectedEmployees.join(',') + ')&select=*,profiles!assets_assigned_to_fkey(full_name)';
      var rows = await dbRequest(query);
      if(selectedTypes.length){
        rows = rows.filter(function(a){ return selectedTypes.indexOf(a.asset_type) !== -1; });
      }

      if(!rows.length){
        msgEl.textContent = 'No matching equipment found for that selection.';
        return;
      }

      var headers = ['Employee','Asset Name','Asset Type','Serial Number','Vendor','Model','Condition','Issued Date','Returned Date','Purchase Date','Warranty Expiry','Purchased From','Purchase Price','Notes'];
      var lines = [headers.join(',')];
      rows.forEach(function(a){
        lines.push([
          csvEscape(a.profiles ? a.profiles.full_name : ''),
          csvEscape(a.asset_name),
          csvEscape(a.asset_type),
          csvEscape(a.serial_number),
          csvEscape(a.vendor),
          csvEscape(a.model),
          csvEscape(ASSET_CONDITION_LABELS[a.condition] || a.condition),
          csvEscape(a.issued_date),
          csvEscape(a.returned_date),
          csvEscape(a.purchase_date),
          csvEscape(a.warranty_expiry),
          csvEscape(a.purchased_from),
          csvEscape(a.purchase_price),
          csvEscape(a.notes)
        ].join(','));
      });

      var csvContent = lines.join('\n');
      var blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
      var url = URL.createObjectURL(blob);
      var a = document.createElement('a');
      a.href = url;
      a.download = 'equipment_export_' + new Date().toISOString().slice(0,10) + '.csv';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      msgEl.style.color = 'var(--teal)';
      msgEl.textContent = 'Exported ' + rows.length + ' record' + (rows.length===1?'':'s') + '.';
    }catch(e){
      console.error(e);
      msgEl.style.color = 'var(--red)';
      msgEl.textContent = 'Export failed — try again.';
    }
  }

  async function assetTeamRenderEmployeeCard(employee, scope){
    var rows = await dbRequest('assets?assigned_to=eq.' + employee.id + '&order=issued_date.desc&select=*');
    var rowsHtml = rows.length
      ? rows.map(function(a){
          return '<div class="tk-entry-card" style="margin-bottom:14px;">'
            + (a.photo_url ? '<img src="' + a.photo_url + '" class="asset-photo" alt="">' : '')
            + '<div class="asset-grid">'
            + assetFieldRow('Asset Name', a.asset_name)
            + assetFieldRow('Type', a.asset_type)
            + assetFieldRow('Serial Number', a.serial_number)
            + assetFieldRow('Vendor', a.vendor)
            + assetFieldRow('Model', a.model)
            + assetFieldRow('Purchase Date', a.purchase_date ? formatDate(a.purchase_date) : '—')
            + assetFieldRow('Warranty Expiry', a.warranty_expiry ? formatDate(a.warranty_expiry) : '—')
            + assetFieldRow('Purchased From', a.purchased_from)
            + assetFieldRow('Purchase Price', a.purchase_price ? '$' + a.purchase_price : '—')
            + assetFieldRow('Issued By', '—')
            + assetFieldRow('Issued Date', a.issued_date ? formatDate(a.issued_date) : '—')
            + assetFieldRow('Returned Date', a.returned_date ? formatDate(a.returned_date) : '—')
            + assetFieldRow('Notes', a.notes)
            + '<div><div class="asset-field-label">Condition</div><select class="field-input" id="asset-cond-' + a.id + '" onchange="updateAssetField(\'' + a.id + '\',\'condition\',this.value)">'
            + ASSET_CONDITIONS.map(function(c){ return '<option value="' + c + '"' + (c===a.condition?' selected':'') + '>' + ASSET_CONDITION_LABELS[c] + '</option>'; }).join('')
            + '</select></div>'
            + '</div>'
            + '</div>';
        }).join('')
      : '<div class="tk-empty">No equipment currently assigned.</div>';

    return '<div class="tk-entry-card">'
      + '<div class="myteam-employee-header"><div class="myteam-employee-name">' + (employee.full_name || 'Unknown') + '</div>'
      + '<div class="myteam-employee-title">' + (employee.job_title || '—') + '</div></div>'
      + rowsHtml
      + '<div class="tk-grid-actions" style="margin-top:10px;">'
      + '<button class="btn-logout" style="width:auto;" onclick="cancelTeamEmployeeAssets(\'' + scope + '\')">Cancel</button>'
      + '<button class="btn-edit" style="width:auto;" onclick="exportEmployeeAssetsToCsv(\'' + employee.id + '\',\'' + (employee.full_name||'Unknown').replace(/'/g, "\\'") + '\')">Export to CSV</button>'
      + '<button class="btn btn-primary" style="width:auto;padding:11px 20px;" onclick="showIssueAssetForm(\'' + employee.id + '\',\'' + scope + '\')">Issue New Equipment</button>'
      + '</div>'
      + '<div id="issue-asset-form-wrap"></div>'
      + '</div>';
  }

  async function exportEmployeeAssetsToCsv(employeeId, employeeName){
    try{
      var rows = await dbRequest('assets?assigned_to=eq.' + employeeId + '&order=issued_date.desc&select=*');
      if(!rows.length){ return; }
      var headers = ['Asset Name','Asset Type','Serial Number','Vendor','Model','Condition','Issued Date','Returned Date','Purchase Date','Warranty Expiry','Purchased From','Purchase Price','Notes'];
      var lines = [headers.join(',')];
      rows.forEach(function(a){
        lines.push([
          csvEscape(a.asset_name),
          csvEscape(a.asset_type),
          csvEscape(a.serial_number),
          csvEscape(a.vendor),
          csvEscape(a.model),
          csvEscape(ASSET_CONDITION_LABELS[a.condition] || a.condition),
          csvEscape(a.issued_date),
          csvEscape(a.returned_date),
          csvEscape(a.purchase_date),
          csvEscape(a.warranty_expiry),
          csvEscape(a.purchased_from),
          csvEscape(a.purchase_price),
          csvEscape(a.notes)
        ].join(','));
      });
      var csvContent = lines.join('\n');
      var blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
      var url = URL.createObjectURL(blob);
      var a = document.createElement('a');
      a.href = url;
      a.download = (employeeName || 'employee').replace(/\s+/g, '_') + '_equipment_' + new Date().toISOString().slice(0,10) + '.csv';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    }catch(e){
      console.error(e);
    }
  }

  function showIssueAssetForm(employeeId, scope){
    var wrap = document.getElementById('issue-asset-form-wrap');
    wrap.innerHTML = '<div class="myteam-return-box" style="margin-top:14px;">'
      + '<div class="asset-form-grid">'
      + '<div><label class="field-label">Asset Name</label><input type="text" id="ia-name" class="field-input"></div>'
      + '<div><label class="field-label">Asset Type</label><input type="text" id="ia-type" class="field-input"></div>'
      + '<div><label class="field-label">Serial Number</label><input type="text" id="ia-serial" class="field-input"></div>'
      + '<div><label class="field-label">Vendor</label><input type="text" id="ia-vendor" class="field-input"></div>'
      + '<div><label class="field-label">Model</label><input type="text" id="ia-model" class="field-input"></div>'
      + '<div><label class="field-label">Condition</label><select id="ia-condition" class="field-input">'
      + ASSET_CONDITIONS.map(function(c){ return '<option value="' + c + '">' + ASSET_CONDITION_LABELS[c] + '</option>'; }).join('')
      + '</select></div>'
      + '<div><label class="field-label">Issued Date</label><input type="date" id="ia-issueddate" class="field-input"></div>'
      + '<div><label class="field-label">Purchased From</label><input type="text" id="ia-purchasedfrom" class="field-input"></div>'
      + '<div><label class="field-label">Purchase Price</label><input type="text" inputmode="decimal" id="ia-price" class="field-input"></div>'
      + '<div><label class="field-label">Purchase Date</label><input type="date" id="ia-purchasedate" class="field-input"></div>'
      + '<div><label class="field-label">Warranty Expiry</label><input type="date" id="ia-warranty" class="field-input"></div>'
      + '<div><label class="field-label">Photo URL</label><input type="text" id="ia-photo" class="field-input" placeholder="Link to a photo (upload coming soon)"></div>'
      + '</div>'
      + '<div style="margin-top:10px;"><label class="field-label">Notes</label><input type="text" id="ia-notes" class="field-input"></div>'
      + '<button class="btn btn-primary" style="width:auto;padding:11px 20px;margin-top:10px;" onclick="submitIssueAsset(\'' + employeeId + '\',\'' + scope + '\')">Issue Equipment</button>'
      + '<div class="login-error" id="issue-asset-error"></div>'
      + '</div>';
  }

  async function submitIssueAsset(employeeId, scope){
    var errorEl = document.getElementById('issue-asset-error');
    var session = getSession();
    var name = document.getElementById('ia-name').value;
    if(!name){
      errorEl.textContent = 'Asset name is required.';
      return;
    }
    try{
      await dbWrite('assets', 'POST', {
        assigned_to: employeeId,
        asset_name: name,
        asset_type: document.getElementById('ia-type').value || null,
        serial_number: document.getElementById('ia-serial').value || null,
        vendor: document.getElementById('ia-vendor').value || null,
        model: document.getElementById('ia-model').value || null,
        condition: document.getElementById('ia-condition').value,
        issued_by: session.user.id,
        issued_date: document.getElementById('ia-issueddate').value || null,
        purchased_from: document.getElementById('ia-purchasedfrom').value || null,
        purchase_price: document.getElementById('ia-price').value ? parseFloat(document.getElementById('ia-price').value) : null,
        purchase_date: document.getElementById('ia-purchasedate').value || null,
        warranty_expiry: document.getElementById('ia-warranty').value || null,
        photo_url: document.getElementById('ia-photo').value || null,
        notes: document.getElementById('ia-notes').value || null
      });
      showTeamEmployeeAssets(scope, employeeId);
    }catch(e){
      errorEl.textContent = 'Could not issue equipment — try again.';
      console.error(e);
    }
  }

  async function updateAssetField(assetId, field, value){
    try{
      var body = {};
      body[field] = value;
      await dbWrite('assets?id=eq.' + assetId, 'PATCH', body);
    }catch(e){ console.error(e); }
  }

  async function reviewAssetRequest(requestId, decision, scope){
    var session = getSession();
    try{
      var rows = await dbRequest('asset_requests?id=eq.' + requestId + '&select=*');
      if(!rows.length){ return; }
      var r = rows[0];

      if(decision === 'approved'){
        await dbWrite('assets', 'POST', {
          assigned_to: r.requested_by,
          asset_name: r.asset_name,
          asset_type: r.asset_type,
          serial_number: r.serial_number,
          vendor: r.vendor,
          model: r.model,
          condition: r.condition,
          issued_by: session.user.id,
          issued_date: r.issued_date,
          purchased_from: r.purchased_from,
          purchase_price: r.purchase_price,
          purchase_date: r.purchase_date,
          warranty_expiry: r.warranty_expiry,
          photo_url: r.photo_url,
          notes: r.notes
        });
      }

      await dbWrite('asset_requests?id=eq.' + requestId, 'PATCH', {
        status: decision,
        reviewed_by: session.user.id,
        reviewed_at: new Date().toISOString()
      });
      loadTeamAssets(scope);
    }catch(e){
      console.error(e);
    }
  }
