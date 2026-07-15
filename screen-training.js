/* COA Employee Portal — screen-training.js
   Training screen. Currently a placeholder shell (subtab switching only) —
   no data-loading logic exists yet in the source; this file is a stub ready
   for that build-out. */

  function switchTrainingSubtab(name){
    document.querySelectorAll('.subtab-btn').forEach(function(b){ b.classList.toggle('active', b.dataset.subtab === name); });
    document.querySelectorAll('.training-subscreen').forEach(function(s){ s.classList.remove('active'); });
    document.getElementById('training-' + name).classList.add('active');
  }
