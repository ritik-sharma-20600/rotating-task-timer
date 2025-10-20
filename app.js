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
    return `<div class="min-h-screen bg-gray-900
