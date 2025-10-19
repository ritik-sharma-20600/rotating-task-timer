// Rotating Task Timer - Flutter app
// Replace the project's lib/main.dart with this file. Also copy the pubspec.yaml content below.

/*
pubspec.yaml (copy into your project's pubspec.yaml - paste the dependencies section)

name: rotating_task_timer
description: A local-first rotating task timer.
publish_to: 'none'
version: 0.1.0

environment:
  sdk: ">=2.18.0 <4.0.0"

dependencies:
  flutter:
    sdk: flutter
  cupertino_icons: ^1.0.2
  shared_preferences: ^2.1.1
  flutter_local_notifications: ^12.0.4
  uuid: ^3.0.7

flutter:
  uses-material-design: true

# End of pubspec.yaml
*/

import 'dart:async';
import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:uuid/uuid.dart';
import 'package:flutter_local_notifications/flutter_local_notifications.dart';

const STORAGE_KEY = 'rotating_tasks_v1';

final FlutterLocalNotificationsPlugin flutterLocalNotificationsPlugin =
    FlutterLocalNotificationsPlugin();

void main() async {
  WidgetsFlutterBinding.ensureInitialized();

  // Initialize local notifications (basic Android + iOS setup)
  const AndroidInitializationSettings initializationSettingsAndroid =
      AndroidInitializationSettings('@mipmap/ic_launcher');
  final InitializationSettings initializationSettings = InitializationSettings(
    android: initializationSettingsAndroid,
    iOS: null,
    macOS: null,
  );
  await flutterLocalNotificationsPlugin.initialize(initializationSettings);

  runApp(MyApp());
}

class Task {
  String id;
  String title;
  int targetMin; // minutes
  int completedSec; // seconds
  bool done;

  Task({
    required this.id,
    required this.title,
    required this.targetMin,
    this.completedSec = 0,
    this.done = false,
  });

  factory Task.fromJson(Map<String, dynamic> j) => Task(
        id: j['id'],
        title: j['title'],
        targetMin: j['targetMin'],
        completedSec: j['completedSec'] ?? 0,
        done: j['done'] ?? false,
      );

  Map<String, dynamic> toJson() => {
        'id': id,
        'title': title,
        'targetMin': targetMin,
        'completedSec': completedSec,
        'done': done,
      };
}

class MyApp extends StatelessWidget {
  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      title: 'Rotating Task Timer',
      theme: ThemeData(
        primarySwatch: Colors.indigo,
      ),
      home: RotatingTimerHome(),
    );
  }
}

class RotatingTimerHome extends StatefulWidget {
  @override
  _RotatingTimerHomeState createState() => _RotatingTimerHomeState();
}

class _RotatingTimerHomeState extends State<RotatingTimerHome> {
  List<Task> tasks = [];
  String? currentTaskId;

  Timer? _ticker;
  DateTime? runningSince;

  final uuid = Uuid();

  @override
  void initState() {
    super.initState();
    _loadTasks();
  }

  Future<void> _loadTasks() async {
    final sp = await SharedPreferences.getInstance();
    final raw = sp.getString(STORAGE_KEY);
    if (raw != null) {
      try {
        final arr = jsonDecode(raw) as List;
        tasks = arr.map((e) => Task.fromJson(e)).toList();
      } catch (e) {
        tasks = _sampleTasks();
      }
    } else {
      tasks = _sampleTasks();
    }

    // pick first incomplete
    final first = tasks.firstWhere((t) => !t.done, orElse: () => tasks.isNotEmpty ? tasks[0] : Task(id: uuid.v4(), title: 'New', targetMin: 25));
    currentTaskId = first.id;
    setState(() {});
  }

  List<Task> _sampleTasks() => [
        Task(id: uuid.v4(), title: 'Coding', targetMin: 90, completedSec: 60 * 60),
        Task(id: uuid.v4(), title: 'Reading', targetMin: 45),
        Task(id: uuid.v4(), title: 'Cleaning', targetMin: 30),
      ];

  Future<void> _saveTasks() async {
    final sp = await SharedPreferences.getInstance();
    await sp.setString(STORAGE_KEY, jsonEncode(tasks.map((t) => t.toJson()).toList()));
  }

  Task? get currentTask => tasks.firstWhere((t) => t.id == currentTaskId && !t.done, orElse: () => tasks.firstWhere((t) => !t.done, orElse: () => tasks.isNotEmpty ? tasks[0] : null as Task));

  int displayedSecondsFor(Task t) {
    var base = t.completedSec;
    if (runningSince != null && currentTask != null && t.id == currentTask!.id) {
      base += DateTime.now().difference(runningSince!).inSeconds;
    }
    return base;
  }

  void _startTimer() {
    if (runningSince != null) return;
    runningSince = DateTime.now();
    _ticker = Timer.periodic(Duration(seconds: 1), (_) {
      setState(() {});
      // check for completion
      _checkAndMarkDone();
    });
  }

  void _pauseTimer() {
    if (runningSince == null) return;
    final elapsed = DateTime.now().difference(runningSince!).inSeconds;
    runningSince = null;
    _ticker?.cancel();
    _ticker = null;
    if (currentTask != null) {
      setState(() {
        currentTask!.completedSec += elapsed;
      });
      _saveTasks();
      _checkAndMarkDone();
    }
  }

  void _checkAndMarkDone() {
    bool changed = false;
    for (var t in tasks) {
      if (!t.done && (t.completedSec + (runningSince != null && currentTask != null && t.id == currentTask!.id ? DateTime.now().difference(runningSince!).inSeconds : 0)) >= t.targetMin * 60) {
        t.done = true;
        changed = true;
        _notifyTaskCompleted(t);
      }
    }
    if (changed) {
      _saveTasks();
      // if all done - reset after short delay so user sees it
      if (tasks.every((t) => t.done)) {
        Future.delayed(Duration(seconds: 1), () {
          _resetAllTasks();
        });
      }
    }
  }

  Future<void> _notifyTaskCompleted(Task t) async {
    const androidDetails = AndroidNotificationDetails('rotating-task', 'Rotating Task Timer', 'Notifications for task completion', importance: Importance.high, priority: Priority.high);
    final platform = NotificationDetails(android: androidDetails);
    await flutterLocalNotificationsPlugin.show(
      t.hashCode,
      'Task complete',
      '${t.title} reached its target (${t.targetMin} min)',
      platform,
    );
  }

  void _nextTask() {
    _pauseTimer();
    if (tasks.isEmpty) return;
    final idx = tasks.indexWhere((t) => t.id == currentTaskId);
    final n = tasks.length;
    for (int delta = 1; delta <= n; delta++) {
      final cand = tasks[(idx + delta) % n];
      if (!cand.done) {
        setState(() {
          currentTaskId = cand.id;
        });
        return;
      }
    }
  }

  void _toggleDone(String id) {
    final t = tasks.firstWhere((x) => x.id == id);
    setState(() {
      t.done = !t.done;
    });
    _saveTasks();
  }

  void _addTask(String title, int mins) {
    final t = Task(id: uuid.v4(), title: title, targetMin: mins);
    setState(() {
      tasks.add(t);
    });
    _saveTasks();
  }

  void _removeTask(String id) {
    setState(() {
      tasks.removeWhere((t) => t.id == id);
    });
    _saveTasks();
  }

  void _resetAllTasks() {
    setState(() {
      for (var t in tasks) {
        t.done = false;
        t.completedSec = 0;
      }
      if (tasks.isNotEmpty) currentTaskId = tasks[0].id;
    });
    _saveTasks();
  }

  String formatMMSS(int sec) {
    final s = sec % 60;
    final m = (sec / 60).floor() % 60;
    final h = (sec / 3600).floor();
    if (h > 0) return '${h}h ${m}m ${s}s';
    return '${m}m ${s}s';
  }

  @override
  void dispose() {
    _ticker?.cancel();
    super.dispose();
  }

  // UI building below
  @override
  Widget build(BuildContext context) {
    final ct = tasks.firstWhere((t) => t.id == currentTaskId && !t.done, orElse: () => tasks.firstWhere((t) => !t.done, orElse: () => (tasks.isNotEmpty ? tasks[0] : null as Task)));

    return Scaffold(
      appBar: AppBar(
        title: Text('Rotating Task Timer'),
        actions: [
          IconButton(
            icon: Icon(Icons.refresh),
            onPressed: _resetAllTasks,
            tooltip: 'Reset all tasks',
          )
        ],
      ),
      body: Padding(
        padding: const EdgeInsets.all(12.0),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            if (ct != null && !ct.done)
              Card(
                elevation: 4,
                child: Padding(
                  padding: const EdgeInsets.all(12.0),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Row(
                        mainAxisAlignment: MainAxisAlignment.spaceBetween,
                        children: [
                          Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              Text(ct.title, style: TextStyle(fontSize: 22, fontWeight: FontWeight.bold)),
                              SizedBox(height: 4),
                              Text('Target: ${ct.targetMin} min', style: TextStyle(color: Colors.grey[700])),
                            ],
                          ),
                          Column(
                            crossAxisAlignment: CrossAxisAlignment.end,
                            children: [
                              Text(formatMMSS(displayedSecondsFor(ct)), style: TextStyle(fontFamily: 'monospace', fontSize: 16)),
                              Text('${ct.targetMin}:00', style: TextStyle(color: Colors.grey[600])),
                            ],
                          )
                        ],
                      ),
                      SizedBox(height: 10),
                      Row(
                        children: [
                          ElevatedButton(
                            onPressed: runningSince == null ? _startTimer : _pauseTimer,
                            child: Text(runningSince == null ? 'Start Timer' : 'Pause'),
                          ),
                          SizedBox(width: 8),
                          OutlinedButton(onPressed: _nextTask, child: Text('Next Task →')),
                          SizedBox(width: 8),
                          OutlinedButton(onPressed: () => _toggleDone(ct.id), child: Text('Mark Done')),
                        ],
                      ),
                      SizedBox(height: 6),
                      Text('If you can’t do this task now, tap Next to cycle (order preserved).', style: TextStyle(color: Colors.grey[600], fontSize: 12)),
                    ],
                  ),
                ),
              )
            else
              Card(
                child: Padding(
                  padding: const EdgeInsets.all(12.0),
                  child: Text('No incomplete tasks — resetting...'),
                ),
              ),

            SizedBox(height: 12),

            Expanded(
              child: Card(
                elevation: 2,
                child: Padding(
                  padding: const EdgeInsets.all(8.0),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.stretch,
                    children: [
                      Text('All tasks (order preserved)', style: TextStyle(fontWeight: FontWeight.w600)),
                      SizedBox(height: 6),
                      Expanded(
                        child: ListView.separated(
                          itemCount: tasks.length,
                          separatorBuilder: (_, __) => Divider(height: 1),
                          itemBuilder: (context, index) {
                            final t = tasks[index];
                            return ListTile(
                              leading: CircleAvatar(
                                child: Text('${index + 1}'),
                                backgroundColor: t.done ? Colors.green[100] : Colors.grey[200],
                              ),
                              title: Text(t.title),
                              subtitle: Text('${(t.completedSec / 60).toStringAsFixed(2)} / ${t.targetMin} min'),
                              trailing: Row(
                                mainAxisSize: MainAxisSize.min,
                                children: [
                                  Text(formatMMSS(displayedSecondsFor(t))),
                                  SizedBox(width: 8),
                                  TextButton(onPressed: () => setState(() { currentTaskId = t.id; }), child: Text('Focus')),
                                  IconButton(onPressed: () => _removeTask(t.id), icon: Icon(Icons.delete)),
                                ],
                              ),
                            );
                          },
                        ),
                      ),

                      _AddTaskRow(onAdd: (title, mins) => _addTask(title, mins)),

                      SizedBox(height: 6),
                      Row(
                        children: [
                          ElevatedButton(onPressed: _resetAllTasks, child: Text('Reset All')),
                          SizedBox(width: 8),
                          OutlinedButton(onPressed: () async {
                            final sp = await SharedPreferences.getInstance();
                            await sp.remove(STORAGE_KEY);
                            setState(() { tasks = _sampleTasks(); currentTaskId = tasks.first.id; });
                          }, child: Text('Clear Storage (dev)')),
                        ],
                      )
                    ],
                  ),
                ),
              ),
            )
          ],
        ),
      ),
    );
  }
}

class _AddTaskRow extends StatefulWidget {
  final void Function(String title, int mins) onAdd;
  _AddTaskRow({required this.onAdd});
  @override
  __AddTaskRowState createState() => __AddTaskRowState();
}

class __AddTaskRowState extends State<_AddTaskRow> {
  final _title = TextEditingController();
  final _mins = TextEditingController(text: '25');
  @override
  void dispose() {
    _title.dispose();
    _mins.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return Row(
      children: [
        Expanded(child: TextField(controller: _title, decoration: InputDecoration(hintText: 'Task title'))),
        SizedBox(width: 8),
        Container(width: 70, child: TextField(controller: _mins, keyboardType: TextInputType.number, decoration: InputDecoration(hintText: 'Mins'))),
        SizedBox(width: 8),
        ElevatedButton(onPressed: () {
          final title = _title.text.trim();
          final mins = int.tryParse(_mins.text) ?? 25;
          if (title.isEmpty) return;
          widget.onAdd(title, mins);
          _title.clear();
          _mins.text = '25';
        }, child: Text('Add'))
      ],
    );
  }
}
