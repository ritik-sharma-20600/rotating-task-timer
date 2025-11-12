'use strict';

/* -------------------------
   STORAGE UTIL
   ------------------------- */
const storage = {
  save: (key, data) => {
    try {
      localStorage.setItem(key, JSON.stringify(data));
      return true;
    } catch (e) {
      console.error('Storage save failed:', e);
      return false;
    }
  },
  load: (key, defaultValue) => {
    try {
      const v = localStorage.getItem(key);
      return v ? JSON.parse(v) : defaultValue;
    } catch (e) {
      return defaultValue;
    }
  }
};

/* -------------------------
   APP STATE
   ------------------------- */
let swReg = null;
let audioContext = null;

const LOOPS = ['out','in_weekday','in_weekend'];

const defaultLibrary = [
  { id: 1, name: 'Coding', note: 'Deep work block', defaultAllocated: 90 },
  { id: 2, name: 'Exercise', note: 'Quick workout / stretch', defaultAllocated: 30 },
  { id: 3, name: 'Reading', note: 'Reading or learning', defaultAllocated: 45 }
];

const appState = {
  // Global task library (shared notes)
  library: [],
  // Loops contain references to library tasks with per-loop allocated/completed/order
  loops: {
    out: [],
    in_weekday: [],
    in_weekend: []
  },
  // UI
  activeMode: 'in', // 'in' or 'out' (top slider)
  activeLoopId: 'in_weekday', // derived from activeMode + local day
  // Per-loop timer state stored separately per loop
  timers: {
    out: { activeTaskId: null, timerStartTime: null, isTimerRunning: false, timerInterval: null },
    in_weekday: { activeTaskId: null, timerStartTime: null, isTimerRunning: false, timerInterval: null },
    in_weekend: { activeTaskId: null, timerStartTime: null, isTimerRunning: false, timerInterval: null }
  },
  // UI flags
  currentManageTab: 'library', // 'library' or 'loop'
  isRendering: false
};

/* -------------------------
   UTILITIES
   ------------------------- */
function uid() { return Date.now() + Math.floor(Math.random()*1000); }

function escapeHtml(text){
  const map = {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":"&#039;"};
  return String(text).replace(/[&<>"']/g, m => map[m]);
}

function formatTime(minutes){
  if (typeof minutes !== 'number' || isNaN(minutes)) return '0m';
  const hrs = Math.floor(minutes/60);
  const mins = Math.floor(minutes%60);
  return hrs>0 ? `${hrs}h ${mins}m` : `${mins}m`;
}

function isWeekendDate(d){
  // saturday (6) or sunday (0)
  const day = d.getDay();
  return day === 0 || day === 6;
}

function getActiveLoopId(){
  if (appState.activeMode === 'out') return 'out';
  // in -> weekday or weekend
  return isWeekendDate(new Date()) ? 'in_weekend' : 'in_weekday';
}

/* -------------------------
   PWA / SW / SOUND / NOTIF
   ------------------------- */
async function registerSW(){
  if ('serviceWorker' in navigator){
    try{
      swReg = await navigator.serviceWorker.register('sw.js');
      await navigator.serviceWorker.ready;
      console.log('[APP] SW registered');
      navigator.serviceWorker.addEventListener('message', e => {
        const d = e.data;
        if (!d) return;
        if (d.type === 'TASK_COMPLETE') {
          playLocalSound();
        }
      });
      if (Notification.permission === 'default') {
        Notification.requestPermission().then(p => console.log('[APP] Notification permission', p));
      }
    } catch (err){
      console.warn('[APP] SW register failed', err);
    }
  }
}

function scheduleSWAlarm(taskName, remainingMinutes){
  if (!swReg) return;
  const worker = swReg.active || swReg.waiting || swReg.installing;
  if (!worker) return;
  const delayMs = Math.max(1000, Math.round(remainingMinutes*60*1000));
  worker.postMessage({ type:'SCHEDULE_ALARM', taskName, delay: delayMs });
}

function cancelSWAlarm(){
  if (!swReg || !swReg.active) return;
  swReg.active.postMessage({ type:'CANCEL_ALARM' });
}

function playLocalSound(){
  try{
    if (!audioContext) audioContext = new (window.AudioContext || window.webkitAudioContext)();
    if (audioContext.state === 'suspended') audioContext.resume();
    const now = audioContext.currentTime;
    function beep(start,f,dur){
      const osc = audioContext.createOscillator();
      const gain = audioContext.createGain();
      osc.connect(gain); gain.connect(audioContext.destination);
      osc.frequency.value = f; osc.type='sine';
      gain.gain.setValueAtTime(1.0,start);
      gain.gain.exponentialRampToValueAtTime(0.01, start+dur);
      osc.start(start); osc.stop(start+dur);
    }
    beep(now,600,0.35); beep(now+0.45,800,0.35); beep(now+0.9,1000,0.35);
    if ('vibrate' in navigator) navigator.vibrate([200,100,200]);
  } catch(e){ console.warn('sound', e); }
}

/* -------------------------
   DATA MODEL LOAD / SAVE
   ------------------------- */
function persistAll(){
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
}

function loadAll(){
  const saved = storage.load('focus_v2', null);
  if (!saved) {
    // initialize with sensible defaults
    appState.library = defaultLibrary.map(t => ({...t}));
    // populate loops referencing by id with default allocated & empty completed
    appState.loops.out = [ { taskId: 2, allocated: 30, completed:0, order:0 } ];
    appState.loops.in_weekday = defaultLibrary.map((t,i) => ({ taskId: t.id, allocated: t.defaultAllocated, completed: 0, order: i }));
    appState.loops.in_weekend = defaultLibrary.map((t,i) => ({ taskId: t.id, allocated: Math.round(t.defaultAllocated*0.66), completed: 0, order: i }));
    appState.activeMode = 'in';
    persistAll();
    return;
  }
  appState.library = Array.isArray(saved.library) ? saved.library : defaultLibrary;
  // loops safety
  LOOPS.forEach(l => { appState.loops[l] = Array.isArray(saved.loops && saved.loops[l]) ? saved.loops[l] : []; });
  // timers safety
  ['out','in_weekday','in_weekend'].forEach(key => {
    const t = (saved.timers && saved.timers[key]) || {};
    appState.timers[key].activeTaskId = t.activeTaskId || null;
    appState.timers[key].timerStartTime = t.timerStartTime || null;
    appState.timers[key].isTimerRunning = !!t.isTimerRunning;
  });
  appState.activeMode = saved.activeMode || 'in';
}

/* -------------------------
   LIBRARY CRUD
   ------------------------- */
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
  if (!confirm('Delete task from library? This will remove it from all loops.')) return;
  // remove references
  LOOPS.forEach(loop => {
    appState.loops[loop] = appState.loops[loop].filter(i => i.taskId !== id);
  });
  appState.library = appState.library.filter(t => t.id !== id);
  // if any timer referenced this id, clear
  LOOPS.forEach(loop => {
    const ts = appState.timers[loop];
    if (ts.activeTaskId === id) {
      stopTimerForLoop(loop);
      ts.activeTaskId = null; ts.isTimerRunning = false; ts.timerStartTime = null;
    }
  });
  persistAll(); render();
}

/* -------------------------
   LOOP ASSIGN / CRUD
   ------------------------- */
function addTaskToLoop(loopId, taskId, allocated){
  if (!LOOPS.includes(loopId)) return;
  const li = appState.library.find(t => t.id === taskId);
  if (!li) { alert('Task not found'); return; }
  const entry = { taskId, allocated: parseFloat(allocated) || li.defaultAllocated, completed:0, order: appState.loops[loopId].length };
  appState.loops[loopId].push(entry);
  persistAll(); render();
}
function removeTaskFromLoop(loopId, taskId){
  if (!confirm('Remove task from this loop?')) return;
  appState.loops[loopId] = appState.loops[loopId].filter(x => x.taskId !== taskId);
  // if running timer referenced it, stop
  if (appState.timers[loopId].activeTaskId === taskId) {
    stopTimerForLoop(loopId);
    appState.timers[loopId].activeTaskId = null;
  }
  persistAll(); render();
}
function updateLoopEntry(loopId, taskId, allocated){
  const entry = appState.loops[loopId].find(x => x.taskId === taskId);
  if (!entry) return;
  entry.allocated = Math.max(0.5, parseFloat(allocated) || entry.allocated);
  entry.completed = Math.min(entry.completed, entry.allocated);
  persistAll(); render();
}
function resetLoopProgress(loopId){
  appState.loops[loopId].forEach(e => e.completed = 0);
  persistAll(); render();
}
function moveLoopEntry(loopId, fromIndex, toIndex){
  if (fromIndex === toIndex) return;
  const arr = appState.loops[loopId];
  if (!arr || fromIndex < 0 || toIndex < 0 || fromIndex >= arr.length || toIndex >= arr.length) return;
  const [item] = arr.splice(fromIndex,1);
  arr.splice(toIndex,0,item);
  // recompute order
  arr.forEach((it,i)=> it.order = i);
  persistAll(); render();
}

/* -------------------------
   TIMER LOGIC (per-loop)
   ------------------------- */
function getIncompleteEntries(loopId){
  return (appState.loops[loopId]||[]).filter(e => e && e.completed < e.allocated);
}
function getFirstIncompleteEntry(loopId){
  const inc = getIncompleteEntries(loopId).sort((a,b)=>a.order-b.order);
  return inc.length ? inc[0] : null;
}

function startTimerForLoop(loopId){
  const tstate = appState.timers[loopId];
  if (tstate.timerInterval) return;
  const entry = tstate.activeTaskId ? appState.loops[loopId].find(e=>e.taskId===tstate.activeTaskId) : getFirstIncompleteEntry(loopId);
  if (!entry) return;
  // if not already active, set activeTaskId
  tstate.activeTaskId = entry.taskId;
  tstate.timerStartTime = Date.now();
  tstate.isTimerRunning = true;
  persistAll();

  // schedule SW alarm for remaining minutes
  const remaining = Math.max(0.001, entry.allocated - entry.completed);
  scheduleSWAlarm(getLibraryTask(entry.taskId).name, remaining);

  tstate.timerInterval = setInterval(() => {
    if (!tstate.timerStartTime || !tstate.activeTaskId) { stopTimerForLoop(loopId); return; }
    const now = Date.now();
    const elapsed = (now - tstate.timerStartTime) / 60000; // minutes
    const idx = appState.loops[loopId].findIndex(e => e && e.taskId === tstate.activeTaskId);
    if (idx !== -1) {
      const e = appState.loops[loopId][idx];
      e.completed = Math.min(e.completed + elapsed, e.allocated);
      tstate.timerStartTime = now;
      persistAll(); render();
      if (e.completed >= e.allocated) {
        // completed
        stopTimerForLoop(loopId);
        tstate.isTimerRunning = false;
        playLocalSound();
        cancelSWAlarm();
        render();
      }
    } else {
      stopTimerForLoop(loopId);
    }
  }, 1000);
}

function stopTimerForLoop(loopId){
  const tstate = appState.timers[loopId];
  if (tstate.timerInterval) {
    clearInterval(tstate.timerInterval);
    tstate.timerInterval = null;
  }
  tstate.timerStartTime = null;
  tstate.activeTaskId = null;
  tstate.isTimerRunning = false;
  cancelSWAlarm();
  persistAll();
}

function toggleTimerForActiveLoop(){
  const loopId = appState.activeLoopId;
  const tstate = appState.timers[loopId];
  if (tstate.isTimerRunning) {
    // stop
    stopTimerForLoop(loopId);
  } else {
    // stop timers in other loops to ensure only one runs
    LOOPS.forEach(l => {
      if (l !== loopId) stopTimerForLoop(l);
    });
    startTimerForLoop(loopId);
  }
  render();
}

/* -------------------------
   HELPERS
   ------------------------- */
function getLibraryTask(id){
  return appState.library.find(t => t.id === id) || { id:null, name:'Unknown', note:'', defaultAllocated:30 };
}

/* -------------------------
   IMPORT / EXPORT
   ------------------------- */
function exportAll(){
  try {
    const payload = {
      meta: { exportedAt: new Date().toISOString(), version: 2 },
      library: appState.library,
      loops: appState.loops,
      timers: {
        out: { activeTaskId: appState.timers.out.activeTaskId, timerStartTime: appState.timers.out.timerStartTime, isTimerRunning: appState.timers.out.isTimerRunning },
        in_weekday: { activeTaskId: appState.timers.in_weekday.activeTaskId, timerStartTime: appState.timers.in_weekday.timerStartTime, isTimerRunning: appState.timers.in_weekday.isTimerRunning },
        in_weekend: { activeTaskId: appState.timers.in_weekend.activeTaskId, timerStartTime: appState.timers.in_weekend.timerStartTime, isTimerRunning: appState.timers.in_weekend.isTimerRunning }
      },
      activeMode: appState.activeMode
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type:'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `focus-loops-${new Date().toISOString().slice(0,10)}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(()=>URL.revokeObjectURL(url), 2000);
  } catch(err){
    alert('Export failed: '+err.message);
  }
}

function importAll(){
  const input = document.createElement('input');
  input.type = 'file'; input.accept = 'application/json';
  input.onchange = e => {
    const file = e.target.files[0]; if (!file) return;
    const reader = new FileReader();
    reader.onload = ev => {
      try {
        const parsed = JSON.parse(ev.target.result);
        if (!parsed || !parsed.library || !parsed.loops) { alert('Invalid file'); return; }
        if (!confirm('Replace current data with imported data? This will overwrite existing tasks and loops.')) return;
        // stop all timers
        LOOPS.forEach(l => { stopTimerForLoop(l); appState.timers[l].isTimerRunning = false; appState.timers[l].activeTaskId = null; appState.timers[l].timerStartTime = null; });
        appState.library = parsed.library;
        LOOPS.forEach(l => appState.loops[l] = parsed.loops[l] || []);
        // import timers if present
        if (parsed.timers) {
          LOOPS.forEach(l => {
            const t = parsed.timers[l] || {};
            appState.timers[l].activeTaskId = t.activeTaskId || null;
            appState.timers[l].timerStartTime = t.timerStartTime || null;
            appState.timers[l].isTimerRunning = !!t.isTimerRunning;
          });
        }
        appState.activeMode = parsed.activeMode || 'in';
        persistAll(); render();
        alert('Import done.');
      } catch(err) {
        alert('Import error: '+err.message);
      }
    };
    reader.readAsText(file);
  };
  input.click();
}

/* -------------------------
   UI: Rendering
   ------------------------- */

function render(){
  if (appState.isRendering) return;
  appState.isRendering = true;
  try {
    appState.activeLoopId = getActiveLoopId();

    const app = document.getElementById('app');
    if (!app) return;

    // header / top slider
    const activeLoopHuman = (appState.activeLoopId === 'out') ? 'Out' : (appState.activeLoopId === 'in_weekend' ? 'In — Weekend' : 'In — Weekday');
    const todayHint = appState.activeLoopId === 'in_weekend' ? 'Weekend: relax or light tasks' : 'Weekday: regular schedule';

    // current task for active loop
    const loopEntries = appState.loops[appState.activeLoopId] || [];
    // sort by order
    loopEntries.sort((a,b)=> (a.order||0)-(b.order||0));
    const firstInc = loopEntries.find(e => e.completed < e.allocated) || null;
    const currentTaskDef = firstInc ? getLibraryTask(firstInc.taskId) : null;
    const progressPct = firstInc ? Math.min(100, Math.round((firstInc.completed/firstInc.allocated)*100)) : 0;

    // main screen HTML
    let html = `
      <div class="top-card">
        <div class="container">
          <div class="mode-slider">
            <div style="flex:1;"></div>
            <div class="slider-wrap" role="tablist" aria-label="Mode switch">
              <div class="mode-btn ${appState.activeMode==='out'?'active':''}" onclick="setMode('out')">Out</div>
              <div class="mode-btn ${appState.activeMode==='in'?'active':''}" onclick="setMode('in')">In</div>
            </div>
            <div style="flex:1;display:flex;justify-content:flex-end;"><button class="icon-btn" onclick="openManage()"
              title="Manage Tasks / Loops">Manage</button></div>
          </div>
        </div>
      </div>

      <div class="container center-card center-card" style="padding-top:18px;">
        <div class="center card center-card timer-card rounded-2xl">
          <div style="width:100%; max-width:640px;">
            <div style="display:flex; align-items:center; justify-content:space-between; margin-bottom:12px;">
              <div>
                <div class="text-sm">${escapeHtml(activeLoopHuman)}</div>
                <div class="text-2xl font-bold" style="margin-top:6px;">${currentTaskDef ? escapeHtml(currentTaskDef.name) : 'No tasks in this loop'}</div>
              </div>
              <div style="text-align:right;">
                <div class="text-sm text-gray-400">${firstInc ? formatTime(firstInc.completed)+' / '+formatTime(firstInc.allocated) : ''}</div>
                <div style="height:6px;"></div>
              </div>
            </div>

            <div>
              <div class="progress-wrap">
                <div class="progress-track"><div class="progress-fill" style="width:${progressPct}%;"></div></div>
              </div>
              <div style="display:flex; gap:10px; margin-top:14px;">
                <button class="big-btn ${appState.timers[appState.activeLoopId].isTimerRunning ? 'pause' : 'start'}" onclick="toggleTimerForActiveLoop()">
                  ${appState.timers[appState.activeLoopId].isTimerRunning ? 'Pause' : 'Start'}
                </button>
                <button class="btn ghost" onclick="goToNextTask()">Next</button>
                <button class="btn ghost" onclick="exportAll()" title="Export">Export</button>
                <button class="btn ghost" onclick="importAll()" title="Import">Import</button>
              </div>

              <div class="info-line">${escapeHtml(todayHint)}</div>
              <div class="info-line" style="margin-top:8px; color:#cbd5e1;">
                ${currentTaskDef && currentTaskDef.note ? escapeHtml(currentTaskDef.note).replace(/\n/g,'<br>') : '<span class="text-gray-400">No note — edit in Task Library</span>'}
              </div>
            </div>
          </div>
        </div>
      </div>
    `;

    // Manage screen injection (overlay) if active
    // Manage UI is in a separate internal route: use location.hash to navigate: #manage
    const hash = location.hash || '';
    if (hash.startsWith('#manage')) {
      // parse tab param from hash (like #manage?tab=library)
      const q = new URLSearchParams(hash.split('?')[1] || '');
      const tab = q.get('tab') || appState.currentManageTab || 'library';
      appState.currentManageTab = tab;
      html = renderManageScreen(tab) + html;
    }

    app.innerHTML = html;

    // setup drag and drop in loop edit if present
    if (hash.startsWith('#manage') && appState.currentManageTab === 'loop') {
      setupLoopDrag();
    }

  } finally {
    appState.isRendering = false;
  }
}

/* Manage screen HTML as function so we can inject it above main UI */
function renderManageScreen(tab){
  const loopId = appState.activeLoopId;
  const lib = appState.library.slice().sort((a,b)=>a.name.localeCompare(b.name));
  const loopEntries = (appState.loops[loopId]||[]).slice().sort((a,b)=> (a.order||0)-(b.order||0));

  // Tab buttons
  const tabsHtml = `
    <div class="manage-screen list-card" style="position:fixed; left:10px; right:10px; top:80px; z-index:40;">
      <div style="display:flex; align-items:center; justify-content:space-between; margin-bottom:10px;">
        <div style="display:flex; gap:8px;">
          <div class="tab ${tab==='library'?'active':''}" onclick="navigateManage('library')">Task Library</div>
          <div class="tab ${tab==='loop'?'active':''}" onclick="navigateManage('loop')">Edit Current Loop</div>
        </div>
        <div style="display:flex; gap:8px;">
          <button class="btn ghost" onclick="closeManage()">Close</button>
        </div>
      </div>

      <div style="display:flex; gap:12px; margin-bottom:10px;">
        <div style="flex:1;">
          <div class="text-sm text-gray-400">Active loop</div>
          <div class="font-medium" style="margin-top:6px;">${escapeHtml(loopId)}</div>
        </div>
        <div style="flex:1;">
          <div class="text-sm text-gray-400">Mode</div>
          <div class="font-medium" style="margin-top:6px;">${escapeHtml(appState.activeMode)}</div>
        </div>
        <div style="flex:1; text-align:right;">
          <button class="btn ghost" onclick="exportAll()">Export</button>
          <button class="btn ghost" onclick="importAll()">Import</button>
        </div>
      </div>

      ${tab === 'library' ? renderLibraryTab(lib) : renderLoopTab(loopEntries, lib, loopId)}

    </div>
  `;
  return tabsHtml;
}

function renderLibraryTab(lib){
  return `
    <div>
      <div style="display:flex; gap:8px; margin-bottom:12px;">
        <div style="flex:1;">
          <input id="lib-new-name" class="input" placeholder="New task name (required)" />
        </div>
        <div style="width:150px;">
          <select id="lib-new-default" class="select">
            ${[15,30,45,60,90,120,150,180,210,240].map(m => `<option value="${m}">${m>=60 ? (m/60)+'h' : m+'m'} (${m}m)</option>`).join('')}
          </select>
        </div>
        <div>
          <button class="btn" onclick="addLibraryFromForm()">Add</button>
        </div>
      </div>
      <div style="margin-bottom:8px;">
        <textarea id="lib-new-note" class="input" placeholder="Optional note (4-5 lines allowed)"></textarea>
      </div>

      <div id="library-list">
        ${lib.map(item => `
          <div class="task-row" data-lib-id="${item.id}">
            <div style="flex:1;">
              <div style="display:flex; justify-content:space-between; align-items:center;">
                <div>
                  <div style="font-weight:600;">${escapeHtml(item.name)}</div>
                  <div class="text-sm text-gray-400">${formatTime(item.defaultAllocated)}</div>
                </div>
                <div style="display:flex; gap:8px; align-items:center;">
                  <button class="btn ghost" onclick="showEditLibraryForm(${item.id})">Edit</button>
                  <button class="btn ghost" onclick="deleteLibraryTask(${item.id})">Delete</button>
                </div>
              </div>
              <div style="margin-top:8px; color:#cbd5e1;">${escapeHtml(item.note).replace(/\n/g,'<br>')}</div>
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
    document.getElementById('lib-new-name').value = '';
    document.getElementById('lib-new-note').value = '';
  }
}

function showEditLibraryForm(id){
  const lib = appState.library.find(t => t.id === id);
  if (!lib) return;
  const html = `
    <div style="margin-bottom:8px;">
      <input id="edit-name-${id}" class="input" value="${escapeHtml(lib.name)}" />
    </div>
    <div style="display:flex; gap:8px; margin-bottom:8px;">
      <select id="edit-default-${id}" class="select">
        ${[15,30,45,60,90,120,150,180,210,240].map(m => `<option value="${m}" ${lib.defaultAllocated==m?'selected':''}>${m>=60 ? (m/60)+'h' : m+'m'} (${m}m)</option>`).join('')}
      </select>
      <button class="btn" onclick="saveEditLibrary(${id})">Save</button>
      <button class="btn ghost" onclick="render()">Cancel</button>
    </div>
    <div style="margin-bottom:6px;">
      <textarea id="edit-note-${id}" class="input">${escapeHtml(lib.note)}</textarea>
    </div>
  `;
  // inject into the task-row
  const el = document.querySelector(`[data-lib-id="${id}"]`);
  if (el) {
    el.innerHTML = html;
  }
}

function saveEditLibrary(id){
  const name = document.getElementById(`edit-name-${id}`).value;
  const def = document.getElementById(`edit-default-${id}`).value;
  const note = document.getElementById(`edit-note-${id}`).value;
  updateLibraryTask(id, name, def, note);
}

/* Loop tab */
function renderLoopTab(entries, lib, loopId){
  // building list of tasks assigned to this loop
  const assignedIds = entries.map(e => e.taskId);
  const unassigned = lib.filter(l => !assignedIds.includes(l.id));
  return `
    <div style="display:flex; gap:12px;">
      <div style="flex:1;">
        <div style="margin-bottom:8px;">
          <div style="display:flex; gap:8px;">
            <select id="add-to-loop-select" class="select" style="flex:1;">
              ${unassigned.length ? unassigned.map(u => `<option value="${u.id}">${escapeHtml(u.name)} — ${formatTime(u.defaultAllocated)}</option>`).join('') : '<option disabled>No tasks available — add in library</option>'}
            </select>
            <select id="add-to-loop-alloc" class="select" style="width:150px;">
              ${[15,30,45,60,90,120,150,180,210,240].map(m => `<option value="${m}">${m>=60?(m/60)+'h':m+'m'}</option>`).join('')}
            </select>
            <button class="btn" onclick="addSelectedToLoop('${loopId}')">Add to Loop</button>
          </div>
        </div>

        <div id="loop-tasks-list">
          ${entries.length ? entries.map((e, idx) => {
            const def = getLibraryTask(e.taskId);
            const prog = Math.min(100, Math.round((e.completed/e.allocated)*100));
            return `
              <div class="task-row" data-loop-idx="${idx}">
                <div style="width:30px;" class="drag-handle">⋮⋮</div>
                <div style="flex:1;">
                  <div style="display:flex; justify-content:space-between; align-items:center;">
                    <div>
                      <div style="font-weight:600;">${escapeHtml(def.name)}</div>
                      <div class="text-sm text-gray-400">${formatTime(e.completed)} / ${formatTime(e.allocated)}</div>
                    </div>
                    <div style="display:flex; gap:8px; align-items:center;">
                      <input class="input" id="alloc-${e.taskId}" style="width:110px;" value="${e.allocated}" />
                      <button class="btn" onclick="saveLoopAlloc('${loopId}', ${e.taskId})">Save</button>
                      <button class="btn ghost" onclick="resetLoopEntry('${loopId}', ${e.taskId})">Reset</button>
                      <button class="btn ghost" onclick="removeTaskFromLoop('${loopId}', ${e.taskId})">Remove</button>
                    </div>
                  </div>
                  <div style="margin-top:8px;">
                    <div class="progress-track"><div class="progress-fill" style="width:${prog}%;"></div></div>
                  </div>
                </div>
              </div>
            `;
          }).join('') : `<div class="text-sm text-gray-400">No tasks assigned to this loop yet.</div>`}
        </div>

        <div style="margin-top:12px;">
          <button class="btn ghost" onclick="resetLoopProgress('${loopId}')">Reset all progress in this loop</button>
        </div>
      </div>
      <div style="width:320px;">
        <div class="list-card">
          <div style="font-weight:700; margin-bottom:8px;">Loop info</div>
          <div class="text-sm text-gray-400" style="margin-bottom:8px;">Active loop: ${escapeHtml(loopId)}</div>
          <div class="text-sm" style="margin-bottom:8px;">Tip: tasks here are references to the Task Library. Edit task name/note from the Library tab.</div>
        </div>
      </div>
    </div>
  `;
}

function addSelectedToLoop(loopId){
  const sel = document.getElementById('add-to-loop-select');
  if (!sel) return;
  const val = parseInt(sel.value);
  const alloc = document.getElementById('add-to-loop-alloc').value;
  if (!val) return;
  addTaskToLoop(loopId, val, alloc);
}

/* loop inline helpers */
function saveLoopAlloc(loopId, taskId){
  const input = document.getElementById(`alloc-${taskId}`);
  if (!input) return;
  updateLoopEntry(loopId, taskId, input.value);
}
function resetLoopEntry(loopId, taskId){
  if (!confirm('Reset progress for this task in the loop?')) return;
  const entry = appState.loops[loopId].find(e => e.taskId === taskId);
  if (entry) {
    entry.completed = 0;
    persistAll(); render();
  }
}

/* -------------------------
   NAV / INTERACTIONS
   ------------------------- */
function setMode(mode){
  if (mode !== 'in' && mode !== 'out') return;
  // if switching while a timer is running on previous active loop, pause and save
  const prevLoop = getActiveLoopId();
  if (appState.timers[prevLoop] && appState.timers[prevLoop].isTimerRunning) {
    stopTimerForLoop(prevLoop);
  }
  appState.activeMode = mode;
  persistAll(); render();
}

function goToNextTask(){
  const loopId = appState.activeLoopId;
  const entries = (appState.loops[loopId] || []).sort((a,b)=> (a.order||0)-(b.order||0));
  if (!entries.length) return;
  // find first incomplete index
  let idx = entries.findIndex(e => e.completed < e.allocated);
  if (idx === -1) return;
  // move to next incomplete
  for (let i = idx+1; i < entries.length; i++){
    if (entries[i].completed < entries[i].allocated) {
      appState.timers[loopId].activeTaskId = entries[i].taskId;
      appState.timers[loopId].timerStartTime = Date.now();
      persistAll(); render();
      return;
    }
  }
  // wrap to beginning and stop if no more
  stopTimerForLoop(loopId);
  render();
}

/* -------------------------
   Drag & Drop for loop tasks (manage screen)
   ------------------------- */
function setupLoopDrag(){
  const list = document.getElementById('loop-tasks-list');
  if (!list) return;
  let dragged = null, fromIdx = null;
  Array.from(list.querySelectorAll('[data-loop-idx]')).forEach((el, idx) => {
    el.draggable = true;
    el.addEventListener('dragstart', e => { dragged = el; fromIdx = parseInt(el.getAttribute('data-loop-idx')); el.style.opacity='0.5'; });
    el.addEventListener('dragend', e => { if (dragged) dragged.style.opacity='1'; Array.from(list.querySelectorAll('[data-loop-idx]')).forEach(i=>{ i.style.borderTop=''; i.style.borderBottom=''; }); dragged=null; fromIdx=null; });
    el.addEventListener('dragover', e => { e.preventDefault(); if (el!==dragged){ const rect = el.getBoundingClientRect(); el.style.borderTop = (e.clientY < rect.y + rect.height/2) ? '2px solid #6366f1' : ''; el.style.borderBottom = (e.clientY >= rect.y + rect.height/2) ? '2px solid #6366f1' : ''; } });
    el.addEventListener('drop', e => { e.preventDefault(); if (!dragged) return; const toIdx = parseInt(el.getAttribute('data-loop-idx')); const loopId = appState.activeLoopId; moveLoopEntry(loopId, fromIdx, toIdx); });
  });
}

/* -------------------------
   Manage open / close navigation
   ------------------------- */
function openManage(){
  location.hash = '#manage?tab=library';
  render();
}
function closeManage(){
  location.hash = '';
  render();
}
function navigateManage(tab){
  appState.currentManageTab = tab;
  location.hash = '#manage?tab=' + tab;
  render();
}

/* -------------------------
   Misc helpers used on page
   ------------------------- */
window.addEventListener('hashchange', () => {
  render();
});

/* -------------------------
   Visibility handling (pause intervals when hidden)
   ------------------------- */
document.addEventListener('visibilitychange', () => {
  if (!document.hidden) {
    // resume timers where necessary (if isTimerRunning and timerInterval missing)
    LOOPS.forEach(loop => {
      const ts = appState.timers[loop];
      if (ts.isTimerRunning && !ts.timerInterval) {
        // reset timerStartTime to now (we compute elapsed on load)
        ts.timerStartTime = Date.now();
        startTimerForLoop(loop);
      }
    });
    render();
  } else {
    // clear running intervals (they continue logically in data)
    LOOPS.forEach(loop => {
      const ts = appState.timers[loop];
      if (ts.timerInterval) {
        clearInterval(ts.timerInterval);
        ts.timerInterval = null;
      }
    });
  }
});

/* -------------------------
   Initialization
   ------------------------- */
(async function init(){
  try {
    await registerSW();
  } catch(e) {
    console.warn('sw error', e);
  }
  loadAll();
  // If there were timers saved as running, reconcile elapsed time now
  LOOPS.forEach(loop => {
    const ts = appState.timers[loop];
    if (ts.timerStartTime && ts.activeTaskId) {
      // compute elapsed
      const elapsed = (Date.now() - ts.timerStartTime)/60000;
      const entry = appState.loops[loop].find(e => e.taskId === ts.activeTaskId);
      if (entry) {
        const wasComplete = entry.completed >= entry.allocated;
        entry.completed = Math.min(entry.completed + elapsed, entry.allocated);
        if (entry.completed >= entry.allocated && !wasComplete) {
          // just completed
          ts.isTimerRunning = false; ts.activeTaskId = null; ts.timerStartTime = null;
          playLocalSound();
        } else if (entry.completed < entry.allocated) {
          ts.isTimerRunning = true;
          ts.timerStartTime = Date.now();
          startTimerForLoop(loop);
        }
      } else {
        // referenced a deleted entry
        ts.isTimerRunning = false; ts.activeTaskId = null; ts.timerStartTime = null;
      }
    }
  });
  // Derive active loop id and render
  appState.activeLoopId = getActiveLoopId();
  render();
})();

/* -------------------------
   Expose a few helpers to window for inline onclick usage
   ------------------------- */
window.setMode = setMode;
window.openManage = openManage;
window.closeManage = closeManage;
window.navigateManage = navigateManage;
window.addLibraryFromForm = addLibraryFromForm;
window.showEditLibraryForm = showEditLibraryForm;
window.saveEditLibrary = saveEditLibrary;
window.deleteLibraryTask = deleteLibraryTask;
window.addSelectedToLoop = addSelectedToLoop;
window.saveLoopAlloc = saveLoopAlloc;
window.resetLoopEntry = resetLoopEntry;
window.removeTaskFromLoop = removeTaskFromLoop;
window.toggleTimerForActiveLoop = toggleTimerForActiveLoop;
window.goToNextTask = goToNextTask;
window.exportAll = exportAll;
window.importAll = importAll;
window.resetLoopProgress = resetLoopProgress;
window.moveLoopEntry = moveLoopEntry;
window.resetTimerForLoop = stopTimerForLoop;
