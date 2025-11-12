'use strict';

/* ---------- storage (same robust wrapper) ---------- */
const storage = {
  save: (key,data) => {
    try { localStorage.setItem(key, JSON.stringify(data)); return true; }
    catch(e) { console.error('Storage save failed', e); return false; }
  },
  load: (key, def) => {
    try { const v = localStorage.getItem(key); return v ? JSON.parse(v) : def; }
    catch(e) { return def; }
  }
};

/* ---------- constants & state ---------- */
const LOOPS = ['out','in_weekday','in_weekend'];
let swReg = null;
let audioContext = null;

const defaultLibrary = [
  { id: 1, name: 'Coding', note: 'Deep work block', defaultAllocated: 90 },
  { id: 2, name: 'Exercise', note: 'Quick workout / stretch', defaultAllocated: 30 },
  { id: 3, name: 'Reading', note: 'Reading / learning', defaultAllocated: 45 }
];

const appState = {
  library: [],
  loops: { out: [], in_weekday: [], in_weekend: [] },
  timers: {
    out: { activeTaskId:null, timerStartTime:null, isTimerRunning:false, timerInterval:null },
    in_weekday: { activeTaskId:null, timerStartTime:null, isTimerRunning:false, timerInterval:null },
    in_weekend: { activeTaskId:null, timerStartTime:null, isTimerRunning:false, timerInterval:null }
  },
  activeMode: 'in', // 'in' | 'out'
  currentManageTab: 'library',
  isRendering: false,
  activeLoopId: 'in_weekday' // derived
};

/* ---------- util helpers ---------- */
function uid(){ return Date.now() + Math.floor(Math.random()*1000); }
function escapeHtml(t){ const map={'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}; return String(t).replace(/[&<>"']/g,m=>map[m]); }
function formatTime(minutes){ if (isNaN(minutes)) return '0m'; const hrs = Math.floor(minutes/60); const mins = Math.floor(minutes%60); return hrs>0?`${hrs}h ${mins}m`:`${mins}m`; }
function isWeekendDate(d){ const day = d.getDay(); return day===0 || day===6; }
function getActiveLoopId(){ if (appState.activeMode === 'out') return 'out'; return isWeekendDate(new Date()) ? 'in_weekend' : 'in_weekday'; }

/* ---------- PWA / SW / sound ---------- */
async function registerSW(){
  if ('serviceWorker' in navigator){
    try{
      swReg = await navigator.serviceWorker.register('sw.js');
      await navigator.serviceWorker.ready;
      navigator.serviceWorker.addEventListener('message', e => {
        if (e.data && e.data.type === 'TASK_COMPLETE') playLocalSound();
      });
      if (Notification.permission === 'default') Notification.requestPermission();
    } catch(err){ console.warn('sw register failed', err); }
  }
}

function scheduleSWAlarm(taskName, remainingMinutes, loopId){
  if (!swReg) return;
  const worker = swReg.active || swReg.waiting || swReg.installing;
  if (!worker) return;
  const delayMs = Math.max(1000, Math.round(remainingMinutes*60*1000));
  worker.postMessage({ type:'SCHEDULE_ALARM', taskName, delay: delayMs, loopId });
}
function cancelSWAlarm(){ if (!swReg || !swReg.active) return; swReg.active.postMessage({ type:'CANCEL_ALARM' }); }

function playLocalSound(){
  try{
    if (!audioContext) audioContext = new (window.AudioContext || window.webkitAudioContext)();
    if (audioContext.state === 'suspended') audioContext.resume();
    const now = audioContext.currentTime;
    function beep(start,f,dur){ const o=audioContext.createOscillator(), g=audioContext.createGain(); o.connect(g); g.connect(audioContext.destination); o.frequency.value = f; o.type = 'sine'; g.gain.setValueAtTime(1,start); g.gain.exponentialRampToValueAtTime(0.01, start+dur); o.start(start); o.stop(start+dur); }
    beep(now,600,0.35); beep(now+0.45,800,0.35); beep(now+0.9,1000,0.35);
    if (navigator.vibrate) navigator.vibrate([200,120,200]);
  } catch(e){ console.warn('sound err', e); }
}

/* ---------- persist/load ---------- */
function persistAll(){
  try {
    const toSave = {
      library: appState.library,
      loops: appState.loops,
      timers: {
        out: { activeTaskId: appState.timers.out.activeTaskId, timerStartTime: appState.timers.out.timerStartTime, isTimerRunning: appState.timers.out.isTimerRunning },
        in_weekday: { activeTaskId: appState.timers.in_weekday.activeTaskId, timerStartTime: appState.timers.in_weekday.timerStartTime, isTimerRunning: appState.timers.in_weekday.isTimerRunning },
        in_weekend: { activeTaskId: appState.timers.in_weekend.activeTaskId, timerStartTime: appState.timers.in_weekend.timerStartTime, isTimerRunning: appState.timers.in_weekend.isTimerRunning }
      },
      activeMode: appState.activeMode
    };
    storage.save('focus_v2', toSave);
  } catch(e){ console.warn('persist failed', e); }
}

function loadAll(){
  const saved = storage.load('focus_v2', null);
  if (!saved) {
    appState.library = defaultLibrary.map(t => ({...t}));
    appState.loops.out = [{ taskId:2, allocated:30, completed:0, order:0 }];
    appState.loops.in_weekday = defaultLibrary.map((t,i)=>({ taskId:t.id, allocated:t.defaultAllocated, completed:0, order:i }));
    appState.loops.in_weekend = defaultLibrary.map((t,i)=>({ taskId:t.id, allocated: Math.round(t.defaultAllocated*0.66), completed:0, order:i }));
    appState.activeMode = 'in';
    persistAll();
    return;
  }
  appState.library = Array.isArray(saved.library) ? saved.library : defaultLibrary;
  LOOPS.forEach(l => appState.loops[l] = Array.isArray(saved.loops && saved.loops[l]) ? saved.loops[l] : []);
  ['out','in_weekday','in_weekend'].forEach(k => {
    const t = (saved.timers && saved.timers[k]) || {};
    appState.timers[k].activeTaskId = t.activeTaskId || null;
    appState.timers[k].timerStartTime = t.timerStartTime || null;
    appState.timers[k].isTimerRunning = !!t.isTimerRunning;
  });
  appState.activeMode = saved.activeMode || 'in';
}

/* ---------- library CRUD ---------- */
function addLibraryTask(name, defaultAllocated, note){
  if (!name || !name.trim()) { alert('Task name required'); return false; }
  const id = uid();
  appState.library.push({ id, name: name.trim(), note: note || '', defaultAllocated: parseFloat(defaultAllocated) || 30 });
  persistAll(); render();
  return true;
}
function updateLibraryTask(id, name, defaultAllocated, note){
  const idx = appState.library.findIndex(t => t.id === id);
  if (idx === -1) return;
  appState.library[idx].name = name.trim();
  appState.library[idx].defaultAllocated = parseFloat(defaultAllocated) || appState.library[idx].defaultAllocated;
  appState.library[idx].note = note || '';
  persistAll(); render();
}
function deleteLibraryTask(id){
  if (!confirm('Delete task from library? This removes it from all loops.')) return;
  LOOPS.forEach(loop => appState.loops[loop] = appState.loops[loop].filter(e => e.taskId !== id));
  appState.library = appState.library.filter(t => t.id !== id);
  LOOPS.forEach(loop => {
    if (appState.timers[loop].activeTaskId === id) {
      stopTimerForLoop(loop);
      appState.timers[loop].activeTaskId = null;
      appState.timers[loop].isTimerRunning = false;
    }
  });
  persistAll(); render();
}

/* ---------- loop ops ---------- */
function addTaskToLoop(loopId, taskId, allocated){
  if (!LOOPS.includes(loopId)) return;
  const task = appState.library.find(t => t.id === taskId);
  if (!task) { alert('Task not found in library'); return; }
  appState.loops[loopId].push({ taskId, allocated: parseFloat(allocated) || task.defaultAllocated, completed:0, order: appState.loops[loopId].length });
  persistAll(); render();
}
function removeTaskFromLoop(loopId, taskId){
  if (!confirm('Remove task from this loop?')) return;
  appState.loops[loopId] = appState.loops[loopId].filter(e => e.taskId !== taskId);
  if (appState.timers[loopId].activeTaskId === taskId) {
    stopTimerForLoop(loopId);
    appState.timers[loopId].activeTaskId = null;
    appState.timers[loopId].isTimerRunning = false;
  }
  persistAll(); render();
}
function updateLoopEntry(loopId, taskId, allocated){
  const e = appState.loops[loopId].find(x => x.taskId === taskId);
  if (!e) return;
  const a = parseFloat(allocated); if (isNaN(a) || a <= 0) { alert('Invalid duration'); return; }
  e.allocated = Math.max(0.5, a);
  e.completed = Math.min(e.completed, e.allocated);
  persistAll(); render();
}
function resetLoopProgress(loopId){ appState.loops[loopId].forEach(e => e.completed = 0); persistAll(); render(); }
function moveLoopEntry(loopId, fromIndex, toIndex){
  const arr = appState.loops[loopId];
  if (!arr || fromIndex===toIndex || fromIndex<0 || toIndex<0 || fromIndex>=arr.length || toIndex>=arr.length) return;
  const [it] = arr.splice(fromIndex,1); arr.splice(toIndex,0,it); arr.forEach((it,i) => it.order = i);
  persistAll(); render();
}
function moveUpInLoop(loopId, idx){ if (idx <= 0) return; moveLoopEntry(loopId, idx, idx-1); }
function moveDownInLoop(loopId, idx){ const arr = appState.loops[loopId]; if (idx >= arr.length-1) return; moveLoopEntry(loopId, idx, idx+1); }

/* ---------- timer per-loop ---------- */
function getLibraryTask(id){ return appState.library.find(t => t.id === id) || { id:null, name:'Unknown', note:'', defaultAllocated:30 }; }
function getIncompleteEntries(loopId){ return (appState.loops[loopId]||[]).filter(e => e.completed < e.allocated); }
function getFirstIncompleteEntry(loopId){ const inc = getIncompleteEntries(loopId).sort((a,b)=>a.order-b.order); return inc.length ? inc[0] : null; }

function startTimerForLoop(loopId){
  const ts = appState.timers[loopId];
  // ensure no multiple intervals
  if (ts.timerInterval) { clearInterval(ts.timerInterval); ts.timerInterval = null; }
  const entry = ts.activeTaskId ? appState.loops[loopId].find(e=>e.taskId===ts.activeTaskId) : getFirstIncompleteEntry(loopId);
  if (!entry) { ts.isTimerRunning = false; persistAll(); render(); return; }
  // stop other loops
  LOOPS.forEach(l => { if (l!==loopId) stopTimerForLoop(l); });
  ts.activeTaskId = entry.taskId;
  ts.timerStartTime = Date.now();
  ts.isTimerRunning = true;
  persistAll();

  const remaining = Math.max(0.001, entry.allocated - entry.completed);
  scheduleSWAlarm(getLibraryTask(entry.taskId).name, remaining, loopId);

  ts.timerInterval = setInterval(() => {
    if (!ts.timerStartTime || !ts.activeTaskId) { stopTimerForLoop(loopId); return; }
    const now = Date.now();
    const elapsed = (now - ts.timerStartTime) / 60000;
    const idx = appState.loops[loopId].findIndex(e => e && e.taskId === ts.activeTaskId);
    if (idx !== -1) {
      const e = appState.loops[loopId][idx];
      e.completed = Math.min(e.completed + elapsed, e.allocated);
      ts.timerStartTime = now;
      persistAll(); render();
      if (e.completed >= e.allocated) {
        stopTimerForLoop(loopId);
        ts.isTimerRunning = false;
        playLocalSound();
        cancelSWAlarm();
        render();
      }
    } else { stopTimerForLoop(loopId); }
  }, 1000);
}

function stopTimerForLoop(loopId){
  const ts = appState.timers[loopId];
  if (ts.timerInterval) { clearInterval(ts.timerInterval); ts.timerInterval = null; }
  ts.timerStartTime = null; ts.activeTaskId = null; ts.isTimerRunning = false; cancelSWAlarm(); persistAll();
}

function toggleTimerForActiveLoop(){
  const loopId = appState.activeLoopId;
  const ts = appState.timers[loopId];
  if (ts.isTimerRunning) stopTimerForLoop(loopId);
  else startTimerForLoop(loopId);
  render();
}

/* ---------- import/export ---------- */
function exportAll(){
  try{
    const payload = { meta:{ exportedAt:new Date().toISOString(), version:2 }, library:appState.library, loops:appState.loops, timers:{
      out:{ activeTaskId: appState.timers.out.activeTaskId, timerStartTime: appState.timers.out.timerStartTime, isTimerRunning: appState.timers.out.isTimerRunning },
      in_weekday:{ activeTaskId: appState.timers.in_weekday.activeTaskId, timerStartTime: appState.timers.in_weekday.timerStartTime, isTimerRunning: appState.timers.in_weekday.isTimerRunning },
      in_weekend:{ activeTaskId: appState.timers.in_weekend.activeTaskId, timerStartTime: appState.timers.in_weekend.timerStartTime, isTimerRunning: appState.timers.in_weekend.isTimerRunning }
    }, activeMode: appState.activeMode };
    const blob = new Blob([JSON.stringify(payload,null,2)], { type:'application/json' });
    const url = URL.createObjectURL(blob); const a = document.createElement('a'); a.href = url; a.download = `focus-loops-${new Date().toISOString().slice(0,10)}.json`; document.body.appendChild(a); a.click(); a.remove();
    setTimeout(()=>URL.revokeObjectURL(url), 2000);
  } catch(err){ alert('Export error: '+err.message); }
}

function importAll(){
  const input = document.createElement('input'); input.type='file'; input.accept='application/json';
  input.onchange = e => {
    const f = e.target.files[0]; if (!f) return;
    const reader = new FileReader();
    reader.onload = ev => {
      try {
        const parsed = JSON.parse(ev.target.result);
        if (!parsed || !parsed.library || !parsed.loops) { alert('Invalid file'); return; }
        if (!confirm('Replace current data with imported data? This will overwrite existing tasks and loops.')) return;
        LOOPS.forEach(l => { stopTimerForLoop(l); appState.timers[l].isTimerRunning = false; appState.timers[l].activeTaskId = null; appState.timers[l].timerStartTime = null; });
        appState.library = parsed.library;
        LOOPS.forEach(l => appState.loops[l] = parsed.loops[l] || []);
        if (parsed.timers) LOOPS.forEach(l => { const t = parsed.timers[l] || {}; appState.timers[l].activeTaskId = t.activeTaskId || null; appState.timers[l].timerStartTime = t.timerStartTime || null; appState.timers[l].isTimerRunning = !!t.isTimerRunning; });
        appState.activeMode = parsed.activeMode || 'in';
        persistAll(); render(); alert('Import complete.');
      } catch(err){ alert('Import failed: '+err.message); }
    };
    reader.readAsText(f);
  };
  input.click();
}

/* ---------- UI: render ---------- */
function render(){
  if (appState.isRendering) return;
  appState.isRendering = true;
  try {
    appState.activeLoopId = getActiveLoopId();
    const app = document.getElementById('app');
    if (!app) return;

    const activeLoopHuman = appState.activeLoopId === 'out' ? 'Out' : (appState.activeLoopId === 'in_weekend' ? 'In — Weekend' : 'In — Weekday');
    const hint = appState.activeLoopId === 'in_weekend' ? 'Weekend: lighter tasks' : 'Weekday: normal routine';

    const loopEntries = (appState.loops[appState.activeLoopId] || []).slice().sort((a,b)=> (a.order||0)-(b.order||0));
    const firstInc = loopEntries.find(e => e.completed < e.allocated) || null;
    const currentDef = firstInc ? getLibraryTask(firstInc.taskId) : null;
    const progressPct = firstInc ? Math.min(100, Math.round((firstInc.completed/firstInc.allocated)*100)) : 0;

    // main HTML
    let html = `
      <div class="top-card container" role="region" aria-label="Mode selection">
        <div class="mode-slider" >
          <div style="flex:1"></div>
          <div class="slider-wrap" role="tablist" aria-label="Mode switch">
            <button class="mode-btn ${appState.activeMode==='out'?'active':''}" onclick="setMode('out')" aria-pressed="${appState.activeMode==='out'}">Out</button>
            <button class="mode-btn ${appState.activeMode==='in'?'active':''}" onclick="setMode('in')" aria-pressed="${appState.activeMode==='in'}">In</button>
          </div>
          <div class="header-right"><button class="btn" onclick="openManage()" aria-label="Open Manage Tasks">Manage</button></div>
        </div>
      </div>

      <div class="container center-card">
        <div class="timer-card" role="main" aria-live="polite">
          <div class="title">${currentDef ? escapeHtml(currentDef.name) : 'No tasks in this loop'}</div>
          <div class="subtitle">${escapeHtml(activeLoopHuman)} — ${escapeHtml(hint)}</div>

          <div class="progress-wrap">
            <div class="progress-track"><div class="progress-fill" style="width:${progressPct}%;"></div></div>
          </div>

          <div class="controls" role="toolbar" aria-label="Timer controls">
            <button class="big-btn ${appState.timers[appState.activeLoopId].isTimerRunning ? 'pause' : 'start'}" onclick="toggleTimerForActiveLoop()" aria-pressed="${appState.timers[appState.activeLoopId].isTimerRunning}">
              ${appState.timers[appState.activeLoopId].isTimerRunning ? 'Pause' : 'Start'}
            </button>
            <button class="btn" onclick="goToNextTask()">Next</button>
            <button class="btn" onclick="exportAll()">Export</button>
            <button class="btn" onclick="importAll()">Import</button>
          </div>

          <div class="info-line" style="margin-top:12px;">
            ${currentDef && currentDef.note ? escapeHtml(currentDef.note).replace(/\n/g,'<br>') : '<span style="color:#546779">No note — edit in Task Library</span>'}
          </div>
        </div>
      </div>
    `;

    const hash = location.hash || '';
    if (hash.startsWith('#manage')) html = renderManageScreen() + html;

    app.innerHTML = html;

    // enable loop drag accessibility (desktop) & button reorder on mobile
    if (hash.startsWith('#manage') && appState.currentManageTab === 'loop') {
      setupLoopDrag(); // desktop dragging
      // attach move up/down handlers (exposed already as functions)
    }

    // mark keyboard navigation detection to show focus outlines if user used keyboard
    window.addEventListener('keydown', () => document.documentElement.classList.add('keyboard-navigation'), { once: true });

  } finally {
    appState.isRendering = false;
  }
}

/* ---------- manage panel ---------- */
function renderManageScreen(){
  const loopId = appState.activeLoopId;
  const lib = appState.library.slice().sort((a,b)=>a.name.localeCompare(b.name));
  const entries = (appState.loops[loopId]||[]).slice().sort((a,b)=> (a.order||0)-(b.order||0));

  let html = `
    <div class="manage-overlay" role="dialog" aria-label="Manage tasks" tabindex="-1">
      <div class="manage-panel container">
        <div style="display:flex; justify-content:space-between; align-items:center; gap:12px; margin-bottom:8px;">
          <div style="display:flex; gap:8px; align-items:center;">
            <button class="tab ${appState.currentManageTab==='library'?'active':''}" onclick="navigateManage('library')">Task Library</button>
            <button class="tab ${appState.currentManageTab==='loop'?'active':''}" onclick="navigateManage('loop')">Edit Current Loop</button>
          </div>
          <div style="display:flex; gap:8px;">
            <button class="btn" onclick="closeManage()">Close</button>
          </div>
        </div>

        ${appState.currentManageTab === 'library' ? renderLibraryTab(lib) : renderLoopTab(entries, lib, loopId)}

      </div>
    </div>
  `;
  return html;
}

function renderLibraryTab(lib){
  return `
    <div>
      <div style="display:flex; gap:8px; margin-bottom:10px;">
        <input id="lib-new-name" class="input" placeholder="New task name (required)" aria-label="New task name" />
        <select id="lib-new-default" class="select" aria-label="Default duration">
          ${[15,30,45,60,90,120,150,180,210,240].map(m => `<option value="${m}">${m>=60 ? (m/60)+'h' : m+'m'} (${m}m)</option>`).join('')}
        </select>
        <button class="btn" onclick="addLibraryFromForm()">Add</button>
      </div>
      <div style="margin-bottom:12px;">
        <textarea id="lib-new-note" class="input" placeholder="Optional note (4-5 lines allowed)" aria-label="New task note"></textarea>
      </div>

      <div class="list-card" id="library-list" role="list">
        ${lib.map(item => `
          <div class="task-row" role="listitem" data-lib-id="${item.id}">
            <div style="flex:1">
              <div style="display:flex; justify-content:space-between; align-items:center;">
                <div>
                  <div style="font-weight:700;">${escapeHtml(item.name)}</div>
                  <div style="color:#8ea6bb; font-size:13px;">${formatTime(item.defaultAllocated)}</div>
                </div>
                <div style="display:flex; gap:8px;">
                  <button class="btn" onclick="showEditLibraryForm(${item.id})">Edit</button>
                  <button class="btn" onclick="deleteLibraryTask(${item.id})">Delete</button>
                </div>
              </div>
              <div style="margin-top:8px; color:#cfe0ff;">${escapeHtml(item.note).replace(/\n/g,'<br>')}</div>
            </div>
          </div>
        `).join('')}
      </div>
    </div>
  `;
}

function addLibraryFromForm(){
  const name = document.getElementById('lib-new-name').value;
  const def = document.getElementById('lib-new-default').value;
  const note = document.getElementById('lib-new-note').value;
  if (addLibraryTask(name, def, note)) {
    document.getElementById('lib-new-name').value=''; document.getElementById('lib-new-note').value='';
  }
}
function showEditLibraryForm(id){
  const lib = appState.library.find(t => t.id === id); if (!lib) return;
  const el = document.querySelector(`[data-lib-id="${id}"]`);
  if (!el) return;
  el.innerHTML = `
    <div style="flex:1">
      <input id="edit-name-${id}" class="input" value="${escapeHtml(lib.name)}" />
      <div style="display:flex; gap:8px; margin-top:8px;">
        <select id="edit-default-${id}" class="select">
          ${[15,30,45,60,90,120,150,180,210,240].map(m => `<option value="${m}" ${lib.defaultAllocated==m?'selected':''}>${m>=60?(m/60)+'h':m+'m'}</option>`).join('')}
        </select>
        <button class="btn" onclick="saveEditLibrary(${id})">Save</button>
        <button class="btn" onclick="render()">Cancel</button>
      </div>
      <div style="margin-top:8px;"><textarea id="edit-note-${id}" class="input">${escapeHtml(lib.note)}</textarea></div>
    </div>
  `;
}

function saveEditLibrary(id){
  const name = document.getElementById(`edit-name-${id}`).value;
  const def = document.getElementById(`edit-default-${id}`).value;
  const note = document.getElementById(`edit-note-${id}`).value;
  updateLibraryTask(id, name, def, note);
}

/* loop tab rendering includes up/down reorder buttons for touch accessibility */
function renderLoopTab(entries, lib, loopId){
  const assignedIds = entries.map(e => e.taskId);
  const unassigned = lib.filter(l => !assignedIds.includes(l.id));
  return `
    <div style="display:flex; gap:12px; flex-direction:column;">
      <div style="display:flex; gap:8px; margin-bottom:10px;">
        <select id="add-to-loop-select" class="select" aria-label="Select task to add">
          ${unassigned.length ? unassigned.map(u=>`<option value="${u.id}">${escapeHtml(u.name)} — ${formatTime(u.defaultAllocated)}</option>`).join('') : '<option disabled>No tasks to add — create in library</option>'}
        </select>
        <select id="add-to-loop-alloc" class="select" aria-label="Allocated time">
          ${[15,30,45,60,90,120,150,180,210,240].map(m=>`<option value="${m}">${m>=60?(m/60)+'h':m+'m'}</option>`).join('')}
        </select>
        <button class="btn" onclick="addSelectedToLoop('${loopId}')">Add</button>
      </div>

      <div class="list-card" id="loop-tasks-list" role="list">
        ${entries.length ? entries.map((e, idx) => {
          const def = getLibraryTask(e.taskId);
          const prog = Math.min(100, Math.round((e.completed/e.allocated)*100));
          return `
            <div class="task-row" role="listitem" data-loop-idx="${idx}">
              <div class="drag-handle" aria-hidden="true">⋮</div>
              <div style="flex:1">
                <div style="display:flex; justify-content:space-between; align-items:center;">
                  <div>
                    <div style="font-weight:700;">${escapeHtml(def.name)}</div>
                    <div style="color:#8ea6bb; font-size:13px;">${formatTime(e.completed)} / ${formatTime(e.allocated)}</div>
                  </div>
                  <div style="display:flex; gap:8px; align-items:center;">
                    <input class="input" id="alloc-${e.taskId}" style="width:96px;" value="${e.allocated}" aria-label="Allocated minutes for ${escapeHtml(def.name)}" />
                    <button class="btn" onclick="updateLoopEntry('${loopId}', ${e.taskId}, document.getElementById('alloc-${e.taskId}').value)">Save</button>
                    <button class="btn" onclick="resetLoopEntry('${loopId}', ${e.taskId})">Reset</button>
                    <button class="btn" onclick="removeTaskFromLoop('${loopId}', ${e.taskId})">Remove</button>
                  </div>
                </div>
                <div style="margin-top:8px;">
                  <div class="progress-track"><div class="progress-fill" style="width:${prog}%;"></div></div>
                </div>
                <div style="display:flex; gap:6px; margin-top:8px; justify-content:flex-end;">
                  <button class="reorder-btn" onclick="moveUpInLoop('${loopId}', ${idx})" aria-label="Move up">↑</button>
                  <button class="reorder-btn" onclick="moveDownInLoop('${loopId}', ${idx})" aria-label="Move down">↓</button>
                </div>
              </div>
            </div>
          `;
        }).join('') : `<div class="text-sm" style="color:#8ea6bb">No tasks assigned to this loop yet.</div>`}
      </div>

      <div style="display:flex; gap:8px; margin-top:8px;">
        <button class="btn" onclick="resetLoopProgress('${loopId}')">Reset all progress in this loop</button>
      </div>
    </div>
  `;
}

function addSelectedToLoop(loopId){
  const sel = document.getElementById('add-to-loop-select'); if (!sel) return;
  const val = parseInt(sel.value); const alloc = document.getElementById('add-to-loop-alloc').value;
  if (!val) return; addTaskToLoop(loopId, val, alloc);
}

/* ---------- drag & reorder usability ---------- */
function setupLoopDrag(){
  const list = document.getElementById('loop-tasks-list'); if (!list) return;
  // Desktop: basic HTML5 DnD visuals remain. Mobile: explicit up/down buttons handle reorder.
  let dragged=null, fromIdx=null;
  Array.from(list.querySelectorAll('[data-loop-idx]')).forEach((el, idx) => {
    el.draggable = true;
    el.addEventListener('dragstart', e => { dragged = el; fromIdx = parseInt(el.getAttribute('data-loop-idx')); el.style.opacity='0.5'; });
    el.addEventListener('dragend', e => { if (dragged) dragged.style.opacity='1'; Array.from(list.querySelectorAll('[data-loop-idx]')).forEach(i=>{ i.style.borderTop=''; i.style.borderBottom=''; }); dragged=null; fromIdx=null; });
    el.addEventListener('dragover', e => { e.preventDefault(); if (el!==dragged){ const rect = el.getBoundingClientRect(); el.style.borderTop = (e.clientY < rect.y + rect.height/2) ? '2px solid #6366f1' : ''; el.style.borderBottom = (e.clientY >= rect.y + rect.height/2) ? '2px solid #6366f1' : ''; } });
    el.addEventListener('drop', e => { e.preventDefault(); if (!dragged) return; const toIdx = parseInt(el.getAttribute('data-loop-idx')); const loopId = appState.activeLoopId; moveLoopEntry(loopId, fromIdx, toIdx); });
  });
}

/* ---------- nav / interactions ---------- */
function setMode(mode){
  if (mode!=='in' && mode!=='out') return;
  const prevLoop = getActiveLoopId();
  if (appState.timers[prevLoop] && appState.timers[prevLoop].isTimerRunning) {
    stopTimerForLoop(prevLoop);
  }
  appState.activeMode = mode;
  persistAll(); render();
}
function goToNextTask(){
  const loop = appState.activeLoopId; const entries = (appState.loops[loop]||[]).slice().sort((a,b)=> (a.order||0)-(b.order||0));
  if (!entries.length) return;
  let idx = entries.findIndex(e => e.completed < e.allocated); if (idx === -1) return;
  for (let i = idx+1; i < entries.length; i++) if (entries[i].completed < entries[i].allocated) { appState.timers[loop].activeTaskId = entries[i].taskId; appState.timers[loop].timerStartTime = Date.now(); persistAll(); render(); return; }
  stopTimerForLoop(loop); render();
}

/* ---------- navigation manage overlay ---------- */
function openManage(){ location.hash = '#manage?tab=library'; render(); }
function closeManage(){ location.hash = ''; render(); }
function navigateManage(tab){ appState.currentManageTab = tab; location.hash = '#manage?tab='+tab; render(); }

/* ---------- visibility handling ---------- */
document.addEventListener('visibilitychange', () => {
  if (!document.hidden) {
    LOOPS.forEach(loop => {
      const ts = appState.timers[loop];
      if (ts.isTimerRunning && !ts.timerInterval) {
        // try resume
        ts.timerStartTime = Date.now();
        startTimerForLoop(loop);
      }
    });
    render();
  } else {
    LOOPS.forEach(loop => {
      if (appState.timers[loop].timerInterval) {
        clearInterval(appState.timers[loop].timerInterval);
        appState.timers[loop].timerInterval = null;
      }
    });
  }
});

/* ---------- init ---------- */
(async function init(){
  await registerSW().catch(()=>{});
  loadAll();
  // Reconcile possible running timers saved earlier
  LOOPS.forEach(loop => {
    const ts = appState.timers[loop];
    if (ts.timerStartTime && ts.activeTaskId) {
      const entry = appState.loops[loop].find(e => e.taskId === ts.activeTaskId);
      if (entry) {
        const elapsed = (Date.now() - ts.timerStartTime)/60000;
        const wasComplete = entry.completed >= entry.allocated;
        entry.completed = Math.min(entry.completed + elapsed, entry.allocated);
        if (entry.completed >= entry.allocated && !wasComplete) {
          ts.isTimerRunning = false; ts.activeTaskId = null; ts.timerStartTime = null; playLocalSound();
        } else if (entry.completed < entry.allocated) {
          ts.isTimerRunning = true; ts.timerStartTime = Date.now(); startTimerForLoop(loop);
        }
      } else {
        ts.isTimerRunning = false; ts.activeTaskId = null; ts.timerStartTime = null;
      }
    }
  });
  appState.activeLoopId = getActiveLoopId();
  render();
})();

/* ---------- expose functions for inline onclicks ---------- */
window.setMode = setMode;
window.openManage = openManage;
window.closeManage = closeManage;
window.navigateManage = navigateManage;
window.addLibraryFromForm = addLibraryFromForm;
window.showEditLibraryForm = showEditLibraryForm;
window.saveEditLibrary = saveEditLibrary;
window.deleteLibraryTask = deleteLibraryTask;
window.addSelectedToLoop = addSelectedToLoop;
window.updateLoopEntry = updateLoopEntry;
window.resetLoopEntry = resetLoopEntry;
window.removeTaskFromLoop = removeTaskFromLoop;
window.toggleTimerForActiveLoop = toggleTimerForActiveLoop;
window.goToNextTask = goToNextTask;
window.exportAll = exportAll;
window.importAll = importAll;
window.resetLoopProgress = resetLoopProgress;
window.moveLoopEntry = moveLoopEntry;
window.moveUpInLoop = moveUpInLoop;
window.moveDownInLoop = moveDownInLoop;
window.stopTimerForLoop = stopTimerForLoop;
