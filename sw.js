
// sw.js - Service Worker for Background Timer
'use strict';

let scheduledAlarm = null;

// Listen for messages from the main app
self.addEventListener('message', function(event) {
  const data = event.data;
  
  if (data.type === 'SCHEDULE_ALARM') {
    const delay = data.delay;
    const taskName = data.taskName;
    
    console.log('[SW] Scheduling alarm for', taskName, 'in', delay / 1000, 'seconds');
    
    if (scheduledAlarm) {
      clearTimeout(scheduledAlarm);
    }
    
    scheduledAlarm = setTimeout(function() {
      console.log('[SW] ⏰ ALARM TRIGGERED for', taskName);
      
      // Show notification with system sound
      self.registration.showNotification('🎉 Task Complete!', {
        body: '✅ ' + taskName + ' is done!\nTime to move on to the next task.',
        icon: 'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"%3E%3Crect fill="%2316a34a" width="100" height="100"/%3E%3Ctext x="50" y="75" font-size="70" text-anchor="middle" fill="white"%3E✓%3C/text%3E%3C/svg%3E',
        tag: 'task-complete-' + Date.now(),
        requireInteraction: true,
        vibrate: [300, 100, 300, 100, 300, 100, 300],
        silent: false, // Use system notification sound
        renotify: true,
        actions: [
          {
            action: 'view',
            title: '👁️ View App'
          }
        ],
        data: {
          taskName: taskName,
          timestamp: Date.now(),
          url: self.registration.scope
        }
      });
      
      // Try to play additional audio through all clients
      self.clients.matchAll().then(function(clients) {
        clients.forEach(function(client) {
          client.postMessage({
            type: 'TASK_COMPLETE',
            taskName: taskName
          });
        });
      });
      
      scheduledAlarm = null;
    }, delay);
    
  } else if (data.type === 'CANCEL_ALARM') {
    console.log('[SW] Cancelling alarm');
    if (scheduledAlarm) {
      clearTimeout(scheduledAlarm);
      scheduledAlarm = null;
    }
  } else if (data.type === 'PING') {
    console.log('[SW] Received ping, responding...');
    event.source.postMessage({ type: 'PONG' });
  }
});

// Handle notification clicks
self.addEventListener('notificationclick', function(event) {
  console.log('[SW] Notification clicked');
  event.notification.close();
  
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function(clientList) {
      // Try to focus existing window
      for (let i = 0; i < clientList.length; i++) {
        const client = clientList[i];
        if ('focus' in client) {
          return client.focus();
        }
      }
      // Open new window if none exist
      if (self.clients.openWindow) {
        return self.clients.openWindow(event.notification.data.url || '/');
      }
    })
  );
});

self.addEventListener('install', function(event) {
  console.log('[SW] Installing...');
  self.skipWaiting();
});

self.addEventListener('activate', function(event) {
  console.log('[SW] Activating...');
  event.waitUntil(self.clients.claim());
});
