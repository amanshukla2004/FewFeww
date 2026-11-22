import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { pool } from '../db/pool.js';

export async function dashboardRoutes(app: FastifyInstance) {
  /**
   * JSON API for Dashboard Data Visualization (Habits, Time-Series Graphs, Tasks, Circles)
   */
  app.get('/api/dashboard/stats', async (req: FastifyRequest, reply: FastifyReply) => {
    const query = req.query as Record<string, string>;
    const userId = query.userId || query.user_id;

    if (!userId) {
      return reply.code(400).send({ error: 'Missing userId parameter' });
    }

    // 1. Fetch Habits and Time-series Logs
    const habitsRes = await pool.query(
      `
      SELECT h.id, h.name, h.kind, h.unit, h.target_value,
             COALESCE(
               json_agg(
                 json_build_object(
                   'value', hl.value,
                   'notes', hl.notes,
                   'logged_at', hl.logged_at
                 ) ORDER BY hl.logged_at ASC
               ) FILTER (WHERE hl.id IS NOT NULL),
               '[]'
             ) as history
      FROM habits h
      LEFT JOIN habit_logs hl ON h.id = hl.habit_id
      WHERE h.user_id = $1
      GROUP BY h.id, h.name, h.kind, h.unit, h.target_value
      ORDER BY h.name ASC;
      `,
      [userId]
    );

    // 2. Fetch Tasks grouped by Category
    const tasksRes = await pool.query(
      `
      SELECT id, title, status, category, recurrence, due_at, created_at
      FROM tasks
      WHERE user_id = $1 AND status != 'DROPPED'
      ORDER BY due_at ASC NULLS LAST;
      `,
      [userId]
    );

    // 3. Fetch Circles
    const circlesRes = await pool.query(
      `
      SELECT c.id, c.name, c.invite_code, count(cm.id)::int as member_count
      FROM circles c
      LEFT JOIN circle_members cm ON c.id = cm.circle_id AND cm.status = 'ACTIVE'
      WHERE c.owner_id = $1
      GROUP BY c.id, c.name, c.invite_code
      ORDER BY c.name ASC;
      `,
      [userId]
    );

    // 4. Fetch Notes
    const notesRes = await pool.query(
      `
      SELECT id, title, content, tags, created_at
      FROM notes
      WHERE user_id = $1
      ORDER BY created_at DESC
      LIMIT 10;
      `,
      [userId]
    );

    return reply.code(200).send({
      habits: habitsRes.rows,
      tasks: tasksRes.rows,
      circles: circlesRes.rows,
      notes: notesRes.rows,
    });
  });

  /**
   * Interactive Web Dashboard UI (Dark Mode with Habit & Weight Progress Charts)
   */
  app.get('/dashboard', async (req: FastifyRequest, reply: FastifyReply) => {
    const query = req.query as Record<string, string>;
    const rawUserId = query.userId || query.user_id || '1';
    const userId = String(rawUserId).replace(/[^a-zA-Z0-9_-]/g, '');

    const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>FewFeww — Universal Productivity & Habit Dashboard</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700&display=swap" rel="stylesheet">
  <script src="https://cdn.jsdelivr.net/npm/chart.js"></script>
  <style>
    :root {
      --bg: #0d0f12;
      --card-bg: #161a1f;
      --card-border: #232931;
      --text: #f0f3f8;
      --muted: #8b949e;
      --primary: #3b82f6;
      --primary-glow: rgba(59, 130, 246, 0.2);
      --accent: #10b981;
      --danger: #ef4444;
      --radius: 14px;
    }

    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      background-color: var(--bg);
      color: var(--text);
      font-family: 'Plus Jakarta Sans', -apple-system, BlinkMacSystemFont, sans-serif;
      padding: 24px;
      line-height: 1.5;
    }

    .container { max-width: 1240px; margin: 0 auto; }

    header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding-bottom: 24px;
      border-bottom: 1px solid var(--card-border);
      margin-bottom: 28px;
    }

    .brand {
      display: flex;
      align-items: center;
      gap: 12px;
      font-size: 22px;
      font-weight: 700;
      color: #fff;
    }

    .brand-badge {
      background: linear-gradient(135deg, #3b82f6, #6366f1);
      padding: 4px 10px;
      border-radius: 8px;
      font-size: 13px;
      font-weight: 600;
    }

    .grid-dashboard {
      display: grid;
      grid-template-columns: repeat(12, 1fr);
      gap: 20px;
    }

    .card {
      background: var(--card-bg);
      border: 1px solid var(--card-border);
      border-radius: var(--radius);
      padding: 20px;
      box-shadow: 0 4px 20px rgba(0,0,0,0.3);
    }

    .card-title {
      font-size: 16px;
      font-weight: 600;
      color: var(--text);
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 16px;
    }

    .card-title .badge {
      font-size: 12px;
      color: var(--accent);
      background: rgba(16, 185, 129, 0.1);
      padding: 2px 8px;
      border-radius: 6px;
    }

    .col-8 { grid-column: span 8; }
    .col-4 { grid-column: span 4; }
    .col-6 { grid-column: span 6; }
    .col-12 { grid-column: span 12; }

    @media (max-width: 900px) {
      .col-8, .col-4, .col-6 { grid-column: span 12; }
    }

    .chart-container {
      position: relative;
      height: 240px;
      width: 100%;
    }

    .task-item {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 10px 14px;
      background: rgba(255,255,255,0.02);
      border: 1px solid var(--card-border);
      border-radius: 8px;
      margin-bottom: 8px;
      font-size: 14px;
    }

    .task-status-done { text-decoration: line-through; color: var(--muted); }

    .circle-card {
      padding: 12px;
      background: rgba(255,255,255,0.03);
      border-radius: 8px;
      margin-bottom: 10px;
    }

    .circle-link {
      font-size: 12px;
      color: var(--primary);
      text-decoration: none;
      word-break: break-all;
    }
  </style>
</head>
<body>
  <div class="container">
    <header>
      <div class="brand">
        <span>⚡ FewFeww</span>
        <span class="brand-badge">PRO DASHBOARD</span>
      </div>
      <div>
        <span style="color: var(--muted); font-size: 14px;">User Account: <b>#${userId}</b></span>
      </div>
    </header>

    <div class="grid-dashboard">
      <!-- Habit Graph 1: Weight History -->
      <div class="card col-8">
        <div class="card-title">
          <span>⚖️ Weight Tracking Over Time</span>
          <span class="badge" id="weight-delta">Active Metric</span>
        </div>
        <div class="chart-container">
          <canvas id="weightChart"></canvas>
        </div>
      </div>

      <!-- Quick Metrics -->
      <div class="card col-4">
        <div class="card-title">
          <span>🔥 Habit Streaks & Stats</span>
        </div>
        <div id="habits-summary" style="display: flex; flex-direction: column; gap: 12px;">
          <div style="padding: 12px; background: rgba(59, 130, 246, 0.08); border-radius: 8px;">
            <div style="font-size: 12px; color: var(--muted);">LeetCode Solved This Week</div>
            <div style="font-size: 24px; font-weight: 700; color: #fff;" id="lc-count">--</div>
          </div>
          <div style="padding: 12px; background: rgba(16, 185, 129, 0.08); border-radius: 8px;">
            <div style="font-size: 12px; color: var(--muted);">Current Weight</div>
            <div style="font-size: 24px; font-weight: 700; color: #fff;" id="latest-weight">--</div>
          </div>
        </div>
      </div>

      <!-- Habit Graph 2: LeetCode Daily Bar Graph -->
      <div class="card col-6">
        <div class="card-title">
          <span>💻 LeetCode Problem Solved Activity</span>
        </div>
        <div class="chart-container">
          <canvas id="leetcodeChart"></canvas>
        </div>
      </div>

      <!-- Live Categorized To-Do Board -->
      <div class="card col-6">
        <div class="card-title">
          <span>📋 Active To-Do Lists & Categories</span>
        </div>
        <div id="tasks-container" style="max-height: 240px; overflow-y: auto;" aria-live="polite">
          <p style="color: var(--muted); font-size: 14px;">Loading tasks...</p>
        </div>
      </div>

      <!-- Circles & Social Follow-Through -->
      <div class="card col-12">
        <div class="card-title">
          <span>👥 Circles & Group Reminders</span>
        </div>
        <div id="circles-container" style="display: grid; grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); gap: 14px;" aria-live="polite">
          <p style="color: var(--muted); font-size: 14px;">Loading circles...</p>
        </div>
      </div>
    </div>
  </div>

  <script>
    function escapeHtml(unsafe) {
      if (!unsafe) return '';
      return String(unsafe)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
    }

    async function loadDashboard() {
      try {
        const res = await fetch('/api/dashboard/stats?userId=${encodeURIComponent(userId)}');
        const data = await res.json();

        // 1. Render Weight Chart
        const weightHabit = data.habits.find(h => h.name.toLowerCase() === 'weight');
        if (weightHabit && weightHabit.history.length > 0) {
          const labels = weightHabit.history.map(p => new Date(p.logged_at).toLocaleDateString());
          const values = weightHabit.history.map(p => parseFloat(p.value));

          document.getElementById('latest-weight').textContent = values[values.length - 1] + ' ' + (weightHabit.unit || 'kg');

          new Chart(document.getElementById('weightChart'), {
            type: 'line',
            data: {
              labels,
              datasets: [{
                label: 'Weight (' + (weightHabit.unit || 'kg') + ')',
                data: values,
                borderColor: '#3b82f6',
                backgroundColor: 'rgba(59, 130, 246, 0.1)',
                fill: true,
                tension: 0.3,
                pointRadius: 5,
                pointBackgroundColor: '#3b82f6',
              }]
            },
            options: {
              responsive: true,
              maintainAspectRatio: false,
              plugins: { legend: { display: false } },
              scales: {
                x: { grid: { color: '#232931' }, ticks: { color: '#8b949e' } },
                y: { grid: { color: '#232931' }, ticks: { color: '#8b949e' } }
              }
            }
          });
        } else {
          document.getElementById('weight-delta').textContent = 'No Entries Yet';
        }

        // 2. Render LeetCode Chart
        const lcHabit = data.habits.find(h => h.name.toLowerCase() === 'leetcode');
        if (lcHabit && lcHabit.history.length > 0) {
          const labels = lcHabit.history.map(p => new Date(p.logged_at).toLocaleDateString());
          const values = lcHabit.history.map(p => parseInt(p.value, 10));
          const totalLc = values.reduce((a, b) => a + b, 0);

          document.getElementById('lc-count').textContent = totalLc + ' solved';

          new Chart(document.getElementById('leetcodeChart'), {
            type: 'bar',
            data: {
              labels,
              datasets: [{
                label: 'Problems Solved',
                data: values,
                backgroundColor: '#10b981',
                borderRadius: 6,
              }]
            },
            options: {
              responsive: true,
              maintainAspectRatio: false,
              plugins: { legend: { display: false } },
              scales: {
                x: { grid: { color: '#232931' }, ticks: { color: '#8b949e' } },
                y: { grid: { color: '#232931' }, ticks: { color: '#8b949e' }, beginAtZero: true }
              }
            }
          });
        }

        // 3. Render Tasks
        const tasksContainer = document.getElementById('tasks-container');
        if (!data.tasks || data.tasks.length === 0) {
          tasksContainer.innerHTML = '<p style="color: var(--muted); font-size: 14px;">No active tasks.</p>';
        } else {
          tasksContainer.innerHTML = data.tasks.map(t => \`
            <div class="task-item \${t.status === 'COMPLETED' ? 'task-status-done' : ''}">
              <span>\${escapeHtml(t.title)}</span>
              <span style="font-size: 12px; color: var(--primary);">[\${escapeHtml(t.category || 'General')}]</span>
            </div>
          \`).join('');
        }

        // 4. Render Circles
        const circlesContainer = document.getElementById('circles-container');
        if (!data.circles || data.circles.length === 0) {
          circlesContainer.innerHTML = '<p style="color: var(--muted); font-size: 14px;">No circles created yet. Create one with: <i>"create a circle called Family"</i>.</p>';
        } else {
          circlesContainer.innerHTML = data.circles.map(c => \`
            <div class="circle-card">
              <div style="font-weight: 600; font-size: 15px; margin-bottom: 4px;">\${escapeHtml(c.name)}</div>
              <div style="font-size: 13px; color: var(--muted); margin-bottom: 8px;">\${escapeHtml(String(c.member_count))} member(s)</div>
              <a class="circle-link" href="https://t.me/FewFewwDevBot?start=join_\${encodeURIComponent(c.invite_code)}" target="_blank" rel="noopener noreferrer">🔗 Invite: join_\${escapeHtml(c.invite_code)}</a>
            </div>
          \`).join('');
        }
      } catch (err) {
        console.error('Failed to load dashboard:', err);
      }
    }

    loadDashboard();
  </script>
</body>
</html>`;

    reply.type('text/html');
    return reply.code(200).send(html);
  });
}
