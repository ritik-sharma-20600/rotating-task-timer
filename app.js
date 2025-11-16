'use strict';
// ============================================================================
// GITHUB GIST SYNC
// ============================================================================
let GITHUB_TOKEN = localStorage.getItem('github_token') || null;
let syncTimeout = null;
let lastSyncTime = 0;
const MIN_SYNC_INTERVAL = 2000;

// At the top with other constants
const GIST_FILENAME = 'focus-timer-data.json';
const GIST_DESCRIPTION = 'Focus Timer App Data - DO NOT DELETE';

// ✅ ADD THIS: Allow manual GIST_ID override
const MANUAL_GIST_ID = '69fbd5c11c0ed33f21f29c16b61f5f23'; // Set to 'your-gist-id-here' if you want to force a specific gist

let GIST_ID = MANUAL_GIST_ID || localStorage.getItem('gist_id') || null;
let syncInProgress = false;
let pendingSync = false;

function debouncedSync() {
  if (syncTimeout) clearTimeout(syncTimeout);
  
  syncTimeout = setTimeout(() => {
    const now = Date.now();
    const timeSinceLastSync = now - lastSyncTime;
    
    if (timeSinceLastSync < MIN_SYNC_INTERVAL) {
      syncTimeout = setTimeout(() => debouncedSync(), MIN_SYNC_INTERVAL - timeSinceLastSync);
      return;
    }
    
    if (GITHUB_TOKEN && !syncInProgress) {
      syncToGist();
    }
  }, 1000);
}

const storage = {
  save: async (key, data) => {
    try {
      localStorage.setItem(key, JSON.stringify(data));
      debouncedSync();
      return true;
    } catch (e) {
      console.error('[STORAGE] Save failed:', e);
      return false;
    }
  },
  load: (key, defaultValue) => {
    try {
      const item = localStorage.getItem(key);
      return item ? JSON.parse(item) : defaultValue;
    } catch (e) {
      console.error('[STORAGE] Load failed:', e);
      return defaultValue;
    }
  }
};

// Find existing gist by description
async function findExistingGist() {
  if (MANUAL_GIST_ID) {
    console.log('[SYNC] Using manual GIST_ID:', MANUAL_GIST_ID);
    return MANUAL_GIST_ID;
  }
  if (!GITHUB_TOKEN) return null;
  
  try {
    console.log('[SYNC] 🔍 Searching for existing gist...');
    const response = await fetch('https://api.github.com/gists', {
      headers: {
        'Authorization': `Bearer ${GITHUB_TOKEN}`,
        'Accept': 'application/vnd.github.v3+json'
      }
    });
    
    if (response.ok) {
      const gists = await response.json();
      const found = gists.find(g => g.description === GIST_DESCRIPTION);
      
      if (found) {
        console.log('[SYNC] ✅ Found existing gist:', found.id);
        return found.id;
      }
    }
    
    console.log('[SYNC] No existing gist found');
    return null;
  } catch (err) {
    console.error('[SYNC] Error finding gist:', err);
    return null;
  }
}

async function syncToGist() {
  console.log('[SYNC] ========== SYNC START ==========');
  console.log('[SYNC] Token exists:', !!GITHUB_TOKEN);
  
  if (!GITHUB_TOKEN) {
    console.log('[SYNC] No token');
    return;
  }
  
  // Don't sync empty data
  const masterTasks = localStorage.getItem('masterTasks');
  const hasData = masterTasks && masterTasks !== 'null' && masterTasks !== '[]';
  
  if (!hasData) {
    console.log('[SYNC] ⚠️ No local data, skipping sync');
    return;
  }
  
  if (syncInProgress) {
    console.log('[SYNC] Already in progress');
    pendingSync = true;
    return;
  }
  
  syncInProgress = true;
  lastSyncTime = Date.now();
  
 const nowISO = new Date().toISOString();
const nowTimestamp = Date.now();

const data = {
  masterTasks: localStorage.getItem('masterTasks'),
  loops: localStorage.getItem('loops'),
  mode: localStorage.getItem('mode'),
  forceWeekend: localStorage.getItem('forceWeekend'),
  timerStartTime: localStorage.getItem('timerStartTime'),
  activeTaskAssignmentId: localStorage.getItem('activeTaskAssignmentId'),
  activeLoopKey: localStorage.getItem('activeLoopKey'),
  lastMidnightCheck: localStorage.getItem('lastMidnightCheck'),
  syncTime: nowISO,
  syncTimestamp: nowTimestamp // Add this for easier comparison
};

    const gistData = {
      description: GIST_DESCRIPTION,
      public: false,
      files: {
        [GIST_FILENAME]: {
          content: JSON.stringify(data, null, 2)
        }
      }
    };

    let response;
    
    // If no GIST_ID, search for existing gist first
    if (!GIST_ID) {
      console.log('[SYNC] No local GIST_ID, searching...');
      GIST_ID = await findExistingGist();
      if (GIST_ID) {
        localStorage.setItem('gist_id', GIST_ID);
      }
    }
    
    if (GIST_ID) {
      console.log('[SYNC] 📤 Updating gist:', GIST_ID);
      response = await fetch(`https://api.github.com/gists/${GIST_ID}`, {
        method: 'PATCH',
        headers: {
          'Authorization': `Bearer ${GITHUB_TOKEN}`,
          'Content-Type': 'application/json',
          'Accept': 'application/vnd.github.v3+json'
        },
        body: JSON.stringify(gistData)
      });
    } else {
      console.log('[SYNC] 📤 Creating new gist');
      response = await fetch('https://api.github.com/gists', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${GITHUB_TOKEN}`,
          'Content-Type': 'application/json',
          'Accept': 'application/vnd.github.v3+json'
        },
        body: JSON.stringify(gistData)
      });
    }

    console.log('[SYNC] Response:', response.status);

    if (response.ok) {
      const gist = await response.json();
      GIST_ID = gist.id;
      localStorage.setItem('gist_id', GIST_ID);
      localStorage.setItem('lastSyncTime', nowISO);
localStorage.setItem('lastSyncTimestamp', nowTimestamp.toString());
      console.log('[SYNC] ✅ SUCCESS! Gist:', GIST_ID);
      console.log('[SYNC] URL:', gist.html_url);
    } else {
      const errorText = await response.text();
      console.error('[SYNC] ❌ Failed:', response.status, errorText);
      
      if (response.status === 404 && GIST_ID) {
        console.log('[SYNC] Gist not found, will search/create new');
        GIST_ID = null;
        localStorage.removeItem('gist_id');
      }
    }
  } catch (err) {
    console.error('[SYNC] ❌ Error:', err);
  } finally {
    syncInProgress = false;
    console.log('[SYNC] ========== SYNC END ==========\n');
    
    if (pendingSync) {
      pendingSync = false;
      setTimeout(() => debouncedSync(), 2000);
    }
  }
}

async function loadFromGist() {
  if (!GITHUB_TOKEN) {
    console.log('[LOAD] No token');
    return false;
  }
  
  try {
    // If no GIST_ID, search for existing gist
    if (!GIST_ID) {
      console.log('[LOAD] No GIST_ID, searching...');
      GIST_ID = await findExistingGist();
      if (GIST_ID) {
        localStorage.setItem('gist_id', GIST_ID);
      } else {
        console.log('[LOAD] No gist found, will create on first sync');
        return false;
      }
    }
    
    console.log('[LOAD] 📥 Loading from gist:', GIST_ID);
    
    const response = await fetch(`https://api.github.com/gists/${GIST_ID}`, {
      headers: {
        'Authorization': `Bearer ${GITHUB_TOKEN}`,
        'Accept': 'application/vnd.github.v3+json'
      }
    });
    
    console.log('[LOAD] Response:', response.status);
    
    if (response.ok) {
      const gist = await response.json();
      const content = gist.files[GIST_FILENAME]?.content;
      
      if (content) {
        const data = JSON.parse(content);
        
        // Check if local is empty
        const localIsEmpty = !localStorage.getItem('masterTasks') || 
                             localStorage.getItem('masterTasks') === '[]' ||
                             localStorage.getItem('masterTasks') === 'null';
        
        // Check if remote has data
        const remoteHasData = data.masterTasks && 
                              data.masterTasks !== 'null' && 
                              data.masterTasks !== '[]';
        
        console.log('[LOAD] Local empty:', localIsEmpty);
        console.log('[LOAD] Remote has data:', remoteHasData);
        
// REPLACE all the timestamp comparison logic with:
const localSyncISO = localStorage.getItem('lastSyncTime') || '1970-01-01T00:00:00.000Z';
const remoteSyncISO = data.syncTime || '1970-01-01T00:00:00.000Z';

// Use timestamp for comparison (more reliable)
const localTimestamp = parseInt(localStorage.getItem('lastSyncTimestamp') || '0');
const remoteTimestamp = data.syncTimestamp || 0;

console.log('[LOAD] Local time:', new Date(localSyncISO).toLocaleString(), '(', localTimestamp, ')');
console.log('[LOAD] Remote time:', new Date(remoteSyncISO).toLocaleString(), '(', remoteTimestamp, ')');

// Load remote if: local is empty OR remote is newer
if (remoteHasData && (localIsEmpty || remoteTimestamp > localTimestamp)) {
  console.log('[LOAD] ✅ Loading cloud data (remote is', remoteTimestamp - localTimestamp, 'ms newer)');
  Object.keys(data).forEach(key => {
    if (key !== 'syncTime' && key !== 'syncTimestamp' && key !== 'deviceTime') {
  // Allow null values to be stored (clears timer state properly)
  if (data[key] !== undefined) {
    localStorage.setItem(key, data[key]);
  }
}
  });
  localStorage.setItem('lastSyncTime', remoteSyncISO);
  localStorage.setItem('lastSyncTimestamp', remoteTimestamp.toString());
  return true;
} else if (remoteHasData && remoteTimestamp === localTimestamp) {
  // Same timestamp, check content
  const localTasks = localStorage.getItem('masterTasks');
  const remoteTasks = data.masterTasks;
  
  if (localTasks !== remoteTasks) {
    console.log('[LOAD] ⚠️ Same timestamp but different content, taking cloud');
    Object.keys(data).forEach(key => {
      if (key !== 'syncTime' && key !== 'syncTimestamp' && key !== 'deviceTime' && 
          data[key] !== null && data[key] !== undefined) {
        localStorage.setItem(key, data[key]);
      }
    });
    localStorage.setItem('lastSyncTime', remoteSyncISO);
    localStorage.setItem('lastSyncTimestamp', remoteTimestamp.toString());
    return true;
  }
}
console.log('[LOAD] ℹ️ Local is current (local:', localTimestamp, 'remote:', remoteTimestamp, ')');
return false;
      }
    } else if (response.status === 404) {
      console.log('[LOAD] Gist not found');
      GIST_ID = null;
      localStorage.removeItem('gist_id');
    }
  } catch (err) {
    console.error('[LOAD] Error:', err);
  }
  
  return false;
}

// Emergency sync before page close
// Emergency sync before page close
window.addEventListener('beforeunload', (event) => {
  if (GITHUB_TOKEN && !syncInProgress) {
    if (syncTimeout) {
      clearTimeout(syncTimeout);
      syncTimeout = null;
    }
    
    const masterTasks = localStorage.getItem('masterTasks');
    const hasData = masterTasks && masterTasks !== 'null' && masterTasks !== '[]';
    
    if (!hasData) return; // Don't sync empty data
    
    console.log('[APP] Page unloading, emergency sync');
    
    const xhr = new XMLHttpRequest();
    const nowISO = new Date().toISOString();
    const nowTimestamp = Date.now();

    const data = {
      masterTasks: localStorage.getItem('masterTasks'),
      loops: localStorage.getItem('loops'),
      mode: localStorage.getItem('mode'),
      forceWeekend: localStorage.getItem('forceWeekend'),
      timerStartTime: localStorage.getItem('timerStartTime'),
      activeTaskAssignmentId: localStorage.getItem('activeTaskAssignmentId'),
      activeLoopKey: localStorage.getItem('activeLoopKey'),
      lastMidnightCheck: localStorage.getItem('lastMidnightCheck'),
      syncTime: nowISO,
      syncTimestamp: nowTimestamp
    };

    const gistData = {
      description: GIST_DESCRIPTION,
      public: false,
      files: {
        [GIST_FILENAME]: {
          content: JSON.stringify(data, null, 2)
        }
      }
    };

    const url = GIST_ID 
      ? `https://api.github.com/gists/${GIST_ID}`
      : 'https://api.github.com/gists';
    
    xhr.open(GIST_ID ? 'PATCH' : 'POST', url, false);
    xhr.setRequestHeader('Authorization', `Bearer ${GITHUB_TOKEN}`);
    xhr.setRequestHeader('Content-Type', 'application/json');
    xhr.setRequestHeader('Accept', 'application/vnd.github.v3+json');
    
    try {
      xhr.send(JSON.stringify(gistData));
      if (xhr.status === 200 || xhr.status === 201) {
        console.log('[APP] Emergency sync OK');
      }
    } catch (e) {
      console.error('[APP] Emergency sync failed:', e);
    }
  }
});

// ============================================================================
// STATE
// ============================================================================
let audioContext = null;
let swReg = null;

const state = {
  // Master task library
  tasks: storage.load('masterTasks', []),
  
  // Loops configuration
  loops: storage.load('loops', {
    'out': { note: '', assignments: [], currentIndex: 0 },
    'in-weekday': { note: '', assignments: [], currentIndex: 0 },
    'in-weekend': { note: '', assignments: [], currentIndex: 0 }
  }),
  
  // Current state
  mode: storage.load('mode', 'in'), // 'in' or 'out'
  forceWeekend: storage.load('forceWeekend', false), // manual weekend override
  currentScreen: 'focus', // 'focus', 'tasks', 'manage'
  showSettings: false,
  
  // Timer state
  timerInterval: null,
  timerStartTime: storage.load('timerStartTime', null),
  activeTaskAssignmentId: storage.load('activeTaskAssignmentId', null),
  activeLoopKey: storage.load('activeLoopKey', null),
  isTimerRunning: false,
  
  // UI state
  managingLoopKey: null, // which loop is being managed
  isRendering: false,
  lastMidnightCheck: storage.load('lastMidnightCheck', new Date().toDateString())
};

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================
function generateId() {
  return Date.now() + Math.random();
}

function getActiveLoopKey() {
  if (state.mode === 'out') return 'out';
  
  const now = new Date();
  const day = now.getDay();
  const isActuallyWeekend = day === 0 || day === 6;
  
  // Manual override takes precedence
  const useWeekend = state.forceWeekend !== null ? state.forceWeekend : isActuallyWeekend;
  
  return useWeekend ? 'in-weekend' : 'in-weekday';
}

function getActiveLoop() {
  const key = getActiveLoopKey();
  return state.loops[key];
}

function getTaskById(taskId) {
  return state.tasks.find(t => t && t.id === taskId);
}

function getAssignmentById(loopKey, assignmentId) {
  const loop = state.loops[loopKey];
  return loop.assignments.find(a => a && a.id === assignmentId);
}

function getIncompleteAssignments(loopKey) {
  const loop = state.loops[loopKey];
  return loop.assignments.filter(a => a && a.completed < a.duration);
}

function formatTime(minutes) {
  if (typeof minutes !== 'number' || isNaN(minutes)) return '0m';
  const hrs = Math.floor(minutes / 60);
  const mins = Math.floor(minutes % 60);
  return hrs > 0 ? `${hrs}h ${mins}m` : `${mins}m`;
}

function formatDuration(minutes) {
  const labels = {
    15: '15m', 30: '30m', 45: '45m', 
    60: '1h', 90: '1.5h', 120: '2h', 
    150: '2.5h', 180: '3h', 210: '3.5h', 240: '4h'
  };
  return labels[minutes] || `${minutes}m`;
}

function escapeHtml(text) {
  if (!text) return '';
  const map = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#039;',
    '\n': '\\n',
    '\r': ''
  };
  return String(text).replace(/[&<>"'\n\r]/g, m => map[m]);
}

function validateMinutes(value) {
  const num = parseFloat(value);
  return (isNaN(num) || num <= 0) ? null : Math.max(0.5, Math.round(num * 2) / 2);
}

function isTaskUsedInLoops(taskId) {
  return Object.values(state.loops).some(loop => 
    loop.assignments.some(a => a && a.taskId === taskId)
  );
}

function saveState() {
  storage.save('masterTasks', state.tasks);
  storage.save('loops', state.loops);
  storage.save('mode', state.mode);
  
  // Save as string 'true', 'false', or 'null'
  if (state.forceWeekend === true) {
    localStorage.setItem('forceWeekend', 'true');
  } else if (state.forceWeekend === false) {
    localStorage.setItem('forceWeekend', 'false');
  } else {
    localStorage.setItem('forceWeekend', 'null');
  }
  
  storage.save('timerStartTime', state.timerStartTime);
  storage.save('activeTaskAssignmentId', state.activeTaskAssignmentId);
  storage.save('activeLoopKey', state.activeLoopKey);
  storage.save('lastMidnightCheck', state.lastMidnightCheck);
}

// ============================================================================
// MIDNIGHT CHECK
// ============================================================================
function checkMidnightTransition() {
  const today = new Date().toDateString();
  
  if (state.lastMidnightCheck !== today) {
    console.log('[APP] New day detected!');
    state.lastMidnightCheck = today;
    
    // Stop timer if running
    if (state.isTimerRunning) {
      stopTimer();
      state.isTimerRunning = false;
      
      // Play sound and show notification
      playNewDaySound();
      
      if (swReg && swReg.active) {
        const newLoop = getActiveLoopKey();
        const loopName = newLoop === 'out' ? 'Out' : 
                        newLoop === 'in-weekend' ? 'Weekend' : 'Weekday';
        
        swReg.active.postMessage({
          type: 'SHOW_NEW_DAY_NOTIFICATION',
          loopName: loopName
        });
      }
    }
    
    saveState();
    render();
  }
}

// ============================================================================
// AUDIO
// ============================================================================
function playNewDaySound() {
  try {
    // Try to play G-Man audio first
    const audio = new Audio('./gman.mp3');
    audio.volume = 1.0;
    audio.play().catch(err => {
      console.log('[APP] G-Man audio not found, playing chime');
      playChime();
    });
    
    if ('vibrate' in navigator) {
      navigator.vibrate([300, 100, 300, 100, 300]);
    }
  } catch (e) {
    console.error('Audio error:', e);
    playChime();
  }
}

function playChime() {
  try {
    if (!audioContext) {
      audioContext = new (window.AudioContext || window.webkitAudioContext)();
    }
    
    if (audioContext.state === 'suspended') {
      audioContext.resume();
    }
    
    function beep(start, freq, dur) {
      const osc = audioContext.createOscillator();
      const gain = audioContext.createGain();
      osc.connect(gain);
      gain.connect(audioContext.destination);
      osc.frequency.value = freq;
      osc.type = 'sine';
      gain.gain.setValueAtTime(1.0, start); // Max volume
      gain.gain.exponentialRampToValueAtTime(0.01, start + dur);
      osc.start(start);
      osc.stop(start + dur);
    }
    
    const now = audioContext.currentTime;
    // Play more beeps, louder and longer
    beep(now, 600, 0.5);
    beep(now + 0.6, 800, 0.5);
    beep(now + 1.2, 1000, 0.5);
    beep(now + 1.8, 1200, 0.6);
    beep(now + 2.5, 1000, 0.6);
  } catch (e) {
    console.error('Chime error:', e);
  }
}

function playCompletionSound() {
  try {
    playChime();
    if ('vibrate' in navigator) {
      navigator.vibrate([300, 100, 300, 100, 300]);
    }
  } catch (e) {
    console.error('Completion sound error:', e);
  }
}

// ============================================================================
// SERVICE WORKER
// ============================================================================
async function registerSW() {
  if ('serviceWorker' in navigator) {
    try {
      swReg = await navigator.serviceWorker.register('sw.js');
      console.log('[APP] SW registered');
      
      await navigator.serviceWorker.ready;
      console.log('[APP] SW ready');
      
      navigator.serviceWorker.addEventListener('message', (event) => {
        if (event.data.type === 'TASK_COMPLETE') {
          console.log('[APP] Task complete message from SW');
          playCompletionSound();
        }
      });
      
      if (Notification.permission === 'default') {
        const permission = await Notification.requestPermission();
        console.log('[APP] Notification permission:', permission);
      }
    } catch (err) {
      console.error('[APP] SW registration failed:', err);
    }
  }
}

function scheduleSWAlarm(taskName, remainingMinutes) {
  if (!swReg) return;
  
  const worker = swReg.active || swReg.installing || swReg.waiting;
  if (!worker) return;
  
  const delayMs = Math.max(1000, remainingMinutes * 60 * 1000);
  console.log('[APP] Scheduling SW alarm:', taskName, remainingMinutes.toFixed(2), 'min');
  
  worker.postMessage({
    type: 'SCHEDULE_ALARM',
    taskName: taskName,
    delay: delayMs
  });
}

function cancelSWAlarm() {
  if (swReg && swReg.active) {
    console.log('[APP] Cancelling SW alarm');
    swReg.active.postMessage({ type: 'CANCEL_ALARM' });
  }
}

// ============================================================================
// TIMER FUNCTIONS
// ============================================================================
function startTimer() {
  if (state.timerInterval) return;
  
  const loopKey = getActiveLoopKey();
  const loop = state.loops[loopKey];
  const incomplete = getIncompleteAssignments(loopKey);
  
  if (incomplete.length === 0) return;
  
  const assignment = incomplete[loop.currentIndex] || incomplete[0];
  if (!assignment) return;
  
  const task = getTaskById(assignment.taskId);
  if (!task) return;
  
  state.timerStartTime = Date.now();
  state.activeTaskAssignmentId = assignment.id;
  state.activeLoopKey = loopKey;
  
  const remaining = assignment.duration - assignment.completed;
  scheduleSWAlarm(task.name, remaining);
  
  state.timerInterval = setInterval(() => {
    checkMidnightTransition();
    
    if (!state.timerStartTime || !state.activeTaskAssignmentId || !state.activeLoopKey) {
      stopTimer();
      return;
    }
    
    const now = Date.now();
    const elapsed = (now - state.timerStartTime) / 60000;
    
    const currentLoop = state.loops[state.activeLoopKey];
    const assign = currentLoop.assignments.find(a => a && a.id === state.activeTaskAssignmentId);
    
    if (assign) {
      assign.completed = Math.min(assign.completed + elapsed, assign.duration);
      state.timerStartTime = now;
      saveState();
      render();
      
      if (assign.completed >= assign.duration) {
        stopTimer();
        state.isTimerRunning = false;
        playCompletionSound();
        render();
      }
    } else {
      stopTimer();
    }
  }, 1000);
}

function stopTimer() {
  if (state.timerInterval) {
    clearInterval(state.timerInterval);
    state.timerInterval = null;
  }
  state.timerStartTime = null;
  state.activeTaskAssignmentId = null;
  state.activeLoopKey = null;
  cancelSWAlarm();
  saveState();
}

function toggleTimer() {
  state.isTimerRunning = !state.isTimerRunning;
  state.isTimerRunning ? startTimer() : stopTimer();
  render();
}

function navigateTask(direction) {
  stopTimer();
  state.isTimerRunning = false;
  
  const loopKey = getActiveLoopKey();
  const loop = state.loops[loopKey];
  const incomplete = getIncompleteAssignments(loopKey);
  
  if (incomplete.length > 0) {
    if (direction === 'next') {
      loop.currentIndex = (loop.currentIndex + 1) % incomplete.length;
    } else if (direction === 'prev') {
      loop.currentIndex = (loop.currentIndex - 1 + incomplete.length) % incomplete.length;
    }
  }
  
  saveState();
  render();
}

function checkTimerOnLoad() {
  if (state.timerStartTime && state.activeTaskAssignmentId && state.activeLoopKey) {
    const elapsed = (Date.now() - state.timerStartTime) / 60000;
    const loop = state.loops[state.activeLoopKey];
    const assign = loop.assignments.find(a => a && a.id === state.activeTaskAssignmentId);
    
    if (assign) {
      const wasComplete = assign.completed >= assign.duration;
      assign.completed = Math.min(assign.completed + elapsed, assign.duration);
      const isNowComplete = assign.completed >= assign.duration;
      
      if (isNowComplete) {
        state.timerStartTime = null;
        state.activeTaskAssignmentId = null;
        state.activeLoopKey = null;
        state.isTimerRunning = false;
        
        if (!wasComplete) {
          playCompletionSound();
        }
      } else {
        state.isTimerRunning = true;
        state.timerStartTime = Date.now();
      }
      
      saveState();
    }
  }
  
  checkMidnightTransition();
}

// ============================================================================
// MASTER TASKS FUNCTIONS
// ============================================================================
function createTask(name, note) {
  if (!name || !name.trim()) {
    alert('Task name cannot be empty');
    return null;
  }
  
  const task = {
    id: generateId(),
    name: name.trim(),
    note: (note || '').trim()
  };
  
  state.tasks.push(task);
  saveState();
  return task;
}

function updateTask(taskId, name, note) {
  const task = getTaskById(taskId);
  if (!task) return;
  
  if (!name || !name.trim()) {
    alert('Task name cannot be empty');
    return;
  }
  
  task.name = name.trim();
  task.note = (note || '').trim();
  saveState();
  render();
}

function deleteTask(taskId) {
  if (isTaskUsedInLoops(taskId)) {
    alert('Cannot delete task - it is assigned to one or more loops');
    return;
  }
  
  const task = getTaskById(taskId);
  if (!task || !confirm(`Delete task "${task.name}"?`)) return;
  
  state.tasks = state.tasks.filter(t => t && t.id !== taskId);
  saveState();
  render();
}

// ============================================================================
// LOOP ASSIGNMENT FUNCTIONS
// ============================================================================
function addAssignmentToLoop(loopKey, taskId, duration) {
  const validDuration = validateMinutes(duration);
  if (validDuration === null) {
    alert('Please enter valid duration (> 0)');
    return;
  }
  
  const assignment = {
    id: generateId(),
    taskId: taskId,
    duration: validDuration,
    completed: 0
  };
  
  state.loops[loopKey].assignments.push(assignment);
  saveState();
  render();
}

function updateAssignment(loopKey, assignmentId, duration, note) {
  const assignment = getAssignmentById(loopKey, assignmentId);
  if (!assignment) return;
  
  if (duration !== undefined) {
    const validDuration = validateMinutes(duration);
    if (validDuration === null) {
      alert('Please enter valid duration (> 0)');
      return;
    }
    assignment.duration = validDuration;
    assignment.completed = Math.min(assignment.completed, validDuration);
  }
  
  if (note !== undefined) {
    const task = getTaskById(assignment.taskId);
    if (task) {
      task.note = (note || '').trim();
    }
  }
  
  saveState();
  render();
}

function completeAssignment(loopKey, assignmentId) {
  const assignment = getAssignmentById(loopKey, assignmentId);
  if (!assignment) return;
  
  assignment.completed = assignment.duration;
  saveState();
  
  if (getIncompleteAssignments(loopKey).length === 0) {
    playCompletionSound();
  }
  
  render();
}

function resetAssignment(loopKey, assignmentId) {
  const assignment = getAssignmentById(loopKey, assignmentId);
  if (!assignment) return;
  
  assignment.completed = 0;
  saveState();
  render();
}

function deleteAssignment(loopKey, assignmentId) {
  const assignment = getAssignmentById(loopKey, assignmentId);
  if (!assignment) return;
  
  const task = getTaskById(assignment.taskId);
  if (!task || !confirm(`Remove "${task.name}" from this loop?`)) return;
  
  state.loops[loopKey].assignments = state.loops[loopKey].assignments.filter(
    a => a && a.id !== assignmentId
  );
  
  saveState();
  render();
}

function moveAssignment(loopKey, fromIndex, toIndex) {
  if (fromIndex < 0 || toIndex < 0 || fromIndex === toIndex) return;
  
  const assignments = state.loops[loopKey].assignments;
  if (fromIndex >= assignments.length || toIndex >= assignments.length) return;
  
  const [moved] = assignments.splice(fromIndex, 1);
  assignments.splice(toIndex, 0, moved);
  
  saveState();
  
  // Force immediate sync after reorder (critical operation)
  if (GITHUB_TOKEN && !syncInProgress) {
    syncToGist();
  }
  
  render();
}

function resetLoop(loopKey) {
  if (!confirm('Reset all tasks in this loop?')) return;
  
  state.loops[loopKey].assignments.forEach(a => {
    if (a) a.completed = 0;
  });
  state.loops[loopKey].currentIndex = 0;
  
  saveState();
  render();
}

function updateLoopNote(loopKey, note) {
  state.loops[loopKey].note = (note || '').trim();
  saveState();
  render();
}

// ============================================================================
// IMPORT/EXPORT
// ============================================================================
function exportAllData() {
  try {
    if (state.tasks.length === 0) {
      alert('No data to export');
      return;
    }
    
    const data = {
      version: 2,
      exportDate: new Date().toISOString(),
      tasks: state.tasks,
      loops: state.loops,
      mode: state.mode,
      forceWeekend: state.forceWeekend
    };
    
    const blob = new Blob([JSON.stringify(data, null, 2)], {type: 'application/json'});
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `focus-timer-backup-${new Date().toISOString().split('T')[0]}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 100);
    
    alert('✅ Backup exported successfully!');
  } catch (err) {
    alert('Export error: ' + err.message);
  }
}

function importAllData() {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = 'application/json';
  input.onchange = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    
    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        const data = JSON.parse(event.target.result);
        
        if (!data.tasks || !data.loops) {
          alert('Invalid backup file format');
          return;
        }
        
        if (confirm('This will replace ALL current data with the backup. Continue?')) {
          stopTimer();
          state.isTimerRunning = false;
          state.tasks = data.tasks;
          state.loops = data.loops;
          state.mode = data.mode || 'in';
          state.forceWeekend = data.forceWeekend || false;
          saveState();
          render();
          alert('✅ Backup imported successfully!');
        }
      } catch (err) {
        alert('Import error: ' + err.message);
      }
    };
    reader.readAsText(file);
  };
  input.click();
}

// ============================================================================
// RENDER - FOCUS SCREEN
// ============================================================================
function renderFocusScreen() {
  const loopKey = getActiveLoopKey();
  const loop = state.loops[loopKey];
  const incomplete = getIncompleteAssignments(loopKey);
  
  // CRITICAL: Ensure forceWeekend is null when in Out mode
  if (state.mode === 'out' && state.forceWeekend !== null) {
    state.forceWeekend = null;
    saveState();
  }
  
  if (incomplete.length === 0) {
    return `<div class="screen">
      <div class="focus-container">
        <div class="mode-controls">
          <div class="toggle-group">
            <label class="toggle-label">Mode</label>
            <div class="toggle ${state.mode === 'in' ? 'active-right' : 'active-left'}" onclick="toggleMode()">
              <span>Out</span><span>In</span>
            </div>
          </div>
          <div class="toggle-group ${state.mode === 'out' ? 'disabled' : ''}">
            <label class="toggle-label">Day Type</label>
            <div class="toggle small ${state.forceWeekend || (state.mode === 'in' && loopKey === 'in-weekend') ? 'active-right' : 'active-left'}" 
                 onclick="${state.mode === 'out' ? '' : 'toggleForceWeekend()'}">
              <span>Weekday</span><span>Weekend</span>
            </div>
          </div>
        </div>
        
        <div class="complete-state">
          <div class="complete-icon">✓</div>
          <h2>All Tasks Complete!</h2>
          <p>Great work! Ready for a new cycle?</p>
          <button onclick="resetLoop('${loopKey}')" class="btn-primary">Start New Cycle</button>
        </div>
      </div>
    </div>`;
  }
  
  if (loop.currentIndex >= incomplete.length) loop.currentIndex = 0;
  const assignment = incomplete[loop.currentIndex];
  if (!assignment) return '<div class="screen"></div>';
  
  const task = getTaskById(assignment.taskId);
  if (!task) return '<div class="screen"></div>';
  
  const progress = Math.min((assignment.completed / assignment.duration) * 100, 100);
  const loopNote = loop.note || '';
  const taskNote = task.note || '';
  
  return `<div class="screen">
    <div class="focus-container">
      <div class="mode-controls">
        <div class="toggle-group">
          <label class="toggle-label" 
       onmouseover="showTooltip(event, '${escapeHtml(loopNote).replace(/'/g, "\\'")}', false)" 
       onmouseout="hideTooltip()"
       onmousedown="showTooltip(event, '${escapeHtml(loopNote).replace(/'/g, "\\'")}', false)" 
       onmouseup="hideTooltip()" 
       ontouchstart="showTooltip(event, '${escapeHtml(loopNote).replace(/'/g, "\\'")}', true)" 
       ontouchend="hideTooltip()">Mode</label>
          <div class="toggle ${state.mode === 'in' ? 'active-right' : 'active-left'}" onclick="toggleMode()">
            <span>Out</span><span>In</span>
          </div>
        </div>
        <div class="toggle-group ${state.mode === 'out' ? 'disabled' : ''}">
<label class="toggle-label" 
       onmouseover="showTooltip(event, '${escapeHtml(loopNote).replace(/'/g, "\\'")}', false)" 
       onmouseout="hideTooltip()"
       onmousedown="showTooltip(event, '${escapeHtml(loopNote).replace(/'/g, "\\'")}', false)" 
       onmouseup="hideTooltip()" 
       ontouchstart="showTooltip(event, '${escapeHtml(loopNote).replace(/'/g, "\\'")}', true)" 
       ontouchend="hideTooltip()">Day Type</label>
          <div class="toggle small ${state.forceWeekend || (state.mode === 'in' && loopKey === 'in-weekend') ? 'active-right' : 'active-left'}" 
               onclick="${state.mode === 'out' ? '' : 'toggleForceWeekend()'}">
            <span>Weekday</span><span>Weekend</span>
          </div>
        </div>
      </div>
      
      <div class="task-display">
        <h1 class="task-name" onmousedown="showTooltip(event, '${escapeHtml(taskNote).replace(/'/g, "\\'")})" 
            onmouseup="hideTooltip()" ontouchstart="showTooltip(event, '${escapeHtml(taskNote).replace(/'/g, "\\'")}', true)" 
            ontouchend="hideTooltip()"
            onmouseover="showTooltip(event, '${escapeHtml(taskNote).replace(/'/g, "\\'")}')" onmouseout="hideTooltip()"
            >${escapeHtml(task.name)}</h1>
        <div class="task-time">${formatTime(assignment.completed)} / ${formatTime(assignment.duration)}</div>
        <div class="progress-bar">
          <div class="progress-fill" style="width: ${progress}%"></div>
        </div>
      </div>
      
      <div class="timer-controls">
        ${incomplete.length > 1 ? 
          '<button onclick="navigateTask(\'prev\')" class="btn-nav">←</button>' : 
          '<div></div>'
        }
        <button onclick="toggleTimer()" class="btn-timer ${state.isTimerRunning ? 'running' : ''}">
          ${state.isTimerRunning ? 'Pause' : 'Start'}
        </button>
        ${incomplete.length > 1 ? 
          '<button onclick="navigateTask(\'next\')" class="btn-nav">→</button>' : 
          '<div></div>'
        }
      </div>
    </div>
  </div>`;
}

// ============================================================================
// RENDER - TASKS SCREEN
// ============================================================================
function renderTasksScreen() {
  return `<div class="screen">
    <div class="manage-container">
      <div class="manage-header">
        <h2>Master Tasks</h2>
        <button onclick="showCreateTaskForm()" class="btn-primary">+ Add Task</button>
      </div>
      
      <div id="create-task-form"></div>
      
      <div class="tasks-list">
        ${state.tasks.length === 0 ? 
          '<div class="empty-state">No tasks yet. Create your first task!</div>' :
          state.tasks.map(task => renderTaskItem(task)).join('')
        }
      </div>
    </div>
  </div>`;
}

function renderTaskItem(task) {
  const notePreview = task.note ? (task.note.split('\n')[0].substring(0, 50) + (task.note.length > 50 ? '...' : '')) : 'No notes';
  
  return `<div class="task-item" data-task-id="${task.id}" ondblclick="showEditTaskForm(${task.id})">
    <div class="task-item-content">
      <div class="task-item-name">${escapeHtml(task.name)}</div>
      <div class="task-item-note" onclick="event.stopPropagation(); toggleNoteExpand(${task.id})" id="note-${task.id}">
        ${escapeHtml(notePreview)}
      </div>
    </div>
  </div>`;
}

function showCreateTaskForm() {
  const container = document.getElementById('create-task-form');
  if (!container) return;
  
  container.innerHTML = `<div class="form-card">
    <h3>New Task</h3>
    <input type="text" id="new-task-name" placeholder="Task name" class="input-field" />
    <textarea id="new-task-note" placeholder="Notes (optional)" class="textarea-field" rows="5"></textarea>
    <div class="form-actions">
      <button onclick="submitCreateTask()" class="btn-primary">Create</button>
      <button onclick="cancelCreateTask()" class="btn-secondary">Cancel</button>
    </div>
  </div>`;
  
  document.getElementById('new-task-name').focus();
}

function submitCreateTask() {
  const name = document.getElementById('new-task-name').value;
  const note = document.getElementById('new-task-note').value;
  
  if (createTask(name, note)) {
    cancelCreateTask();
    render();
  }
}

function cancelCreateTask() {
  const container = document.getElementById('create-task-form');
  if (container) container.innerHTML = '';
}

function showEditTaskForm(taskId) {
  const task = getTaskById(taskId);
  if (!task) return;
  
  const taskEl = document.querySelector(`[data-task-id="${task.id}"]`);
  if (!taskEl) return;
  
  taskEl.innerHTML = `<div class="edit-form">
    <input type="text" id="edit-name-${taskId}" value="${escapeHtml(task.name)}" class="input-field" />
    <textarea id="edit-note-${taskId}" class="textarea-field" rows="5">${escapeHtml(task.note)}</textarea>
    <div class="form-actions">
      <button onclick="submitEditTask(${taskId})" class="btn-primary">Save</button>
      <button onclick="deleteTask(${taskId})" class="btn-danger">Delete</button>
      <button onclick="render()" class="btn-secondary">Cancel</button>
    </div>
  </div>`;
  
  document.getElementById(`edit-name-${taskId}`).focus();
}

function submitEditTask(taskId) {
  const name = document.getElementById(`edit-name-${taskId}`).value;
  const note = document.getElementById(`edit-note-${taskId}`).value;
  updateTask(taskId, name, note);
}

function toggleNoteExpand(taskId) {
  const noteEl = document.getElementById(`note-${taskId}`);
  const task = getTaskById(taskId);
  if (!noteEl || !task) return;
  
  if (noteEl.classList.contains('expanded')) {
    noteEl.classList.remove('expanded');
    const preview = task.note.split('\n')[0].substring(0, 50) + (task.note.length > 50 ? '...' : '');
    noteEl.textContent = preview || 'No notes';
  } else {
    noteEl.classList.add('expanded');
    noteEl.textContent = task.note || 'No notes';
  }
}

// ============================================================================
// RENDER - MANAGE SCREEN
// ============================================================================
function renderManageScreen() {
  const currentLoop = state.managingLoopKey || getActiveLoopKey();
  const loop = state.loops[currentLoop];
  
  const loopOptions = {
    'out': 'Out',
    'in-weekday': 'In - Weekday',
    'in-weekend': 'In - Weekend'
  };
  
  return `<div class="screen">
    <div class="manage-container">
      <div class="manage-header">
        <div class="loop-selector">
          <label>Loop:</label>
          <select onchange="changeManagingLoop(this.value)" class="select-field">
            ${Object.entries(loopOptions).map(([key, label]) => 
              `<option value="${key}" ${key === currentLoop ? 'selected' : ''}>${label}</option>`
            ).join('')}
          </select>
          <button onclick="showEditLoopNote('${currentLoop}')" class="btn-icon" title="Edit loop note">✏️</button>
        </div>
        <button onclick="showAddAssignmentForm('${currentLoop}')" class="btn-primary">+ Add Task</button>
      </div>
      
      <div id="edit-loop-note-form"></div>
      <div id="add-assignment-form"></div>
      
      <div class="tasks-list" id="assignments-list">
        ${loop.assignments.length === 0 ? 
          '<div class="empty-state">No tasks in this loop. Add one!</div>' :
          loop.assignments.map((a, idx) => renderAssignmentItem(currentLoop, a, idx)).join('')
        }
      </div>
      ${loop.assignments.length > 0 ? 
  `<div class="loop-actions">
    <button onclick="resetLoop('${currentLoop}')" class="btn-secondary">Reset All Progress</button>
  </div>` : ''
}
    </div>
  </div>`;
}

// ============================================================================
// RENDER - SETTINGS SCREEN
// ============================================================================
function renderSettingsScreen() {
  const hasToken = !!GITHUB_TOKEN;
  
  return `<div class="screen">
    <div class="manage-container">
      <div class="manage-header">
        <h2>Settings</h2>
      </div>
      
      <div class="form-card">
        <h3>🔄 Cloud Sync (GitHub Gist)</h3>
        <p style="color: #9ca3af; margin-bottom: 1rem; font-size: 0.875rem;">
          Sync your tasks across all devices using GitHub Gist. Your data stays private.
        </p>
        
        ${hasToken ? `
          <div style="padding: 1rem; background: #16a34a33; border-radius: 0.5rem; margin-bottom: 1rem;">
            <p style="color: #4ade80; font-weight: 600;">✅ Sync Enabled</p>
            <p style="color: #9ca3af; font-size: 0.875rem; margin-top: 0.5rem;">
              Your data syncs automatically to GitHub Gist.
            </p>
          </div>
          
<div style="padding: 0.75rem; background: #16a34a33; border-radius: 0.5rem; margin-bottom: 1rem;">
  <p style="color: #4ade80; font-size: 0.875rem;">
    🔄 Auto-syncing every 30 seconds<br>
    ✅ Syncs when you switch tabs<br>
    ✅ Syncs when you make changes
  </p>
</div>
<button onclick="removeToken()" class="btn-danger" style="width: 100%;">Disconnect & Clear Local Data</button>
        ` : `
          <div style="padding: 1rem; background: #dc262633; border-radius: 0.5rem; margin-bottom: 1rem;">
            <p style="color: #fca5a5; font-weight: 600;">⚠️ Sync Disabled</p>
            <p style="color: #9ca3af; font-size: 0.875rem; margin-top: 0.5rem;">
              Add your GitHub token to enable cloud sync.
            </p>
          </div>
          
          <div id="token-setup">
            <p style="color: #9ca3af; font-size: 0.875rem; margin-bottom: 1rem;">
              <strong>Setup Instructions:</strong><br>
              1. Go to <a href="https://github.com/settings/tokens" target="_blank" style="color: #4f46e5;">GitHub Settings</a><br>
              2. Click "Generate new token (classic)"<br>
              3. Name it "Focus Timer Sync"<br>
              4. Check only "gist" scope<br>
              5. Generate and copy the token<br>
              6. Paste it below:
            </p>
            
            <input type="password" id="github-token-input" placeholder="ghp_xxxxxxxxxxxx" class="input-field" />
            <button onclick="saveToken()" class="btn-primary" style="width: 100%;">Connect & Sync</button>
          </div>
        `}
      </div>
      
      <div class="form-card">
        <h3>📱 App Info</h3>
        <p style="color: #9ca3af; font-size: 0.875rem;">
          <strong>Version:</strong> 2.0<br>
          <strong>Tasks:</strong> ${state.tasks.length}<br>
          <strong>Loops:</strong> 3 (Out, In-Weekday, In-Weekend)
        </p>
      </div>

      <div class="form-card">
        <h3>💾 Backup & Restore</h3>
        <p style="color: #9ca3af; font-size: 0.875rem; margin-bottom: 1rem;">
          Download a complete backup of all your data (tasks, loops, progress).
        </p>
        <div style="display: flex; gap: 0.5rem;">
          <button onclick="exportAllData()" class="btn-primary">Export Backup</button>
          <button onclick="importAllData()" class="btn-secondary">Import Backup</button>
        </div>
      </div>
  
    </div>
  </div>`;
}

async function saveToken() {
  const input = document.getElementById('github-token-input');
  const token = input ? input.value.trim() : '';
  
  if (!token) {
    alert('Please enter a token');
    return;
  }
  
  if (!token.startsWith('ghp_') && !token.startsWith('github_pat_')) {
    alert('Invalid token format. GitHub tokens start with "ghp_" or "github_pat_"');
    return;
  }
  
  localStorage.setItem('github_token', token);
  GITHUB_TOKEN = token;
  
  // CRITICAL: Load from cloud first
  console.log('[TOKEN] Token saved, searching for existing data...');
  alert('🔍 Searching for your data...');
  
  const loaded = await loadFromGist();
  
  if (loaded) {
    alert('✅ Found your data! Reloading app...');
    setTimeout(() => location.reload(), 500);
  } else {
    // No cloud data, sync local data if we have any
    const hasLocalData = localStorage.getItem('masterTasks') && 
                        localStorage.getItem('masterTasks') !== 'null' &&
                        localStorage.getItem('masterTasks') !== '[]';
    
    if (hasLocalData) {
      alert('✅ Token saved! Syncing your data...');
      await syncToGist();
      alert('✅ Synced!');
    } else {
      alert('✅ Token saved! Start by adding tasks.');
    }
    
    render();
  }
}

function removeToken() {
  if (confirm('Disconnect? This will clear ALL local data. Your cloud data stays safe.')) {
    // Clear everything local
    localStorage.clear();
    GITHUB_TOKEN = null;
    GIST_ID = null;
    alert('✅ Disconnected. Reloading...');
    setTimeout(() => location.reload(), 500);
  }
}

function resetSync() {
  if (confirm('Reset sync connection? This will clear the gist link and create a new one on next save.')) {
    localStorage.removeItem('gist_id');
    GIST_ID = null;
    alert('✅ Sync reset! Next save will create a new gist.');
    syncToGist();
  }
}

async function forceSyncNow() {
  if (!GITHUB_TOKEN) {
    alert('❌ No token configured');
    return;
  }
  
  console.log('[MANUAL SYNC] Starting two-way sync...');
  alert('🔄 Syncing...');
  
  try {
    // First, check if cloud has newer data
    await loadFromGist();
    
    // Then, upload local changes if any
    await syncToGist();
    
    alert('✅ Sync complete! Reloading...');
    setTimeout(() => location.reload(), 500);
  } catch (err) {
    alert('❌ Sync failed: ' + err.message);
  }
}

function renderAssignmentItem(loopKey, assignment, index) {
  const task = getTaskById(assignment.taskId);
  if (!task) return '';
  
  const progress = Math.min((assignment.completed / assignment.duration) * 100, 100);
  const isComplete = assignment.completed >= assignment.duration;
  
  return `<div class="assignment-item" data-assignment-id="${assignment.id}" ondblclick="showEditAssignmentForm('${loopKey}', ${assignment.id})">
    <div class="drag-handle" style="touch-action: none;">⋮⋮</div>
    <div class="assignment-content">
      <div class="assignment-name">${escapeHtml(task.name)}</div>
      <div class="assignment-progress">
        ${formatTime(assignment.completed)} / ${formatDuration(assignment.duration)}
        <div class="progress-bar small">
          <div class="progress-fill" style="width: ${progress}%"></div>
        </div>
      </div>
    </div>
  </div>`;
}

function showEditLoopNote(loopKey) {
  const loop = state.loops[loopKey];
  const container = document.getElementById('edit-loop-note-form');
  if (!container) return;
  
  container.innerHTML = `<div class="form-card">
    <h3>Edit Loop Note</h3>
    <textarea id="edit-loop-note-text" class="textarea-field" rows="3" placeholder="Add a note for this loop...">${escapeHtml(loop.note)}</textarea>
    <div class="form-actions">
      <button onclick="submitLoopNote('${loopKey}')" class="btn-primary">Save</button>
      <button onclick="cancelLoopNoteEdit()" class="btn-secondary">Cancel</button>
    </div>
  </div>`;
  
  document.getElementById('edit-loop-note-text').focus();
}

function submitLoopNote(loopKey) {
  const note = document.getElementById('edit-loop-note-text').value;
  updateLoopNote(loopKey, note);
  cancelLoopNoteEdit();
}

function cancelLoopNoteEdit() {
  const container = document.getElementById('edit-loop-note-form');
  if (container) container.innerHTML = '';
}

function showAddAssignmentForm(loopKey) {
  const container = document.getElementById('add-assignment-form');
  if (!container) return;
  
  if (state.tasks.length === 0) {
    alert('No tasks available. Create tasks first on the Tasks screen.');
    return;
  }
  
  const durationOptions = [
    {value: 15, label: '15m'},
    {value: 30, label: '30m'},
    {value: 45, label: '45m'},
    {value: 60, label: '1h'},
    {value: 90, label: '1.5h'},
    {value: 120, label: '2h'},
    {value: 150, label: '2.5h'},
    {value: 180, label: '3h'},
    {value: 210, label: '3.5h'},
    {value: 240, label: '4h'}
  ];
  
  container.innerHTML = `<div class="form-card">
    <h3>Add Task to Loop</h3>
    <select id="add-task-select" class="select-field">
      <option value="">Select a task...</option>
      ${state.tasks.map(t => `<option value="${t.id}">${escapeHtml(t.name)}</option>`).join('')}
    </select>
    <select id="add-duration-select" class="select-field">
      ${durationOptions.map(opt => `<option value="${opt.value}">${opt.label}</option>`).join('')}
      <option value="custom">Custom...</option>
    </select>
    <input type="number" id="add-custom-duration" placeholder="Custom minutes" class="input-field" style="display: none;" step="0.5" />
    <div class="form-actions">
      <button onclick="submitAddAssignment('${loopKey}')" class="btn-primary">Add</button>
      <button onclick="cancelAddAssignment()" class="btn-secondary">Cancel</button>
    </div>
  </div>`;
  
  document.getElementById('add-duration-select').addEventListener('change', function() {
    const customInput = document.getElementById('add-custom-duration');
    customInput.style.display = this.value === 'custom' ? 'block' : 'none';
  });
}

function submitAddAssignment(loopKey) {
  const taskId = parseFloat(document.getElementById('add-task-select').value);
  const durationSelect = document.getElementById('add-duration-select').value;
  
  if (!taskId) {
    alert('Please select a task');
    return;
  }
  
  let duration;
  if (durationSelect === 'custom') {
    duration = document.getElementById('add-custom-duration').value;
  } else {
    duration = durationSelect;
  }
  
  addAssignmentToLoop(loopKey, taskId, duration);
  cancelAddAssignment();
}

function cancelAddAssignment() {
  const container = document.getElementById('add-assignment-form');
  if (container) container.innerHTML = '';
}

function showEditAssignmentForm(loopKey, assignmentId) {
  const assignment = getAssignmentById(loopKey, assignmentId);
  const task = getTaskById(assignment.taskId);
  if (!assignment || !task) return;
  
  const assignEl = document.querySelector(`[data-assignment-id="${assignmentId}"]`);
  if (!assignEl) return;
  
  const durationOptions = [
    {value: 15, label: '15m'},
    {value: 30, label: '30m'},
    {value: 45, label: '45m'},
    {value: 60, label: '1h'},
    {value: 90, label: '1.5h'},
    {value: 120, label: '2h'},
    {value: 150, label: '2.5h'},
    {value: 180, label: '3h'},
    {value: 210, label: '3.5h'},
    {value: 240, label: '4h'}
  ];
  
  const isComplete = assignment.completed >= assignment.duration;
  
  assignEl.innerHTML = `<div class="edit-form">
    <div class="edit-task-name">${escapeHtml(task.name)}</div>
    <select id="edit-duration-${assignmentId}" class="select-field">
      ${durationOptions.map(opt => 
        `<option value="${opt.value}" ${opt.value === assignment.duration ? 'selected' : ''}>${opt.label}</option>`
      ).join('')}
      <option value="custom" ${!durationOptions.find(o => o.value === assignment.duration) ? 'selected' : ''}>Custom...</option>
    </select>
    <input type="number" id="edit-custom-duration-${assignmentId}" placeholder="Custom minutes" class="input-field" 
           style="display: ${durationOptions.find(o => o.value === assignment.duration) ? 'none' : 'block'};" 
           step="0.5" value="${assignment.duration}" />
    <textarea id="edit-task-note-${assignmentId}" class="textarea-field" rows="5" placeholder="Task notes...">${escapeHtml(task.note)}</textarea>
    <div class="form-actions">
      <button onclick="submitEditAssignment('${loopKey}', ${assignmentId})" class="btn-primary">Save</button>
      ${!isComplete ? 
        `<button onclick="completeAssignment('${loopKey}', ${assignmentId})" class="btn-success">Complete</button>` : ''
      }
      ${assignment.completed > 0 ? 
        `<button onclick="resetAssignment('${loopKey}', ${assignmentId})" class="btn-warning">Reset</button>` : ''
      }
      <button onclick="deleteAssignment('${loopKey}', ${assignmentId})" class="btn-danger">Remove</button>
      <button onclick="render()" class="btn-secondary">Cancel</button>
    </div>
  </div>`;
  setTimeout(() => {
  const customInput = document.getElementById(`edit-custom-duration-${assignmentId}`);
  if (customInput) {
    let originalValue = customInput.value;
    
    customInput.addEventListener('focus', function() {
      originalValue = this.value;
      this.select(); // Select all on focus
    });
    
    customInput.addEventListener('keydown', function(e) {
      if (e.key === 'Escape') {
        this.value = originalValue;
        this.blur();
      }
    });
  }
  
  const noteArea = document.getElementById(`edit-task-note-${assignmentId}`);
  if (noteArea) {
    let originalNote = noteArea.value;
    
    noteArea.addEventListener('focus', function() {
      originalNote = this.value;
    });
    
    noteArea.addEventListener('keydown', function(e) {
      if (e.key === 'Escape') {
        this.value = originalNote;
        this.blur();
      }
    });
  }
}, 50);
  // Focus and select duration input
setTimeout(() => {
  const durationInput = document.getElementById(`edit-duration-${assignmentId}`);
  if (durationInput) {
    durationInput.addEventListener('change', function() {
      const customInput = document.getElementById(`edit-custom-duration-${assignmentId}`);
      customInput.style.display = this.value === 'custom' ? 'block' : 'none';
    });
  }
  
  const customInput = document.getElementById(`edit-custom-duration-${assignmentId}`);
  if (customInput && customInput.style.display !== 'none') {
    customInput.focus();
    customInput.select(); // Select all text
  }
}, 50);
}

function submitEditAssignment(loopKey, assignmentId) {
  const durationSelect = document.getElementById(`edit-duration-${assignmentId}`).value;
  const note = document.getElementById(`edit-task-note-${assignmentId}`).value;
  
  let duration;
  if (durationSelect === 'custom') {
    duration = document.getElementById(`edit-custom-duration-${assignmentId}`).value;
  } else {
    duration = durationSelect;
  }
  
  updateAssignment(loopKey, assignmentId, duration, note);
}

function changeManagingLoop(loopKey) {
  state.managingLoopKey = loopKey;
  render();
}

// ============================================================================
// RENDER - MAIN
// ============================================================================
function render() {
  if (state.isRendering) return;
  state.isRendering = true;
  
  try {
    const app = document.getElementById('app');
    if (!app) return;
    
let screenHtml = '';

if (state.showSettings) {
  screenHtml = renderSettingsScreen();
} else {
  switch (state.currentScreen) {
    case 'focus':
      screenHtml = renderFocusScreen();
      break;
    case 'tasks':
      screenHtml = renderTasksScreen();
      break;
    case 'manage':
      screenHtml = renderManageScreen();
      break;
  }
}
    
    const navHtml = `<nav class="bottom-nav">
  <button class="${!state.showSettings && state.currentScreen === 'tasks' ? 'active' : ''}" onclick="state.showSettings = false; switchScreen('tasks'); event.preventDefault();">Tasks</button>
  <button class="${!state.showSettings && state.currentScreen === 'focus' ? 'active' : ''}" onclick="state.showSettings = false; switchScreen('focus'); event.preventDefault();">Focus</button>
  <button class="${!state.showSettings && state.currentScreen === 'manage' ? 'active' : ''}" onclick="state.showSettings = false; switchScreen('manage'); event.preventDefault();">Manage</button>
  <button class="${state.showSettings ? 'active' : ''}" onclick="state.showSettings = !state.showSettings; render()" style="font-size: 1.25rem;">⚙️</button>
</nav>`;
    
    app.innerHTML = screenHtml + navHtml + '<div id="tooltip" class="tooltip"></div>';
    
    if (state.currentScreen === 'manage') {
      setupDragAndDrop();
    }
  } finally {
    state.isRendering = false;
  }
}

// ============================================================================
// UI INTERACTIONS
// ============================================================================
async function switchScreen(screen) {
  state.currentScreen = screen;
  if (screen === 'manage' && !state.managingLoopKey) {
    state.managingLoopKey = getActiveLoopKey();
  }
  
  // Check for cloud updates when switching screens
  if (GITHUB_TOKEN && !syncInProgress) {
    console.log('[APP] Screen switch, checking for updates...');
    const loaded = await loadFromGist();
    if (loaded) {
      console.log('[APP] ✅ Loaded updates on screen switch');
      // Reload state
      state.tasks = storage.load('masterTasks', []);
      state.loops = storage.load('loops', {
        'out': { note: '', assignments: [], currentIndex: 0 },
        'in-weekday': { note: '', assignments: [], currentIndex: 0 },
        'in-weekend': { note: '', assignments: [], currentIndex: 0 }
      });
      state.mode = storage.load('mode', 'in');
      const forceWeekendStr = localStorage.getItem('forceWeekend');
      state.forceWeekend = forceWeekendStr === 'true' ? true : forceWeekendStr === 'false' ? false : null;
    }
  }
  
  render();
}

function toggleMode() {
  stopTimer();
  state.isTimerRunning = false;
  state.mode = state.mode === 'in' ? 'out' : 'in';
  saveState();
  render();
}

function toggleForceWeekend() {
  if (state.mode === 'out') return;
  
  const currentLoop = getActiveLoopKey();
  const isCurrentlyWeekend = currentLoop === 'in-weekend';
  
  // Toggle to opposite
  state.forceWeekend = !isCurrentlyWeekend;
  
  console.log('[DEBUG] Toggling from', currentLoop, 'to', getActiveLoopKey());
  
  stopTimer();
  state.isTimerRunning = false;
  
  const newLoopKey = getActiveLoopKey();
  state.loops[newLoopKey].currentIndex = 0;
  
  saveState();
  render();
}

function showTooltip(event, text, isTouch = false) {
  const tooltip = document.getElementById('tooltip');
  if (!tooltip || !text) return;
  
  tooltip.textContent = text;
  tooltip.style.display = 'block';
  
  const x = event.clientX || (event.touches && event.touches[0].clientX) || 0;
  const y = event.clientY || (event.touches && event.touches[0].clientY) || 0;
  
  // Position above the touch point (minus tooltip height + offset)
  tooltip.style.left = Math.max(10, x - 100) + 'px'; // Center horizontally, with 10px min margin
  tooltip.style.top = Math.max(10, y - 80) + 'px'; // 80px above touch point
  
  if (isTouch) {
    event.preventDefault();
  }
}

function hideTooltip() {
  const tooltip = document.getElementById('tooltip');
  if (tooltip) tooltip.style.display = 'none';
}

async function testSyncNow() {
  console.log('[TEST] Forcing sync...');
  console.log('[TEST] GITHUB_TOKEN:', GITHUB_TOKEN ? 'EXISTS' : 'MISSING');
  console.log('[TEST] GIST_ID:', GIST_ID || 'None');
  
  if (!GITHUB_TOKEN) {
    alert('No token!');
    return;
  }
  
  try {
    await syncToGist();
    alert('Sync attempt complete. Check console for details.');
  } catch (err) {
    alert('Sync error: ' + err.message);
  }
}

function setupDragAndDrop() {
  const list = document.getElementById('assignments-list');
  if (!list) return;
  
  const loopKey = state.managingLoopKey || getActiveLoopKey();
  let draggedEl = null, draggedIdx = null, touchStartY = 0, touchCurrentY = 0, isDragging = false;
  
  list.querySelectorAll('[data-assignment-id]').forEach((el, idx) => {
    el.setAttribute('draggable', 'true');
    
    el.addEventListener('dragstart', e => { draggedEl = el; draggedIdx = idx; el.style.opacity = '0.5'; });
    el.addEventListener('dragend', e => { 
      el.style.opacity = '1'; 
      list.querySelectorAll('[data-assignment-id]').forEach(i => { i.style.borderTop = ''; i.style.borderBottom = ''; });
    });
    el.addEventListener('dragover', e => {
      e.preventDefault();
      if (draggedEl !== el) {
        const rect = el.getBoundingClientRect();
        el.style.borderTop = e.clientY < rect.y + rect.height / 2 ? '2px solid #6366f1' : '';
        el.style.borderBottom = e.clientY >= rect.y + rect.height / 2 ? '2px solid #6366f1' : '';
      }
    });
    el.addEventListener('drop', e => { 
      e.preventDefault(); 
      if (draggedEl !== el) moveAssignment(loopKey, draggedIdx, idx); 
    });
    
    const grip = el.querySelector('.drag-handle');
    if (grip) {
      grip.addEventListener('touchstart', e => {
        e.preventDefault();
        draggedEl = el; draggedIdx = idx; touchStartY = e.touches[0].clientY; isDragging = true;
        el.style.opacity = '0.7'; el.style.transform = 'scale(1.05)';
      }, { passive: false });
      
      grip.addEventListener('touchmove', e => {
        if (!isDragging) return;
        e.preventDefault();
        touchCurrentY = e.touches[0].clientY;
        el.style.transform = `translateY(${touchCurrentY - touchStartY}px) scale(1.05)`;
        
        Array.from(list.querySelectorAll('[data-assignment-id]')).forEach((item, i) => {
          if (item === el) return;
          const rect = item.getBoundingClientRect();
          if (touchCurrentY > rect.top && touchCurrentY < rect.bottom) {
            item.style.borderTop = i < draggedIdx ? '2px solid #6366f1' : '';
            item.style.borderBottom = i > draggedIdx ? '2px solid #6366f1' : '';
          } else {
            item.style.borderTop = ''; item.style.borderBottom = '';
          }
        });
      }, { passive: false });
      
      grip.addEventListener('touchend', e => {
        if (!isDragging) return;
        e.preventDefault();
        isDragging = false;
        
        let dropIdx = draggedIdx;
        Array.from(list.querySelectorAll('[data-assignment-id]')).forEach((item, i) => {
          const rect = item.getBoundingClientRect();
          if (touchCurrentY > rect.top && touchCurrentY < rect.bottom && i !== draggedIdx) dropIdx = i;
          item.style.borderTop = ''; item.style.borderBottom = '';
        });
        
        el.style.opacity = '1'; el.style.transform = '';
        if (dropIdx !== draggedIdx) moveAssignment(loopKey, draggedIdx, dropIdx);
        draggedEl = null;
      }, { passive: false });
    }
  });
}

// ============================================================================
// VISIBILITY CHANGE
// ============================================================================
document.addEventListener('visibilitychange', async () => {
  if (!document.hidden) {
    console.log('[APP] Tab visible, checking for updates...');
    
    // Check cloud for updates
    if (GITHUB_TOKEN) {
      const loaded = await loadFromGist();
      if (loaded) {
        console.log('[APP] ✅ Loaded updates from cloud');
        // Reload state from localStorage
        state.tasks = storage.load('masterTasks', []);
        state.loops = storage.load('loops', {
          'out': { note: '', assignments: [], currentIndex: 0 },
          'in-weekday': { note: '', assignments: [], currentIndex: 0 },
          'in-weekend': { note: '', assignments: [], currentIndex: 0 }
        });
        state.mode = storage.load('mode', 'in');
        const forceWeekendStr = localStorage.getItem('forceWeekend');
        state.forceWeekend = forceWeekendStr === 'true' ? true : forceWeekendStr === 'false' ? false : null;
      }
    }
    
    checkTimerOnLoad();
    if (state.isTimerRunning && !state.timerInterval) {
      console.log('[APP] Restarting timer...');
      startTimer();
    }
    render();
  } else {
    console.log('[APP] Tab hidden, pausing interval...');
    if (state.timerInterval) {
      clearInterval(state.timerInterval);
      state.timerInterval = null;
    }
  }
});

// Add this AFTER the visibilitychange handler:
window.addEventListener('focus', async () => {
  if (GITHUB_TOKEN && !syncInProgress) {
    console.log('[APP] Window focused, checking for updates...');
    const loaded = await loadFromGist();
    if (loaded) {
      console.log('[APP] ✅ Updates loaded');
      state.tasks = storage.load('masterTasks', []);
      state.loops = storage.load('loops', {
        'out': { note: '', assignments: [], currentIndex: 0 },
        'in-weekday': { note: '', assignments: [], currentIndex: 0 },
        'in-weekend': { note: '', assignments: [], currentIndex: 0 }
      });
      state.mode = storage.load('mode', 'in');
      const forceWeekendStr = localStorage.getItem('forceWeekend');
      state.forceWeekend = forceWeekendStr === 'true' ? true : forceWeekendStr === 'false' ? false : null;
      render();
    }
  }
});

// ============================================================================
// INIT
// ============================================================================
(async function init() {
  try {
    // Wake lock
    if ('wakeLock' in navigator) {
      try {
        const wakeLock = await navigator.wakeLock.request('screen');
        console.log('[APP] Wake lock acquired');
        
        wakeLock.addEventListener('release', async () => {
  if (!document.hidden) { // Only re-acquire if tab is visible
    try {
      await navigator.wakeLock.request('screen');
    } catch (e) {
      // Tab is hidden, that's fine
    }
  }
});
      } catch (err) {
        console.log('[APP] Wake lock not available:', err);
      }
    }
    
    await registerSW();
    
    // CRITICAL: Load from cloud FIRST, before anything else
    console.log('[APP] Loading from cloud...');
    const loadedFromCloud = await loadFromGist();
    
    if (loadedFromCloud) {
      console.log('[APP] ✅ Loaded from cloud, updating state...');
      
      // DEBUG: Log what's in localStorage
      console.log('[DEBUG] Raw localStorage data:', {
        masterTasks: localStorage.getItem('masterTasks'),
        loops: localStorage.getItem('loops'),
        mode: localStorage.getItem('mode')
      });
      
      // Parse the data that was just written to localStorage
      try {
        state.tasks = JSON.parse(localStorage.getItem('masterTasks') || '[]');
        
        const loopsData = localStorage.getItem('loops');
        if (loopsData && loopsData !== 'null') {
          try {
            state.loops = JSON.parse(loopsData);
          } catch (e) {
            console.error('[APP] Error parsing loops:', e);
            state.loops = null;
          }
        } else {
          state.loops = null;
        }
        
        // Validate loops structure
        if (!state.loops || !state.loops['out'] || !state.loops['in-weekday'] || !state.loops['in-weekend']) {
          console.warn('[APP] Invalid loops data, resetting to default');
          state.loops = {
            'out': { note: '', assignments: [], currentIndex: 0 },
            'in-weekday': { note: '', assignments: [], currentIndex: 0 },
            'in-weekend': { note: '', assignments: [], currentIndex: 0 }
          };
          saveState(); // Save the corrected structure
        }
        
        state.mode = localStorage.getItem('mode') || 'in';
        const forceWeekendStr = localStorage.getItem('forceWeekend');
        state.forceWeekend = forceWeekendStr === 'true' ? true : forceWeekendStr === 'false' ? false : null;
        state.timerStartTime = parseInt(localStorage.getItem('timerStartTime')) || null;
        state.activeTaskAssignmentId = parseFloat(localStorage.getItem('activeTaskAssignmentId')) || null;
        state.activeLoopKey = localStorage.getItem('activeLoopKey') || null;
        
        console.log('[APP] State updated from cloud:', {
          tasks: state.tasks.length,
          loops: Object.keys(state.loops),
          mode: state.mode,
          forceWeekend: state.forceWeekend
        });
      } catch (e) {
        console.error('[APP] Error parsing cloud data:', e);
      }
    } else {
      console.log('[APP] Using local data');
    }
    
    checkTimerOnLoad();
    
    if (state.isTimerRunning && !state.timerInterval) {
      console.log('[APP] Restarting timer...');
      startTimer();
    }
    
    render();
    
    // Periodic sync every 30 seconds
// Around line 1810, CHANGE interval to 15 seconds:
setInterval(async () => {
  if (!syncInProgress && !pendingSync && GITHUB_TOKEN && !document.hidden) {
    const loaded = await loadFromGist();
    if (loaded) {
      console.log('[APP] 🔄 Auto-sync: Updates loaded');
      state.tasks = storage.load('masterTasks', []);
      state.loops = storage.load('loops', {
        'out': { note: '', assignments: [], currentIndex: 0 },
        'in-weekday': { note: '', assignments: [], currentIndex: 0 },
        'in-weekend': { note: '', assignments: [], currentIndex: 0 }
      });
      state.mode = storage.load('mode', 'in');
      const forceWeekendStr = localStorage.getItem('forceWeekend');
      state.forceWeekend = forceWeekendStr === 'true' ? true : forceWeekendStr === 'false' ? false : null;
      
      // Show quick toast notification
      const toast = document.createElement('div');
      toast.textContent = '🔄 Synced';
      toast.style.cssText = 'position:fixed;top:20px;right:20px;background:#16a34a;color:white;padding:0.75rem 1rem;border-radius:0.5rem;z-index:9999;font-size:0.875rem;box-shadow:0 4px 6px rgba(0,0,0,0.3);';
      document.body.appendChild(toast);
      setTimeout(() => toast.remove(), 2000);
      
      render();
    }
    
    debouncedSync();
  }
}, 30000); // ✅ 15 seconds
    
  } catch (e) {
    console.error('[APP] Init error:', e);
    document.getElementById('app').innerHTML = `
      <div class="error-screen">
        <h2>Failed to initialize</h2>
        <p>${e.message}</p>
        <button onclick="location.reload()" class="btn-primary">Reload</button>
      </div>`;
  }
})();
