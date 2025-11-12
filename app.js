'use strict';

/* ---------- Storage utility ---------- */
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
      const item = localStorage.getItem(key);
      return item ? JSON.parse(item) : defaultValue;
    } catch (e) {
      return defaultValue;
    }
  }
};

/* ---------- App state (library + loops) ---------- */
let audioContext = null;
let swReg = null;

// Constants
const LOOPS = ['out', 'in_weekday', 'in_weekend'];

const defaultLibrary = [
  { id: 1, name: 'Coding', note: 'Deep work block', defaultAllocated: 90 },
  { id: 2, name: 'Exercise', note: 'Quick workout / stretch', defaultAllocated: 30 },
  { id: 3, name: 'Reading', note: 'Reading / learning', defaultAllocated: 45 }
];

const state = {
  // library of tasks (shared name + note)
  library: [],
  // loops: each loop holds entries referencing library tasks
  loops: {
    out: [],
    in_weekday: [],
    in_weekend: []
  },
  // which top mode is selected: 'in' or 'out'
  activeMode: 'in',
  // override: 'auto' | 'weekday' | 'weekend'
  dayOverride: 'auto',
  // timers per-loop
  timers: {
    out: { activeTaskId: null, timerStartTime: null, isTimerRunning: false, timerInterval: null },
    in_weekday: { activeTaskId: null, timerStartTime: null, isTimerRunning: false, timerInterval: null },
    in_weekend: { activeTaskId: null, timerStartTime: null, isTimerRunning: false, timerInterval: null }
  },
  // UI
  showManageTasks: false,
  currentManageTab: 'library',
  currentLoopEditing: 'in_weekday', // derived
  isRendering: false,
  // guard for duplicate completions
  lastCompletionToken: null
};

/* ---------- Service worker registration & messages ---------- */
async function registerSW() {
  if ('serviceWorker' in navigator) {
    try {
      swReg = await navigator.serviceWorker.register('sw.js');
      console.log('[APP] SW registered');
      await navigator.serviceWorker.ready;

      navigator.serviceWorker.addEventListener('message', function (event) {
        // SW notifies of completion: { type: 'TASK_COMPLETE', loopId, taskId, token }
        const d = event.data;
        if (!d || d.type !== 'TASK_COMPLETE') return;
        handleExternalTaskComplete(d.loopId, d.taskId, d.token);
      });

      if (Notification.permission === 'default') {
        Notification.requestPermission().then(p => console.log('[APP] Notification permission:', p));
      }
    } catch (err) {
      console.error('[APP] SW registration failed:', err);
      swReg = null;
    }
  }
}

function scheduleSWAlarm(loopId, taskName, remainingMinutes, token) {
  if (!swReg) {
    // no SW - skip
    return;
  }

  const worker = swReg.active || swReg.installing || swReg.waiting;
  if (!worker) return;

  const delayMs = Math.max(1000, Math.round(remainingMinutes * 60 * 1000));
  worker.postMessage({
    type: 'SCHEDULE_ALARM',
    loopId,
    taskName,
    delay: delayMs,
    token
  });
}

function cancelSWAlarm() {
  if (swReg && swReg.active) {
    swReg.active.postMessage({ type: 'CANCEL_ALARM' });
  }
}

/* ---------- Audio notification ---------- */
function playLocalSound() {
  try {
    if (!audioContext) audioContext = new (window.AudioContext || window.webkitAudioContext)();

    if (audioContext.state === 'suspended') audioContext.resume();

    function beep(start, freq, dur) {
      const osc = audioContext.createOscillator();
      const gain = audioContext.createGain();
      osc.connect(gain);
      gain.connect(audioContext.destination);
      osc.frequency.value = freq;
      osc.type = 'sine';
      gain.gain.setValueAtTime(1.0, start);
      gain.gain.exponentialRampToValueAtTime(0.01, start + dur);
      osc.start(start);
      osc.stop(start + dur);
    }

    const now = audioContext.currentTime;
    beep(now, 600, 0.35);
    beep(now + 0.45, 800, 0.35);
    beep(now + 0.9, 1000, 0.35);

    if ('vibrate' in navigator) {
      navigator.vibrate([200, 100, 200]);
    }
  } catch (e) {
    console.error('Sound error:', e);
  }
}

/* ---------- Helpers & data model operations ---------- */

function uid() {
  return Date.now() + Math.floor(Math.random() * 1000);
}

function escapeHtml(text) {
  const map = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' };
  return String(text).replace(/[&<>"']/g, m => map[m]);
}

function formatTime(minutes) {
  if (typeof minutes !== 'number' || isNaN(minutes)) return '0m';
  const hrs = Math.floor(minutes / 60);
  const mins = Math.floor(minutes % 60);
  return hrs > 0 ? `${hrs}h ${mins}m` : `${mins}m`;
}

function isWeekendDate(d) {
  const day = d.getDay();
  return day === 0 || day === 6;
}

// Determine active loop id based on mode + override
function getActiveLoopId() {
  if (state.activeMode === 'out') return 'out';
  if (state.dayOverride === 'weekday') return 'in_weekday';
  if (state.dayOverride === 'weekend') return 'in_weekend';
  // auto
  return isWeekendDate(new Date()) ? 'in_weekend' : 'in_weekday';
}

/* ---------- Persistence ---------- */

function initState() {
  const saved = storage.load('focus_loops_v1', null);
  if (!saved) {
    // initialize defaults (library + loops)
    state.library = defaultLibrary.map(t => ({ ...t }));
    state.loops = {
      out: [ { taskId: 2, allocated: 30, completed: 0, order: 0 } ],
      in_weekday: defaultLibrary.map((t, i) => ({ taskId: t.id, allocated: t.defaultAllocated, completed: 0, order: i })),
      in_weekend: defaultLibrary.map((t, i) => ({ taskId: t.id, allocated: Math.round(t.defaultAllocated * 0.66), completed: 0, order: i }))
    };
    state.activeMode = 'in';
    state.dayOverride = 'auto';
    persistState();
    return;
  }

  // load saved state with defensives
  state.library = Array.isArray(saved.library) ? saved.library : defaultLibrary.map(t => ({ ...t }));
  state.loops = saved.loops || { out: [], in_weekday: [], in_weekend: [] };
  state.activeMode = saved.activeMode || 'in';
  state.dayOverride = saved.dayOverride || 'auto';

  // timers
  ['out', 'in_weekday', 'in_weekend'].forEach(l => {
    const t = (saved.timers && saved.timers[l]) || {};
    state.timers[l] = state.timers[l] || {};
    state.timers[l].activeTaskId = t.activeTaskId || null;
    state.timers[l].timerStartTime = t.timerStartTime || null;
    state.timers[l].isTimerRunning = !!t.isTimerRunning;
    state.timers[l].timerInterval = null;
  });

  state.lastCompletionToken = saved.lastCompletionToken || null;
}

function persistState() {
  const toSave = {
    library: state.library,
    loops: state.loops,
    activeMode: state.activeMode,
    dayOverride: state.dayOverride,
    timers: {
      out: { activeTaskId: state.timers.out.activeTaskId, timerStartTime: state.timers.out.timerStartTime, isTimerRunning: state.timers.out.isTimerRunning },
      in_weekday: { activeTaskId: state.timers.in_weekday.activeTaskId, timerStartTime: state.timers.in_weekday.timerStartTime, isTimerRunning: state.timers.in_weekday.isTimerRunning },
      in_weekend: { activeTaskId: state.timers.in_weekend.activeTaskId, timerStartTime: state.timers.in_weekend.timerStartTime, isTimerRunning: state.timers.in_weekend.isTimerRunning }
    },
    lastCompletionToken: state.lastCompletionToken || null
  };
  storage.save('focus_loops_v1', toSave);
}

/* ---------- Library CRUD ---------- */

function addLibraryTask(name, note) {
  const trimmed = (name || '').trim();
  if (!trimmed) { alert('Task name cannot be empty'); return false; }
  const id = uid();
  state.library.push({ id, name: trimmed, note: (note || '').slice(0, 800), defaultAllocated: 30 });
  persistState();
  render();
  return true;
}

function updateLibraryTask(id, name, note) {
  const idx = state.library.findIndex(t => t.id === id);
  if (idx === -1) return;
  state.library[idx].name = (name || '').trim();
  state.library[idx].note = (note || '').slice(0, 800);
  persistState();
  render();
}

function deleteLibraryTask(id) {
  const task = state.library.find(t => t && t.id === id);
  if (!task) return;
  if (!confirm(`Delete "${task.name}" from library? This will remove it from all loops.`)) return;
  // remove from loops
  LOOPS.forEach(loop => {
    state.loops[loop] = (state.loops[loop] || []).filter(e => e.taskId !== id);
    // stop timers that reference it
    if (state.timers[loop].activeTaskId === id) {
      stopTimerForLoop(loop);
      state.timers[loop].activeTaskId = null;
      state.timers[loop].isTimerRunning = false;
      state.timers[loop].timerStartTime = null;
    }
  });
  state.library = state.library.filter(t => t.id !== id);
  persistState();
  render();
}

/* ---------- Loop operations ---------- */

function addEntryToLoop(loopId, taskId, allocated) {
  if (!LOOPS.includes(loopId)) return;
  const libTask = state.library.find(t => t.id === taskId);
  if (!libTask) { alert('Selected task not found in library'); return; }
  const time = validateMinutes(allocated) || libTask.defaultAllocated || 30;
  state.loops[loopId] = state.loops[loopId] || [];
  state.loops[loopId].push({ taskId, allocated: time, completed: 0, order: state.loops[loopId].length });
  persistState();
  render();
}

function removeEntryFromLoop(loopId, taskId) {
  const entry = (state.loops[loopId] || []).find(e => e.taskId === taskId);
  if (!entry) return;
  if (!confirm('Remove this task from the loop?')) return;
  state.loops[loopId] = state.loops[loopId].filter(e => e.taskId !== taskId);
  if (state.timers[loopId].activeTaskId === taskId) {
    stopTimerForLoop(loopId);
    state.timers[loopId].activeTaskId = null;
    state.timers[loopId].isTimerRunning = false;
    state.timers[loopId].timerStartTime = null;
  }
  persistState();
  render();
}

function updateLoopAllocated(loopId, taskId, allocated) {
  const entry = (state.loops[loopId] || []).find(e => e.taskId === taskId);
  const t = validateMinutes(allocated);
  if (!entry || t === null) { alert('Invalid allocated time'); return; }
  entry.allocated = t;
  entry.completed = Math.min(entry.completed, entry.allocated);
  persistState();
  render();
}

function resetLoopEntry(loopId, taskId) {
  const entry = (state.loops[loopId] || []).find(e => e.taskId === taskId);
  if (!entry) return;
  entry.completed = 0;
  persistState();
  render();
}

function moveEntry(loopId, from, to) {
  const arr = state.loops[loopId];
  if (!arr || from < 0 || to < 0 || from >= arr.length || to >= arr.length || from === to) return;
  const item = arr.splice(from, 1)[0];
  arr.splice(to, 0, item);
  arr.forEach((it, i) => it.order = i);
  persistState();
  render();
}

/* ---------- Timer logic (per-loop) ---------- */

function getLoopEntries(loopId) {
  return (state.loops[loopId] || []).filter(Boolean);
}

function getFirstIncomplete(loopId) {
  const entries = getLoopEntries(loopId).sort((a, b) => (a.order || 0) - (b.order || 0));
  return entries.find(e => e.completed < e.allocated) || null;
}

function startTimerForLoop(loopId) {
  const timer = state.timers[loopId];
  if (!timer) return;
  // Prevent double intervals
  if (timer.timerInterval) {
    clearInterval(timer.timerInterval);
    timer.timerInterval = null;
  }

  const entry = timer.activeTaskId ? (state.loops[loopId] || []).find(e => e.taskId === timer.activeTaskId) : getFirstIncomplete(loopId);
  if (!entry) return;

  // stop any other running loop timers
  LOOPS.forEach(l => { if (l !== loopId) stopTimerForLoop(l); });

  timer.activeTaskId = entry.taskId;
  timer.timerStartTime = Date.now();
  timer.isTimerRunning = true;
  persistState();

  // schedule SW alarm with token to identify this run
  const token = uid();
  state.lastCompletionToken = token;
  persistState();
  scheduleSWAlarm(loopId, getLibraryTask(entry.taskId).name, Math.max(0.001, entry.allocated - entry.completed), token);

  timer.timerInterval = setInterval(() => {
    if (!timer.timerStartTime || !timer.activeTaskId) {
      stopTimerForLoop(loopId);
      return;
    }
    const now = Date.now();
    const elapsed = (now - timer.timerStartTime) / 60000;
    const idx = (state.loops[loopId] || []).findIndex(e => e && e.taskId === timer.activeTaskId);
    if (idx !== -1) {
      const e = state.loops[loopId][idx];
      e.completed = Math.min(e.completed + elapsed, e.allocated);
      timer.timerStartTime = now;
      persistState();
      render();
      if (e.completed >= e.allocated) {
        // mark complete and stop — use token to avoid double-handling
        handleLocalTaskComplete(loopId, e.taskId, state.lastCompletionToken);
      }
    } else {
      stopTimerForLoop(loopId);
    }
  }, 1000);
}

function stopTimerForLoop(loopId) {
  const timer = state.timers[loopId];
  if (!timer) return;
  if (timer.timerInterval) {
    clearInterval(timer.timerInterval);
    timer.timerInterval = null;
  }
  timer.timerStartTime = null;
  timer.activeTaskId = null;
  timer.isTimerRunning = false;
  cancelSWAlarm();
  persistState();
}

/* ---------- Completion handling (single-source-of-truth) ---------- */

// Called when SW signals completion (from background)
function handleExternalTaskComplete(loopId, taskId, token) {
  // race-guard: if we already processed this token, ignore
  if (token && state.lastCompletionToken === token) {
    // already processed (or will be) — ignore
    return;
  }
  // find the entry and mark completed if not already
  const entry = (state.loops[loopId] || []).find(e => e.taskId === taskId);
  if (!entry) return;
  const wasComplete = entry.completed >= entry.allocated;
  entry.completed = Math.min(entry.allocated, entry.completed + 0.0001 + 0); // ensure >= allocated
  // persist and stop timer for that loop
  stopTimerForLoop(loopId);
  playLocalSound();
  state.lastCompletionToken = token || uid();
  persistState();
  render();
}

// Called when local timer finishes
function handleLocalTaskComplete(loopId, taskId, token) {
  // If token matches lastCompletionToken, skip duplicate
  if (token && state.lastCompletionToken === token) return;
  // mark entry completed
  const entry = (state.loops[loopId] || []).find(e => e.taskId === taskId);
  if (!entry) return;
  entry.completed = entry.allocated;
  stopTimerForLoop(loopId);
  playLocalSound();
  state.lastCompletionToken = token || uid();
  persistState();
  render();
}

/* ---------- Other helpers ---------- */

function validateMinutes(value) {
  const num = parseFloat(value);
  if (isNaN(num) || num <= 0) return null;
  // allow .5 increments
  return Math.max(0.5, Math.round(num * 2) / 2);
}

function getLibraryTask(id) {
  return state.library.find(t => t && t.id === id) || { id: null, name: 'Unknown', note: '', defaultAllocated: 30 };
}

/* ---------- Import / Export (icon-only buttons restored) ---------- */

function exportAll() {
  try {
    const payload = {
      meta: { exportedAt: new Date().toISOString(), version: 1 },
      library: state.library,
      loops: state.loops,
      timers: {
        out: { activeTaskId: state.timers.out.activeTaskId, timerStartTime: state.timers.out.timerStartTime, isTimerRunning: state.timers.out.isTimerRunning },
        in_weekday: { activeTaskId: state.timers.in_weekday.activeTaskId, timerStartTime: state.timers.in_weekday.timerStartTime, isTimerRunning: state.timers.in_weekday.isTimerRunning },
        in_weekend: { activeTaskId: state.timers.in_weekend.activeTaskId, timerStartTime: state.timers.in_weekend.timerStartTime, isTimerRunning: state.timers.in_weekend.isTimerRunning }
      },
      activeMode: state.activeMode,
      dayOverride: state.dayOverride,
      lastCompletionToken: state.lastCompletionToken || null
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `focus-loops-${new Date().toISOString().split('T')[0]}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 100);
  } catch (err) {
    alert('Export error: ' + err.message);
  }
}

function importAll() {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = 'application/json';
  input.onchange = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        const imported = JSON.parse(event.target.result);
        if (!imported || !Array.isArray(imported.library) || !imported.loops) {
          alert('Invalid file');
          return;
        }
        if (!confirm(`Replace current state with imported state?`)) return;
        // stop all timers
        LOOPS.forEach(l => stopTimerForLoop(l));
        state.library = imported.library;
        state.loops = imported.loops;
        state.activeMode = imported.activeMode || 'in';
        state.dayOverride = imported.dayOverride || 'auto';
        // restore timers lightly (but don't start intervals automatically)
        ['out', 'in_weekday', 'in_weekend'].forEach(l => {
          const t = (imported.timers && imported.timers[l]) || {};
          state.timers[l].activeTaskId = t.activeTaskId || null;
          state.timers[l].timerStartTime = t.timerStartTime || null;
          state.timers[l].isTimerRunning = !!t.isTimerRunning;
          state.timers[l].timerInterval = null;
        });
        state.lastCompletionToken = imported.lastCompletionToken || null;
        persistState();
        render();
        alert('Import successful!');
      } catch (err) {
        alert('Error: ' + err.message);
      }
    };
    reader.readAsText(file);
  };
  input.click();
}

/* ---------- Rendering (reverted to original Claude look) ---------- */

function renderTimerView() {
  const activeLoop = getActiveLoopId();
  const incomplete = getLoopEntries(activeLoop).filter(t => t && t.completed < t.allocated);
  if (incomplete.length === 0) {
    return `<div class="min-h-screen bg-gray-900 flex items-center justify-center p-4">
      <div class="bg-gray-800 rounded-3xl shadow-2xl p-12 max-w-md w-full text-center">
        <div class="w-24 h-24 bg-green-600 rounded-full flex items-center justify-center mx-auto mb-6">
          <svg class="w-12 h-12 text-white" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <polyline points="20 6 9 17 4 12"></polyline>
          </svg>
        </div>
        <h2 class="text-3xl font-bold text-white mb-4">All Tasks Complete!</h2>
        <p class="text-gray-400 mb-8">You've finished all your tasks. Great work!</p>
        <button onclick="resetAllTasks()" class="bg-green-600 text-white px-6 py-3 rounded-full font-semibold transition-colors w-full">Start New Cycle</button>
      </div>
    </div>`;
  }

  if (state.currentLoopEditing === undefined) state.currentLoopEditing = activeLoop;
  const loopEntries = getLoopEntries(activeLoop).sort((a,b)=> (a.order||0)-(b.order||0));
  if (state.currentTaskIndex >= loopEntries.length) state.currentTaskIndex = 0;
  const taskEntry = loopEntries[state.currentTaskIndex] || loopEntries[0];
  if (!taskEntry) return '<div class="min-h-screen bg-gray-900"></div>';

  const libTask = getLibraryTask(taskEntry.taskId);
  const progress = Math.min((taskEntry.completed / taskEntry.allocated) * 100, 100);
  const taskNum = loopEntries.findIndex(t => t.taskId === taskEntry.taskId) + 1;

  // small icon-only Import / Export and Manage icons on the top-right
  return `<div class="min-h-screen bg-gray-900 flex flex-col">
    <div class="flex-1 flex items-center justify-center p-4">
      <div class="bg-gray-800 rounded-3xl shadow-2xl p-8 max-w-md w-full">
        <div style="display:flex; align-items:center; justify-content:space-between; margin-bottom:8px;">
          <div>
            <div class="inline-block bg-indigo-900 text-indigo-300 px-3 py-1 rounded-full text-sm font-medium mb-2">Task ${taskNum} of ${loopEntries.length}</div>
            <h1 class="text-4xl font-bold text-white mb-2">${escapeHtml(libTask.name)}</h1>
            <div class="text-gray-400 text-lg">${formatTime(taskEntry.completed)} / ${formatTime(taskEntry.allocated)}</div>
          </div>
          <div style="display:flex; gap:8px;">
            <button class="icon-btn" onclick="exportAll()" title="Export" aria-label="Export"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="7 10 12 15 17 10"></polyline><line x1="12" y1="15" x2="12" y2="3"></line></svg></button>
            <button class="icon-btn" onclick="importAll()" title="Import" aria-label="Import"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="17 8 12 3 7 8"></polyline><line x1="12" y1="3" x2="12" y2="15"></line></svg></button>
            <button class="icon-btn" onclick="state.showManageTasks = true; render()" title="Manage" aria-label="Manage"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="8" y1="6" x2="21" y2="6"></line><line x1="8" y1="12" x2="21" y2="12"></line><line x1="8" y1="18" x2="21" y2="18"></line><line x1="3" y1="6" x2="3.01" y2="6"></line><line x1="3" y1="12" x2="3.01" y2="12"></line><line x1="3" y1="18" x2="3.01" y2="18"></line></svg></button>
          </div>
        </div>

        <div class="mb-6">
          <div class="bg-gray-700 rounded-full h-4 overflow-hidden">
            <div class="bg-gradient-to-r h-full transition-all" style="width: ${progress}%;"></div>
          </div>
        </div>

        <div class="flex gap-3 mb-6">
          <button onclick="toggleTimer()" class="flex-1 flex items-center justify-center gap-2 py-4 rounded-2xl font-semibold text-lg transition-all ${state.timers[activeLoop].isTimerRunning ? 'bg-red-600' : 'bg-indigo-600'} text-white">
            ${state.timers[activeLoop].isTimerRunning ?
              '<svg class="w-6 h-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="6" y="4" width="4" height="16"></rect><rect x="14" y="4" width="4" height="16"></rect></svg> Pause' :
              '<svg class="w-6 h-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="5 3 19 12 5 21 5 3"></polygon></svg> Start'
            }
          </button>
          ${getLoopEntries(activeLoop).length > 1 ?
            '<button onclick="nextTask()" class="px-6 py-4 bg-gray-700 rounded-2xl transition-colors text-white" title="Next"><svg class="w-6 h-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="5 4 15 12 5 20 5 4"></polygon><line x1="19" y1="5" x2="19" y2="19"></line></svg></button>' : ''
          }
        </div>

        <div class="text-gray-400 mb-4">${isWeekendDate(new Date()) ? 'Weekend loop active' : 'Weekday loop active'}</div>

        <div class="text-gray-400" style="white-space:pre-line; max-height:5.6em; overflow:hidden;">
          ${escapeHtml(libTask.note || '')}
        </div>

      </div>
    </div>
  </div>`;
}

/* ---------- Manage view (reverted to original/manage layout) ---------- */

function renderManageView() {
  const activeLoop = getActiveLoopId();
  return `<div class="min-h-screen bg-gray-900 p-4 no-scrollbar" style="overflow-y: auto;">
    <div class="max-w-md mx-auto">
      <div class="flex items-center gap-3 mb-6">
        <button onclick="state.showManageTasks = false; render()" class="p-2 bg-gray-800 rounded-lg text-white transition-colors" aria-label="Back">
          <svg class="w-6 h-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="19" y1="12" x2="5" y2="12"></line><polyline points="12 19 5 12 12 5"></polyline></svg>
        </button>
        <h2 class="text-2xl font-bold text-white flex-1">Manage Tasks</h2>
        <button onclick="exportAll()" class="p-2 bg-gray-700 rounded-lg text-white transition-colors" title="Export" aria-label="Export">
          <svg class="w-6 h-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="7 10 12 15 17 10"></polyline><line x1="12" y1="15" x2="12" y2="3"></line></svg>
        </button>
        <button onclick="importAll()" class="p-2 bg-gray-700 rounded-lg text-white transition-colors" title="Import" aria-label="Import">
          <svg class="w-6 h-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="17 8 12 3 7 8"></polyline><line x1="12" y1="3" x2="12" y2="15"></line></svg>
        </button>
        <button onclick="showAddFormLib()" class="p-2 bg-indigo-600 rounded-lg text-white transition-colors" title="Add Task" aria-label="Add task">
          <svg class="w-6 h-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line></svg>
        </button>
      </div>

      <div id="add-form-container"></div>

      <div class="space-y-3" id="tasks-list">
        ${state.library.map((t, idx) => {
          if (!t) return '';
          // library shows name and note only (no durations). Use only id in onclicks to avoid escaping problems
          return `<div class="bg-gray-800 rounded-2xl p-4" data-lib-id="${t.id}">
            <div class="flex items-center gap-3">
              <div style="flex:1; cursor:pointer" onclick="showEditFormLib(${t.id})">
                <div class="text-white font-medium mb-1">${escapeHtml(t.name)}</div>
                <div class="text-sm text-gray-400" style="white-space:pre-line; max-height:4.2em; overflow:hidden;">${escapeHtml(t.note || '')}</div>
              </div>
              <div class="flex flex-col gap-1">
                <button onclick="showAddToLoopMenu(${t.id})" class="p-1.5 bg-indigo-600 rounded-lg text-white transition-colors" title="Add to current loop" aria-label="Add to loop">
                  <svg class="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line></svg>
                </button>
                <button onclick="showEditFormLib(${t.id})" class="p-1.5 bg-gray-700 rounded-lg text-white transition-colors" title="Edit" aria-label="Edit"><svg class="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4h6"></path><path d="M18 8l-9 9H3v-6l9-9 6 6z"></path></svg></button>
                <button onclick="deleteLibraryTask(${t.id})" class="p-1.5 bg-red-600 rounded-lg text-white transition-colors" title="Delete" aria-label="Delete"><svg class="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg></button>
              </div>
            </div>
          </div>`;
        }).join('')}
      </div>

      <div style="height:40px;"></div>
    </div>
  </div>`;
}


/* ---------- Add / Edit library forms (compact) ---------- */

function showAddFormLib() {
  const c = document.getElementById('add-form-container');
  if (!c) return;
  c.innerHTML = `<div class="bg-gray-800 rounded-2xl p-4 mb-4">
    <input type="text" id="lib-new-name" placeholder="Task name" class="w-full px-4 py-3 bg-gray-700 border border-gray-600 rounded-lg text-white mb-2" style="color:white;" aria-label="New task name">
    <div class="mb-2"><textarea id="lib-new-note" placeholder="Optional note (4-5 lines)" class="w-full px-4 py-3 bg-gray-700 border border-gray-600 rounded-lg text-white" style="color:white;"></textarea></div>
    <div style="display:flex; gap:8px;">
      <button onclick="submitAddLib()" class="px-6 bg-indigo-600 text-white rounded-lg font-medium">Add</button>
      <button onclick="document.getElementById('add-form-container').innerHTML=''" class="px-4 bg-gray-700 text-white rounded-lg">✕</button>
    </div>
  </div>`;
  document.getElementById('lib-new-name').focus();
}

function submitAddLib() {
  const name = document.getElementById('lib-new-name').value;
  const note = document.getElementById('lib-new-note').value;
  if (addLibraryTask(name, note)) {
    document.getElementById('add-form-container').innerHTML = '';
  }
}

function showEditFormLib(id) {
  const lib = state.library.find(t => t.id === id);
  if (!lib) return;
  const el = document.querySelector(`[data-lib-id="${id}"]`);
  if (!el) return;
  // render an inline edit form using the library data (no dangerous inline escaping to onclicks)
  el.innerHTML = `<div>
    <input type="text" id="edit-name-${id}" class="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-lg text-white mb-2" style="color:white;" value="${escapeHtml(lib.name)}" />
    <div class="mb-2"><textarea id="edit-note-${id}" class="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-lg text-white" style="color:white;">${escapeHtml(lib.note || '')}</textarea></div>
    <div style="display:flex; gap:8px;">
      <button onclick="saveEditLib(${id})" class="px-4 bg-indigo-600 text-white rounded-lg text-sm">Save</button>
      <button onclick="render()" class="px-4 bg-gray-700 text-white rounded-lg text-sm">Cancel</button>
    </div>
  </div>`;
  // focus name input for convenience
  const nm = document.getElementById(`edit-name-${id}`);
  if (nm) nm.focus();
}

function saveEditLib(id) {
  const nameEl = document.getElementById(`edit-name-${id}`);
  const noteEl = document.getElementById(`edit-note-${id}`);
  const name = nameEl ? nameEl.value : '';
  const note = noteEl ? noteEl.value : '';
  updateLibraryTask(id, name, note);
}
/* ---------- Adding library task into current loop (duration chosen here) ---------- */

function showAddToLoopMenu(libTaskId) {
  // small prompt: choose a preset or custom
  const loopId = getActiveLoopId();
  const presets = [15, 30, 45, 60, 90, 120, 150, 180, 210, 240];
  const opts = presets.map(m => `${m}m`).join(', ');
  const time = prompt(`Add "${getLibraryTask(libTaskId).name}" to ${loopId}\nChoose minutes (presets: ${opts})`, '30');
  if (!time) return;
  const valid = validateMinutes(time);
  if (valid === null) { alert('Invalid minutes'); return; }
  addEntryToLoop(loopId, libTaskId, valid);
}

/* ---------- Render and UI helpers ---------- */

function render() {
  if (state.isRendering) return;
  state.isRendering = true;
  try {
    const app = document.getElementById('app');
    if (!app) return;

    // determine active loop for display & editing
    const activeLoopId = getActiveLoopId();
    state.currentLoopEditing = activeLoopId;

    // build top small mode toggle + day override
    const modeToggle = `<div style="display:flex; align-items:center; justify-content:center; gap:8px; margin:12px;">
      <div class="mode-toggle" role="tablist" aria-label="Mode">
        <button class="${state.activeMode==='out' ? 'active' : ''}" onclick="setMode('out')" aria-pressed="${state.activeMode==='out'}">Out</button>
        <button class="${state.activeMode==='in' ? 'active' : ''}" onclick="setMode('in')" aria-pressed="${state.activeMode==='in'}">In</button>
      </div>
      <div style="display:flex; gap:6px; align-items:center;">
        <select id="day-override" onchange="setDayOverride(this.value)" style="background:#111827;color:#fff;border:1px solid #374151;padding:8px;border-radius:8px;">
          <option value="auto" ${state.dayOverride==='auto' ? 'selected' : ''}>Auto</option>
          <option value="weekday" ${state.dayOverride==='weekday' ? 'selected' : ''}>Force weekday</option>
          <option value="weekend" ${state.dayOverride==='weekend' ? 'selected' : ''}>Force weekend</option>
        </select>
      </div>
    </div>`;

    // main body: either manage view or timer view
    let bodyHtml = '';
    if (state.showManageTasks) {
      bodyHtml = renderManageView();
    } else {
      bodyHtml = renderTimerView();
    }

    app.innerHTML = `<div class="container">
      ${modeToggle}
      <div class="timer-wrap">
        ${bodyHtml}
      </div>
    </div>`;

  } finally {
    state.isRendering = false;
  }
}

/* ---------- Mode and override setters ---------- */

function setMode(mode) {
  if (mode !== 'in' && mode !== 'out') return;
  // pause running loop when switching
  const prevLoop = getActiveLoopId();
  if (state.timers[prevLoop] && state.timers[prevLoop].isTimerRunning) {
    stopTimerForLoop(prevLoop);
    state.timers[prevLoop].isTimerRunning = false;
  }
  state.activeMode = mode;
  persistState();
  render();
}

function setDayOverride(val) {
  if (['auto', 'weekday', 'weekend'].includes(val)) {
    state.dayOverride = val;
    persistState();
    render();
  }
}

/* ---------- Timer toggle + next task + stop ---------- */

function toggleTimer() {
  const loopId = getActiveLoopId();
  const timer = state.timers[loopId];
  if (!timer) return;
  if (timer.isTimerRunning) {
    stopTimerForLoop(loopId);
  } else {
    startTimerForLoop(loopId);
  }
  render();
}

function nextTask() {
  const loopId = getActiveLoopId();
  const entries = getLoopEntries(loopId).sort((a, b) => (a.order || 0) - (b.order || 0));
  if (entries.length === 0) return;
  const idx = entries.findIndex(e => e && e.taskId === state.timers[loopId].activeTaskId);
  // stop current timer
  stopTimerForLoop(loopId);
  // move to next incomplete
  let nextIdx = -1;
  for (let i = (idx + 1) || 0; i < entries.length; i++) {
    if (entries[i].completed < entries[i].allocated) { nextIdx = i; break; }
  }
  if (nextIdx === -1) {
    // wrap to start
    for (let i = 0; i < entries.length; i++) {
      if (entries[i].completed < entries[i].allocated) { nextIdx = i; break; }
    }
  }
  if (nextIdx !== -1) {
    state.currentTaskIndex = nextIdx;
    // don't auto-start — wait for user to press Start
  }
  persistState();
  render();
}

/* ---------- Reset and utility functions ---------- */

function resetAllTasks() {
  if (!confirm('Reset progress for all tasks?')) return;
  LOOPS.forEach(loop => {
    (state.loops[loop] || []).forEach(e => e.completed = 0);
    stopTimerForLoop(loop);
    state.timers[loop].isTimerRunning = false;
    state.timers[loop].activeTaskId = null;
    state.timers[loop].timerStartTime = null;
  });
  persistState();
  render();
}

/* ---------- Drag and touch reorder for manage view (desktop drag & mobile up/down) ---------- */

function setupDragAndDropManage() {
  const list = document.getElementById('tasks-list');
  if (!list) return;
  let draggedEl = null, draggedIdx = null;
  // use the loop's entries for up/down in manage -> however we keep library list drag disabled (we reorder loop entries separately)
  // For library list we allow inline edit and add; reordering applies in loop edit, not library.
  // The original manage view didn't include drag for library; we preserve that.
}

/* ---------- Visibility handling & onload reconciliation ---------- */

document.addEventListener('visibilitychange', () => {
  if (!document.hidden) {
    // tab visible again: reconcile timers saved as running
    LOOPS.forEach(loop => {
      const ts = state.timers[loop];
      if (ts.timerStartTime && ts.activeTaskId) {
        const elapsed = (Date.now() - ts.timerStartTime) / 60000;
        const entry = (state.loops[loop] || []).find(e => e.taskId === ts.activeTaskId);
        if (entry) {
          const wasComplete = entry.completed >= entry.allocated;
          entry.completed = Math.min(entry.allocated, entry.completed + elapsed);
          persistState();
          if (entry.completed >= entry.allocated && !wasComplete) {
            // mark complete & notify (don’t restart)
            handleLocalTaskComplete(loop, entry.taskId, state.lastCompletionToken);
          } else if (entry.completed < entry.allocated) {
            // resume interval
            ts.timerStartTime = Date.now();
            if (ts.isTimerRunning && !ts.timerInterval) startTimerForLoop(loop);
          }
        } else {
          // referenced deleted entry
          ts.timerStartTime = null; ts.activeTaskId = null; ts.isTimerRunning = false;
          persistState();
        }
      }
    });
    render();
  } else {
    // when hidden, clear intervals to avoid background work (SW handles notifications)
    LOOPS.forEach(loop => {
      const ts = state.timers[loop];
      if (ts.timerInterval) { clearInterval(ts.timerInterval); ts.timerInterval = null; }
    });
  }
});

/* ---------- Init ---------- */

(async function init() {
  try {
    await registerSW();
  } catch (e) {
    console.warn('SW register error', e);
  }
  initState();
  // reconcile timers that were previously running
  LOOPS.forEach(loop => {
    const ts = state.timers[loop];
    if (ts.timerStartTime && ts.activeTaskId) {
      const entry = (state.loops[loop] || []).find(e => e.taskId === ts.activeTaskId);
      if (entry) {
        const elapsed = (Date.now() - ts.timerStartTime) / 60000;
        entry.completed = Math.min(entry.allocated, entry.completed + elapsed);
        if (entry.completed >= entry.allocated) {
          // completed while app was closed
          entry.completed = entry.allocated;
          ts.timerStartTime = null; ts.activeTaskId = null; ts.isTimerRunning = false;
          playLocalSound();
        } else {
          // continue running
          ts.timerStartTime = Date.now();
          if (ts.isTimerRunning) startTimerForLoop(loop);
        }
      } else {
        // referenced deleted task
        ts.timerStartTime = null; ts.activeTaskId = null; ts.isTimerRunning = false;
      }
    }
  });

  render();
})();

/* ---------- Expose functions for inline buttons used in templates ---------- */

window.exportAll = exportAll;
window.importAll = importAll;
window.toggleTimer = toggleTimer;
window.nextTask = nextTask;
window.state = state;
window.resetAllTasks = resetAllTasks;
window.getLibraryTask = getLibraryTask;
window.addEntryToLoop = addEntryToLoop;
window.showAddFormLib = showAddFormLib;
window.submitAddLib = submitAddLib;
window.showEditFormLib = showEditFormLib;
window.saveEditLib = saveEditLib;
window.deleteLibraryTask = deleteLibraryTask;
window.showAddToLoopMenu = showAddToLoopMenu;
window.render = render;
window.setMode = setMode;
window.setDayOverride = setDayOverride;
window.removeEntryFromLoop = removeEntryFromLoop;
window.updateLoopAllocated = updateLoopAllocated;
window.resetLoopEntry = resetLoopEntry;
window.moveEntry = moveEntry;
window.startTimerForLoop = startTimerForLoop;
window.stopTimerForLoop = stopTimerForLoop;
window.handleLocalTaskComplete = handleLocalTaskComplete;
window.handleExternalTaskComplete = handleExternalTaskComplete;
