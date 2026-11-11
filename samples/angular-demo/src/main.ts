import { ChangeDetectionStrategy, Component, computed, signal } from '@angular/core';
import { bootstrapApplication } from '@angular/platform-browser';

interface Task { id: number; title: string; category: string; done: boolean; }

@Component({
  selector: 'app-root',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <aside class="sidebar">
      <a class="brand" href="/" aria-label="Launch Lab home"><span class="brand-mark">L<span>↗</span></span><span>launch<span class="brand-light">lab</span><small>DEVELOPER WORKSPACE</small></span></a>
      <div class="workspace"><span class="workspace-icon">A</span><div>Angular sandbox<small>Local workspace</small></div><span class="workspace-chevron">⌄</span></div>
      <div class="nav-label">WORKSPACE</div>
      <div class="nav-active"><span>▦</span> Overview <span class="nav-dot"></span></div>
      <div class="sidebar-caption">Try real browser interactions here.</div>
      <div class="sidebar-bottom"><div class="mini-terminal">&gt;_</div><strong>One connected debug session.</strong><p>Connect your Angular dev server<br>to local browser MCP tools.</p><div class="sidebar-tag">BROWSER MCP DEBUG</div></div>
      <div class="sidebar-footer"><span class="avatar">D</span><div>Demo workspace<small>Local demo environment</small></div><span class="online-dot"></span></div>
    </aside>
    <div class="main-shell">
      <header class="topbar"><span>Workspace <span class="breadcrumb-separator">/</span> <strong>Overview</strong></span><div class="topbar-right"><span class="local-badge"><span class="online-dot"></span> localhost:4201</span><span class="topbar-avatar">LL</span></div></header>
      <main>
        <div class="page-heading"><div><div class="eyebrow">ANGULAR × BROWSER MCP</div><h1>See your changes in action.</h1><p>Interact, inspect requests, and see what changes. Start debugging here.</p></div><div class="version-badge"><span class="angular-mark">A</span> Angular 22 <span class="version-divider">|</span> Standalone</div></div>
        <section class="hero"><div class="hero-copy"><div class="hero-kicker"><span class="online-dot"></span> ANGULAR APPLICATION IS RUNNING</div><h2>From code to browser,<br>with less setup.</h2><p>Try the tasks below to see Angular react to your changes. <br>Inspect Console and Network activity through MCP.</p><div class="hero-tags"><span>Signals</span><span>Zoneless</span><span>Live reload</span></div></div><div class="flow-card"><div class="flow-label">YOUR DEBUG FLOW</div><div class="flow-step"><span class="step-icon">⌘</span><div>VS Code<small>Run and Debug</small></div><span class="step-check">✓</span></div><div class="flow-line"></div><div class="flow-step"><span class="step-icon green">↔</span><div>Browser MCP<small>Playwright + Chrome DevTools</small></div><span class="step-index">02</span></div><div class="flow-line"></div><div class="flow-step"><span class="step-icon orange">A</span><div>Angular app<small>localhost:4201</small></div><span class="step-check">✓</span></div></div></section>
        <section class="stats" aria-label="Task summary"><div class="stat"><span class="stat-label">All tasks <span>▤</span></span><div><strong data-testid="total-count">{{ tasks().length }}</strong><small>In this workspace</small></div></div><div class="stat"><span class="stat-label">Completed tasks <span>✓</span></span><div><strong data-testid="done-count">{{ completed() }}</strong><small>One step at a time.</small></div></div><div class="stat"><span class="stat-label">Progress <span>↗</span></span><div><strong>{{ progress() }}<span class="percent">%</span></strong><div class="progress-track"><div [style.width.%]="progress()"></div></div></div></div></section>
        <div class="content-grid"><section class="panel tasks-panel"><div class="panel-heading"><div><h2>Debug checklist</h2><p>Check a task to update the totals instantly.</p></div><span class="count-badge">{{ tasks().length }} tasks</span></div><div class="task-list">@for (task of tasks(); track task.id) {<div class="task-row" [class.is-done]="task.done"><button class="checkbox" [class.checked]="task.done" role="checkbox" [attr.aria-checked]="task.done" [attr.aria-label]="task.title" (click)="toggle(task.id)">{{ task.done ? '✓' : '' }}</button><div class="task-title">{{ task.title }}<small>{{ task.category }}</small></div><span class="task-status" [class.status-done]="task.done">{{ task.done ? 'Done' : 'To do' }}</span></div>}</div><form class="add-task" (submit)="addTask($event, taskInput)"><label class="sr-only" for="task-title">New task</label><input #taskInput id="task-title" placeholder="Enter a new task…" maxlength="100"><button type="submit">+ Add</button></form><div class="task-hint"><span>↻</span> State is managed with Angular Signals.</div></section>
        <section class="panel tools-panel"><div class="panel-heading"><div><h2>Inspect the browser</h2><p>Explore Console and Network activity.</p></div><span class="tools-icon">⌁</span></div><div class="tool-item"><div class="tool-symbol">&gt;_</div><div><h3>Write a Console log</h3><p>Log the current time and task state.</p></div><button type="button" class="tool-button" (click)="writeLog()" aria-label="Write a Console log">↗</button></div><div class="tool-item"><div class="tool-symbol">&#123; &#125;</div><div><h3>Send an API request</h3><p>Fetch local JSON to inspect a request.</p></div><button type="button" class="tool-button" (click)="requestData()" [disabled]="loading()" aria-label="Send an API request">↗</button></div><div class="event-console" aria-live="polite"><span class="console-title"><span class="online-dot"></span> LAST EVENT</span><code data-testid="last-event">{{ lastEvent() }}</code></div><div class="tools-footer"><span class="info-icon">i</span> Request URL: <code>/demo-data.json</code></div></section></div>
        <footer class="page-footer"><span><span class="online-dot"></span> Angular app is running</span><span>Launch Lab <span class="footer-divider">·</span> Browser MCP Debug sample</span></footer>
      </main>
    </div>
  `
})
export class App {
  readonly tasks = signal<Task[]>([
    { id: 1, title: 'Open the Angular app in your browser', category: 'GETTING STARTED', done: true },
    { id: 2, title: 'Mark a task complete and watch it update', category: 'INTERACTION', done: false },
    { id: 3, title: 'Inspect Console and Network through MCP', category: 'BROWSER TOOLS', done: false }
  ]);
  readonly completed = computed(() => this.tasks().filter(task => task.done).length);
  readonly progress = computed(() => Math.round(this.completed() / Math.max(1, this.tasks().length) * 100));
  readonly lastEvent = signal('ready — waiting for an interaction');
  readonly loading = signal(false);
  private nextId = 4;
  toggle(id: number): void {
    this.tasks.update(tasks => tasks.map(task => task.id === id ? { ...task, done: !task.done } : task));
    this.lastEvent.set(`task.updated — ${this.completed()} / ${this.tasks().length} completed`);
    console.info('[Launch Lab] task.updated', { id, completed: this.completed() });
  }
  addTask(event: Event, input: HTMLInputElement): void {
    event.preventDefault();
    const title = input.value.trim();
    if (!title) return;
    this.tasks.update(tasks => [...tasks, { id: this.nextId++, title, category: 'YOUR TASK', done: false }]);
    input.value = '';
    this.lastEvent.set(`task.created — ${title}`);
  }
  writeLog(): void {
    console.info('[Launch Lab] console.check', { time: new Date().toISOString(), tasks: this.tasks() });
    this.lastEvent.set('console.check — open the DevTools Console');
  }
  async requestData(): Promise<void> {
    this.loading.set(true);
    try {
      const response = await fetch(`/demo-data.json?t=${Date.now()}`);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const data = await response.json();
      this.lastEvent.set(`GET /demo-data.json → ${response.status} ${data.message}`);
      console.info('[Launch Lab] api.response', data);
    } catch (error) { this.lastEvent.set(`request.failed — ${String(error)}`); }
    finally { this.loading.set(false); }
  }
}

bootstrapApplication(App).catch(error => console.error(error));
