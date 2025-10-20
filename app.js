'use strict';

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

let audioContext = null;
let wakeLock = null;
let swReg = null;

const state = {
  tasks: [],
  currentTaskIndex: 0,
  isTimerRunning: false,
  showManageTasks: false,
  timerInterval: null,
  timerStartTime: null,
  activeTaskId: null,
  isRendering: false
};

function initState() {
  const defaultTasks = [
    { id: 1, name: 'Coding', allocated: 90, completed: 0 },
    { id: 2, name: 'Exercise', allocated: 30, completed: 0 },
    { id: 3, name: 'Reading', allocated: 45, completed: 0 }
  ];
  
  state.tasks = storage.load('focusTasks', defaultTasks);
  state.timerStartTime = storage.load('timerStartTime', null);
  state.activeTaskId = storage.load('activeTaskId', null);
  
  if (!Array.isArray(state.tasks) || state.tasks.length === 0) {
    state.tasks = defaultTasks;
  }
}

async function registerSW() {
  if ('serviceWorker' in navigator) {
    try {
      swReg = await navigator.serviceWorker.register('sw.js');
      console.log('[APP] SW registered');
      
      // Listen for messages from SW
      navigator.serviceWorker.addEventListener('message', function(event) {
        if (event.data.type === 'TASK_COMPLETE') {
          console.log('[APP] Received completion message from SW');
          playLocalSound();
        }
      });
      
      if (Notification.permission === 'default') {
        await Notification.requestPermission();
      }
    } catch (err) {
      console.error('[APP] SW registration failed:', err);
    }
  }
}

function scheduleSWAlarm(taskName, remainingMinutes) {
  if (!swReg || !swReg.active) {
    console.log('[APP] SW not ready');
    return;
  }
  
  const delayMs = remainingMinutes * 60 * 1000;
  console.log('[APP] Scheduling SW alarm:', taskName, remainingMinutes, 'min');
  
  swReg.active.postMessage({
    type: 'SCHEDULE_ALARM',
    taskName: taskName,
    delay: delayMs
  });
}

function cancelSWAlarm() {
  if (swReg && swReg.active) {
    swReg.active.postMessage({ type: 'CANCEL_ALARM' });
  }
}

function playLocalSound() {
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
      gain.gain.setValueAtTime(1.0, start);
      gain.gain.exponentialRampToValueAtTime(0.01, start + dur);
      osc.start(start);
      osc.stop(start + dur);
    }
    
    const now = audioContext.currentTime;
    beep(now, 600, 0.4);
    beep(now + 0.45, 800, 0.4);
    beep(now + 0.9, 1000, 0.4);
    beep(now + 1.35, 1200, 0.5);
    
    if ('vibrate' in navigator) {
      navigator.vibrate([300, 100, 300, 100, 300]);
    }
  } catch (e) {
    console.error('Sound error:', e);
  }
}

function getIncompleteTasks() {
  return state.tasks.filter(t => t && t.completed < t.allocated);
}

function formatTime(minutes) {
  if (typeof minutes !== 'number' || isNaN(minutes)) return '0m';
  const hrs = Math.floor(minutes / 60);
  const mins = Math.floor(minutes % 60);
  return hrs > 0 ? `${hrs}h ${mins}m` : `${mins}m`;
}

function startTimer() {
  if (state.timerInterval) return;
  
  const incompleteTasks = getIncompleteTasks();
  if (incompleteTasks.length === 0) return;
  
  const currentTask = incompleteTasks[state.currentTaskIndex];
  if (!currentTask) return;
  
  state.timerStartTime = Date.now();
  state.activeTaskId = currentTask.id;
  storage.save('timerStartTime', state.timerStartTime);
  storage.save('activeTaskId', state.activeTaskId);
  
  const remaining = currentTask.allocated - currentTask.completed;
  scheduleSWAlarm(currentTask.name, remaining);
  
  state.timerInterval = setInterval(() => {
    if (!state.timerStartTime || !state.activeTaskId) {
      stopTimer();
      return;
    }
    
    const now = Date.now();
    const elapsed = (now - state.timerStartTime) / 60000;
    
    const idx = state.tasks.findIndex(t => t && t.id === state.activeTaskId);
    if (idx !== -1 && state.tasks[idx]) {
      state.tasks[idx].completed = Math.min(
        state.tasks[idx].completed + elapsed,
        state.tasks[idx].allocated
      );
      state.timerStartTime = now;
      storage.save('focusTasks', state.tasks);
      storage.save('timerStartTime', state.timerStartTime);
      render();
      
      if (state.tasks[idx].completed >= state.tasks[idx].allocated) {
        stopTimer();
        state.isTimerRunning = false;
        playLocalSound();
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
  state.activeTaskId = null;
  cancelSWAlarm();
  storage.save('timerStartTime', null);
  storage.save('activeTaskId', null);
}

function toggleTimer() {
  state.isTimerRunning = !state.isTimerRunning;
  state.isTimerRunning ? startTimer() : stopTimer();
  render();
}

function nextTask() {
  stopTimer();
  state.isTimerRunning = false;
  const incomplete = getIncompleteTasks();
  if (incomplete.length > 0) {
    state.currentTaskIndex = (state.currentTaskIndex + 1) % incomplete.length;
  }
  render();
}

function selectTask(index) {
  stopTimer();
  state.isTimerRunning = false;
  state.currentTaskIndex = index;
  render();
}

function resetAllTasks() {
  stopTimer();
  state.tasks = state.tasks.map(t => ({ ...t, completed: 0 }));
  state.currentTaskIndex = 0;
  state.isTimerRunning = false;
  storage.save('focusTasks', state.tasks);
  render();
}

function validateMinutes(value) {
  const num = parseFloat(value);
  return (isNaN(num) || num <= 0) ? null : Math.max(0.5, Math.round(num * 2) / 2);
}

function addTask(name, allocated) {
  const time = validateMinutes(allocated);
  if (!name || !name.trim()) {
    alert('Task name cannot be empty');
    return false;
  }
  if (time === null) {
    alert('Please enter valid time (> 0)');
    return false;
  }
  state.tasks.push({
    id: Date.now() + Math.random(),
    name: name.trim(),
    allocated: time,
    completed: 0
  });
  storage.save('focusTasks', state.tasks);
  render();
  return true;
}

function deleteTask(id) {
  const task = state.tasks.find(t => t && t.id === id);
  if (!task || !confirm(`Delete "${task.name}"?`)) return;
  
  state.tasks = state.tasks.filter(t => t && t.id !== id);
  if (state.activeTaskId === id) {
    stopTimer();
    state.isTimerRunning = false;
  }
  storage.save('focusTasks', state.tasks);
  render();
}

function updateTask(id, name, allocated) {
  const time = validateMinutes(allocated);
  if (!name || !name.trim()) {
    alert('Task name cannot be empty');
    return;
  }
  if (time === null) {
    alert('Please enter valid time (> 0)');
    return;
  }
  const idx = state.tasks.findIndex(t => t && t.id === id);
  if (idx !== -1) {
    state.tasks[idx].name = name.trim();
    state.tasks[idx].allocated = time;
    state.tasks[idx].completed = Math.min(state.tasks[idx].completed, time);
    storage.save('focusTasks', state.tasks);
    render();
  }
}

function completeTask(id) {
  const idx = state.tasks.findIndex(t => t && t.id === id);
  if (idx !== -1) {
    state.tasks[idx].completed = state.tasks[idx].allocated;
    storage.save('focusTasks', state.tasks);
    if (getIncompleteTasks().length === 0) {
      playLocalSound();
      state.showManageTasks = false;
    }
    render();
  }
}

function resetTask(id) {
  const idx = state.tasks.findIndex(t => t && t.id === id);
  if (idx !== -1) {
    state.tasks[idx].completed = 0;
    storage.save('focusTasks', state.tasks);
    render();
  }
}

function moveTask(from, to) {
  if (from < 0 || from >= state.tasks.length || to < 0 || to >= state.tasks.length || from === to) return;
  const task = state.tasks.splice(from, 1)[0];
  state.tasks.splice(to, 0, task);
  storage.save('focusTasks', state.tasks);
  render();
}

function exportTasks() {
  try {
    if (state.tasks.length === 0) {
      alert('No tasks to export');
      return;
    }
    const blob = new Blob([JSON.stringify(state.tasks, null, 2)], {type: 'application/json'});
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `focus-tasks-${new Date().toISOString().split('T')[0]}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 100);
  } catch (err) {
    alert('Export error: ' + err.message);
  }
}

function importTasks() {
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
        if (!Array.isArray(imported) || imported.length === 0) {
          alert('Invalid file');
          return;
        }
        if (confirm(`Replace ${state.tasks.length} tasks with ${imported.length} imported tasks?`)) {
          stopTimer();
          state.isTimerRunning = false;
          state.currentTaskIndex = 0;
          state.tasks = imported;
          storage.save('focusTasks', state.tasks);
          render();
          alert('Import successful!');
        }
      } catch (err) {
        alert('Error: ' + err.message);
      }
    };
    reader.readAsText(file);
  };
  input.click();
}

function checkTimerOnLoad() {
  if (state.timerStartTime && state.activeTaskId) {
    const elapsed = (Date.now() - state.timerStartTime) / 60000;
    const idx = state.tasks.findIndex(t => t && t.id === state.activeTaskId);
    
    if (idx !== -1) {
      state.tasks[idx].completed = Math.min(
        state.tasks[idx].completed + elapsed,
        state.tasks[idx].allocated
      );
      storage.save('focusTasks', state.tasks);
      
      if (state.tasks[idx].completed >= state.tasks[idx].allocated) {
        state.timerStartTime = null;
        state.activeTaskId = null;
        state.isTimerRunning = false;
        storage.save('timerStartTime', null);
        storage.save('activeTaskId', null);
        playLocalSound();
      } else {
        state.isTimerRunning = true;
        state.timerStartTime = Date.now();
        storage.save('timerStartTime', state.timerStartTime);
      }
    }
  }
}

function escapeHtml(text) {
  const map = {'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;'};
  return String(text).replace(/[&<>"']/g, m => map[m]);
}

function renderTimerView() {
  const incomplete = getIncompleteTasks();
  
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

  if (state.currentTaskIndex >= incomplete.length) state.currentTaskIndex = 0;
  const task = incomplete[state.currentTaskIndex];
  if (!task) return '<div class="min-h-screen bg-gray-900"></div>';

  const progress = Math.min((task.completed / task.allocated) * 100, 100);
  const taskNum = incomplete.findIndex(t => t.id === task.id) + 1;

  return `<div class="min-h-screen bg-gray-900 flex flex-col">
    <div class="flex-1 flex items-center justify-center p-4">
      <div class="bg-gray-800 rounded-3xl shadow-2xl p-8 max-w-md w-full">
        <div class="text-center mb-8">
          <div class="inline-block bg-indigo-900 text-indigo-300 px-4 py-1 rounded-full text-sm font-medium mb-4">
            Task ${taskNum} of ${incomplete.length}
          </div>
          <h1 class="text-4xl font-bold text-white mb-2">${escapeHtml(task.name)}</h1>
          <div class="text-gray-400 text-lg">${formatTime(task.completed)} / ${formatTime(task.allocated)}</div>
        </div>
        <div class="mb-8">
          <div class="bg-gray-700 rounded-full h-4 overflow-hidden">
            <div class="bg-gradient-to-r h-full transition-all" style="width: ${progress}%; transition-duration: 1000ms;"></div>
          </div>
        </div>
        <div class="flex gap-3 mb-6">
          <button onclick="toggleTimer()" class="flex-1 flex items-center justify-center gap-2 py-4 rounded-2xl font-semibold text-lg transition-all ${state.isTimerRunning ? 'bg-red-600' : 'bg-indigo-600'} text-white">
            ${state.isTimerRunning ? 
              '<svg class="w-6 h-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="6" y="4" width="4" height="16"></rect><rect x="14" y="4" width="4" height="16"></rect></svg> Pause' :
              '<svg class="w-6 h-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="5 3 19 12 5 21 5 3"></polygon></svg> Start'
            }
          </button>
          ${incomplete.length > 1 ? 
            '<button onclick="nextTask()" class="px-6 py-4 bg-gray-700 rounded-2xl transition-colors text-white"><svg class="w-6 h-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="5 4 15 12 5 20 5 4"></polygon><line x1="19" y1="5" x2="19" y2="19"></line></svg></button>' : ''
          }
        </div>
        ${incomplete.length > 1 ? 
          '<div class="flex gap-2 justify-center mb-6">' +
            incomplete.map((t, idx) => 
              `<button onclick="selectTask(${idx})" class="h-2 rounded-full transition-all ${idx === state.currentTaskIndex ? 'bg-indigo-500 w-8' : 'bg-gray-600 w-2'}"></button>`
            ).join('') +
          '</div>' : ''
        }
        <button onclick="state.showManageTasks = true; render()" class="w-full flex items-center justify-center gap-2 bg-gray-700 text-white py-3 rounded-2xl transition-colors font-medium">
          <svg class="w-6 h-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="8" y1="6" x2="21" y2="6"></line><line x1="8" y1="12" x2="21" y2="12"></line><line x1="8" y1="18" x2="21" y2="18"></line><line x1="3" y1="6" x2="3.01" y2="6"></line><line x1="3" y1="12" x2="3.01" y2="12"></line><line x1="3" y1="18" x2="3.01" y2="18"></line></svg>
          Manage Tasks
        </button>
      </div>
    </div>
  </div>`;
}

function renderManageView() {
  return `<div class="min-h-screen bg-gray-900 p-4 no-scrollbar" style="overflow-y: auto;">
    <div class="max-w-md mx-auto">
      <div class="flex items-center gap-3 mb-6">
        <button onclick="state.showManageTasks = false; render()" class="p-2 bg-gray-800 rounded-lg text-white transition-colors">
          <svg class="w-6 h-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="19" y1="12" x2="5" y2="12"></line><polyline points="12 19 5 12 12 5"></polyline></svg>
        </button>
        <h2 class="text-2xl font-bold text-white flex-1">Manage Tasks</h2>
        <button onclick="exportTasks()" class="p-2 bg-gray-700 rounded-lg text-white transition-colors" title="Export">
          <svg class="w-6 h-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="7 10 12 15 17 10"></polyline><line x1="12" y1="15" x2="12" y2="3"></line></svg>
        </button>
        <button onclick="importTasks()" class="p-2 bg-gray-700 rounded-lg text-white transition-colors" title="Import">
          <svg class="w-6 h-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="17 8 12 3 7 8"></polyline><line x1="12" y1="3" x2="12" y2="15"></line></svg>
        </button>
        <button onclick="showAddForm()" class="p-2 bg-indigo-600 rounded-lg text-white transition-colors">
          <svg class="w-6 h-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line></svg>
        </button>
      </div>
      <div id="add-form-container"></div>
      <div class="space-y-3" id="tasks-list">
        ${state.tasks.map((t, idx) => {
          if (!t) return '';
          const progress = Math.min((t.completed / t.allocated) * 100, 100);
          const isComplete = t.completed >= t.allocated;
          return `<div class="bg-gray-800 rounded-2xl p-4" data-task-id="${t.id}">
            <div class="flex items-center gap-3">
              <div class="text-gray-500 cursor-move" style="touch-action: none;">
                <svg class="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="9" cy="5" r="1"></circle><circle cx="9" cy="12" r="1"></circle><circle cx="9" cy="19" r="1"></circle><circle cx="15" cy="5" r="1"></circle><circle cx="15" cy="12" r="1"></circle><circle cx="15" cy="19" r="1"></circle></svg>
              </div>
              <div class="flex-1 cursor-pointer" onclick="showEditForm(${t.id}, '${escapeHtml(t.name).replace(/'/g, "\\'")}', ${t.allocated})">
                <div class="text-white font-medium mb-1">${escapeHtml(t.name)}</div>
                <div class="text-sm text-gray-400">${formatTime(t.completed)} / ${formatTime(t.allocated)}</div>
                <div class="bg-gray-700 rounded-full h-1.5 mt-2 overflow-hidden">
                  <div class="bg-indigo-500 h-full transition-all" style="width: ${progress}%"></div>
                </div>
              </div>
              <div class="flex flex-col gap-1">
                ${!isComplete ? `<button onclick="completeTask(${t.id})" class="p-1.5 bg-green-600 rounded-lg text-white transition-colors" title="Complete"><svg class="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20 6 9 17 4 12"></polyline></svg></button>` : ''}
                ${t.completed > 0 ? `<button onclick="resetTask(${t.id})" class="p-1.5 bg-yellow-600 rounded-lg text-white transition-colors" title="Reset"><svg class="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="23 4 23 10 17 10"></polyline><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"></path></svg></button>` : ''}
                <button onclick="deleteTask(${t.id})" class="p-1.5 bg-red-600 rounded-lg text-white transition-colors" title="Delete"><svg class="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg></button>
              </div>
            </div>
          </div>`;
        }).join('')}
      </div>
    </div>
  </div>`;
}

function showAddForm() {
  const c = document.getElementById('add-form-container');
  if (!c) return;
  c.innerHTML = `<div class="bg-gray-800 rounded-2xl p-4 mb-4">
    <input type="text" id="new-task-name" placeholder="Task name" class="w-full px-4 py-3 bg-gray-700 border border-gray-600 rounded-lg text-white mb-2" style="color: white;">
    <div class="flex gap-2 mb-2">
      <button onclick="document.getElementById('new-task-time').value=15" class="flex-1 px-3 py-2 bg-gray-700 text-white rounded-lg text-sm">15m</button>
      <button onclick="document.getElementById('new-task-time').value=30" class="flex-1 px-3 py-2 bg-gray-700 text-white rounded-lg text-sm">30m</button>
      <button onclick="document.getElementById('new-task-time').value=60" class="flex-1 px-3 py-2 bg-gray-700 text-white rounded-lg text-sm">1h</button>
      <button onclick="document.getElementById('new-task-time').value=90" class="flex-1 px-3 py-2 bg-gray-700 text-white rounded-lg text-sm">1.5h</button>
    </div>
    <div class="flex gap-2">
      <input type="number" step="0.5" id="new-task-time" placeholder="Minutes" class="flex-1 px-4 py-3 bg-gray-700 border border-gray-600 rounded-lg text-white" style="color: white;">
      <button onclick="submitAddForm()" class="px-6 bg-indigo-600 text-white rounded-lg font-medium">Add</button>
      <button onclick="document.getElementById('add-form-container').innerHTML=''" class="px-4 bg-gray-700 text-white rounded-lg">✕</button>
    </div>
  </div>`;
  document.getElementById('new-task-name').focus();
}

function submitAddForm() {
  const name = document.getElementById('new-task-name').value;
  const time = document.getElementById('new-task-time').value;
  if (addTask(name, time)) {
    document.getElementById('add-form-container').innerHTML = '';
  }
}

function showEditForm(id, name, allocated) {
  const el = document.querySelector(`[data-task-id="${id}"]`);
  if (!el) return;
  el.innerHTML = `<div>
    <input type="text" id="edit-name-${id}" value="${name}" class="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-lg text-white mb-2" style="color: white;">
    <div class="flex gap-2">
      <input type="number" step="0.5" id="edit-time-${id}" value="${allocated}" class="flex-1 px-3 py-2 bg-gray-700 border border-gray-600 rounded-lg text-white" style="color: white;">
      <button onclick="updateTask(${id}, document.getElementById('edit-name-${id}').value, document.getElementById('edit-time-${id}').value)" class="px-4 bg-indigo-600 text-white rounded-lg text-sm">Save</button>
      <button onclick="render()" class="px-4 bg-gray-700 text-white rounded-lg text-sm">Cancel</button>
    </div>
  </div>`;
  document.getElementById(`edit-name-${id}`).focus();
}

function render() {
  if (state.isRendering) return;
  state.isRendering = true;
  
  try {
    const app = document.getElementById('app');
    if (!app) return;
    
    app.innerHTML = state.showManageTasks ? renderManageView() : renderTimerView();
    
    if (state.showManageTasks) {
      setupDragAndDrop();
    }
  } finally {
    state.isRendering = false;
  }
}

function setupDragAndDrop() {
  const list = document.getElementById('tasks-list');
  if (!list) return;

  let draggedEl = null, draggedIdx = null, touchStartY = 0, touchCurrentY = 0, isDragging = false;

  list.querySelectorAll('[data-task-id]').forEach((el, idx) => {
    el.setAttribute('draggable', 'true');
    
    el.addEventListener('dragstart', e => { draggedEl = el; draggedIdx = idx; el.style.opacity = '0.5'; });
    el.addEventListener('dragend', e => { el.style.opacity = '1'; list.querySelectorAll('[data-task-id]').forEach(i => { i.style.borderTop = ''; i.style.borderBottom = ''; }); });
    el.addEventListener('dragover', e => {
      e.preventDefault();
      if (draggedEl !== el) {
        const rect = el.getBoundingClientRect();
        el.style.borderTop = e.clientY < rect.y + rect.height / 2 ? '2px solid #6366f1' : '';
        el.style.borderBottom = e.clientY >= rect.y + rect.height / 2 ? '2px solid #6366f1' : '';
      }
    });
    el.addEventListener('drop', e => { e.preventDefault(); if (draggedEl !== el) moveTask(draggedIdx, idx); });

    const grip = el.querySelector('.cursor-move');
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
        
        Array.from(list.querySelectorAll('[data-task-id]')).forEach((item, i) => {
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
        Array.from(list.querySelectorAll('[data-task-id]')).forEach((item, i) => {
          const rect = item.getBoundingClientRect();
          if (touchCurrentY > rect.top && touchCurrentY < rect.bottom && i !== draggedIdx) dropIdx = i;
          item.style.borderTop = ''; item.style.borderBottom = '';
        });
        
        el.style.opacity = '1'; el.style.transform = '';
        if (dropIdx !== draggedIdx) moveTask(draggedIdx, dropIdx);
        draggedEl = null;
      }, { passive: false });
    }
  });
}

document.addEventListener('visibilitychange', () => {
  if (!document.hidden) {
    checkTimerOnLoad();
    if (state.isTimerRunning) startTimer();
    render();
  } else if (state.timerInterval) {
    clearInterval(state.timerInterval);
    state.timerInterval = null;
  }
});

(async function init() {
  try {
    await registerSW();
    initState();
    checkTimerOnLoad();
    if (state.isTimerRunning) startTimer();
    render();
  } catch (e) {
    console.error('Init error:', e);
    document.getElementById('app').innerHTML = '<div class="min-h-screen bg-gray-900 flex items-center justify-center p-4"><div class="bg-gray-800 rounded-2xl p-8 text-center"><p class="text-white mb-4">Failed to initialize</p><button onclick="location.reload()" class="bg-indigo-600 text-white px-6 py-3 rounded-lg">Reload</button></div></div>';
  }
})();
