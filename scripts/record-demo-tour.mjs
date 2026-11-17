import { chromium } from "@playwright/test";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PUBLIC_DIR = path.join(ROOT, "src/main/resources/public");
const MEDIA_DIR = path.join(PUBLIC_DIR, "media");
const STYLES_PATH = path.join(PUBLIC_DIR, "styles.css");

const WIDTH = 1280;
const HEIGHT = 720;
const FPS = 12;
const DURATION_SEC = 17.0;
const TOTAL_FRAMES = Math.round(FPS * DURATION_SEC); // 204 frames
const MIN_VIDEO_BYTES = 600 * 1024;
const MAX_VIDEO_BYTES = 1200 * 1024;

function findFfmpeg() {
  const candidates = [
    process.env.FFMPEG_BIN,
    "/Users/will/Library/Caches/ms-playwright/ffmpeg-1011/ffmpeg-mac"
  ].filter(Boolean);

  const cacheDir = path.join(os.homedir(), "Library/Caches/ms-playwright");
  if (fs.existsSync(cacheDir)) {
    for (const entry of fs.readdirSync(cacheDir)) {
      if (entry.startsWith("ffmpeg-")) {
        candidates.push(path.join(cacheDir, entry, "ffmpeg-mac"));
        candidates.push(path.join(cacheDir, entry, "ffmpeg-linux"));
      }
    }
  }

  for (const bin of candidates) {
    if (bin && fs.existsSync(bin)) return bin;
  }
  throw new Error("Could not locate Playwright ffmpeg binary.");
}

function buildSceneHtml(appCss) {
  const logoSvg = `<svg viewBox="0 0 40 40" width="34" height="34" aria-hidden="true"><rect x="3" y="3" width="34" height="34" rx="9" fill="#0f172a"/><rect x="10" y="8.5" width="21" height="24" rx="3" fill="#faf9f6"/><path d="M14.5 16h11M14.5 20.5h11M14.5 25h7" stroke="#94a3b8" stroke-width="1.8" stroke-linecap="round"/><path d="M25 8.5h4.5v10l-2.25-1.8L25 18.5Z" fill="#b33812"/><g fill="#0f172a"><circle cx="10" cy="13" r="1.4"/><circle cx="10" cy="19" r="1.4"/><circle cx="10" cy="25" r="1.4"/></g></svg>`;

  return `<!doctype html>
<html lang="en" data-theme="light">
<head>
<meta charset="UTF-8" />
<style>
${appCss}

/* Deterministic 1280x720 demo stage adjustments */
html, body {
  width: 1280px;
  height: 720px;
  margin: 0;
  padding: 0;
  overflow: hidden;
  background: var(--desk);
}
.demo-stage {
  position: relative;
  width: 1280px;
  height: 720px;
  overflow: hidden;
  background: var(--desk);
}
.demo-camera {
  width: 100%;
  height: 100%;
  min-width: 0;
  overflow: hidden;
  transform-origin: 55% 45%;
  will-change: transform;
}
.app.demo-app {
  width: 1280px;
  height: 720px;
  max-width: none;
  border-radius: 0;
  box-shadow: none;
  grid-template-columns: 244px minmax(0, 1fr);
}
.demo-app .page {
  overflow: hidden;
}
.demo-app .view {
  padding: 26px 36px 32px 54px;
  max-width: none;
}
.demo-app .view-head {
  margin-bottom: 16px;
  padding-bottom: 12px;
}
.demo-app .view-title {
  font-size: 2.05rem;
}

/* Hover and focus simulation classes */
.is-hovered {
  border-color: var(--accent-ink) !important;
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--accent) 22%, transparent), var(--shadow-md) !important;
}
.tab.is-hovered {
  background: var(--cover-hover) !important;
  color: var(--cover-ink) !important;
  box-shadow: none !important;
}
.demo-autofill-flash {
  border-color: var(--accent-ink) !important;
  background: color-mix(in srgb, var(--accent-soft) 55%, var(--card)) !important;
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--accent) 18%, transparent) !important;
}

/* Modal overlay for Workflow 1 */
.demo-modal-backdrop {
  position: absolute;
  inset: 0;
  background: rgba(9, 12, 18, 0.52);
  backdrop-filter: blur(3px);
  display: grid;
  place-items: center;
  z-index: 30;
  opacity: 0;
  pointer-events: none;
}
.demo-modal-backdrop.is-open {
  opacity: 1;
}
.demo-modal-card {
  width: 580px;
  background: var(--card);
  border: 1px solid var(--line-strong);
  border-radius: 18px;
  box-shadow: var(--shadow-lg);
  overflow: hidden;
}
.demo-modal-card .sheet-head {
  padding: 14px 20px 12px;
}
.demo-modal-card .sheet-head h2 {
  font-size: 1.35rem;
}
.demo-modal-card .sheet-body {
  padding: 14px 20px;
}
.demo-modal-card .sheet-foot {
  padding: 12px 20px;
}
.demo-typing-caret {
  display: inline-block;
  width: 2px;
  height: 1.05em;
  background: var(--accent-ink);
  vertical-align: text-bottom;
  margin-left: 1px;
}
.demo-quickfill-display {
  display: flex;
  align-items: center;
  min-height: 44px;
  flex: 1;
  background: var(--card);
  border: 1.5px solid var(--line-strong);
  border-radius: 8px;
  padding: 8px 12px;
  font: 500 0.88rem/1.3 var(--mono);
  color: var(--ink);
  overflow: hidden;
  white-space: nowrap;
}
.demo-quickfill-display.is-focused {
  border-color: var(--focus);
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--focus) 20%, transparent);
}
.demo-quickfill-placeholder {
  color: var(--faint);
  font-family: var(--sans);
}
.demo-field-box {
  background: var(--card);
  border: 1px solid var(--line-strong);
  border-radius: 10px;
  min-height: 42px;
  padding: 8px 12px;
  font-size: 0.92rem;
  font-weight: 600;
  color: var(--ink);
  display: flex;
  align-items: center;
  gap: 6px;
}
.demo-field-box.is-empty {
  color: var(--faint);
  font-weight: 450;
}

/* Kanban drag ghost and stamp */
.demo-drag-card {
  position: absolute;
  width: 174px;
  z-index: 35;
  pointer-events: none;
  box-shadow: 0 22px 44px -12px rgba(15, 23, 42, 0.34), 0 0 0 2px var(--st-interview) !important;
  transform: rotate(-1.8deg) scale(1.03);
}
.demo-history-stamp {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  margin-top: 4px;
  padding: 3px 8px;
  border-radius: 999px;
  background: var(--st-interview-bg);
  border: 1px solid color-mix(in srgb, var(--st-interview) 45%, transparent);
  color: var(--ink);
  font-size: 0.7rem;
  font-weight: 700;
}

/* Mock interview score overlay card inside entry workflow */
.demo-mock-card {
  margin-top: 14px;
  background: var(--paper-2);
  border: 1px solid var(--line-strong);
  border-radius: 14px;
  padding: 16px 18px;
  display: grid;
  grid-template-columns: auto 1fr;
  gap: 16px;
  align-items: center;
}
.demo-mock-score-box {
  background: var(--st-saved-bg);
  border: 1.5px solid var(--st-saved);
  border-radius: 12px;
  padding: 12px 16px;
  text-align: center;
  min-width: 120px;
}
.demo-mock-score-box strong {
  display: block;
  font: 700 2rem/1 var(--serif);
  color: var(--ink);
}
.demo-mock-score-box span {
  font-size: 0.76rem;
  font-weight: 700;
  color: var(--good);
  text-transform: uppercase;
  letter-spacing: 0.06em;
}
.demo-mock-metrics {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-top: 6px;
}
.demo-metric-pill {
  background: var(--card);
  border: 1px solid var(--line-strong);
  border-radius: 999px;
  padding: 4px 10px;
  font-size: 0.78rem;
  font-weight: 650;
  color: var(--ink-2);
}
.demo-metric-pill.good {
  background: var(--st-saved-bg);
  border-color: var(--st-saved);
  color: var(--ink);
}

/* Floating action callout pill (bottom-left of paper workspace, clear of #hero bottom-right Pause control) */
.demo-callout {
  position: absolute;
  left: 268px;
  right: auto;
  bottom: 20px;
  z-index: 60;
  display: inline-flex;
  align-items: center;
  gap: 10px;
  background: #0f172a;
  color: #f8fafc;
  border: 1px solid rgba(248, 250, 252, 0.16);
  border-radius: 999px;
  padding: 9px 16px 9px 10px;
  box-shadow: 0 18px 36px -10px rgba(15, 23, 42, 0.45);
  font-size: 0.86rem;
  font-weight: 600;
}
.demo-callout-step {
  background: #c84319;
  color: #ffffff;
  font-family: var(--mono);
  font-size: 0.76rem;
  font-weight: 700;
  padding: 3px 9px;
  border-radius: 999px;
}
.demo-callout-sub {
  color: #cbd5e1;
  font-weight: 500;
}

/* Toast notification */
.demo-toast {
  position: absolute;
  right: 24px;
  bottom: 72px;
  z-index: 55;
  background: var(--ink);
  color: var(--paper);
  border-radius: 12px;
  padding: 10px 16px;
  font-size: 0.88rem;
  font-weight: 650;
  box-shadow: var(--shadow-lg);
  display: flex;
  align-items: center;
  gap: 8px;
}

/* Custom animated cursor and click ripple */
.demo-ripple {
  position: absolute;
  width: 44px;
  height: 44px;
  margin-left: -22px;
  margin-top: -22px;
  border-radius: 50%;
  border: 3px solid #c84319;
  background: rgba(200, 67, 25, 0.18);
  pointer-events: none;
  z-index: 80;
}
.demo-cursor {
  position: absolute;
  left: 0;
  top: 0;
  width: 28px;
  height: 32px;
  pointer-events: none;
  z-index: 90;
  filter: drop-shadow(0 4px 8px rgba(15, 23, 42, 0.35));
}
</style>
</head>
<body>
<div class="demo-stage" id="demo-stage">
  <div class="app demo-app">
    <aside class="cover" aria-label="Notebook">
      <div class="cover-label">
        <span class="cover-logo">${logoSvg}</span>
        <span class="cover-title">My Internship<br />Notebook</span>
        <span class="cover-sub">Applications &amp; interviews</span>
      </div>
      <div class="cover-actions">
        <button class="button primary cover-new" id="nav-new-btn" type="button">
          <span>+ New application</span><kbd>N</kbd>
        </button>
        <div class="cover-search">
          <span>Search</span><kbd>Cmd+K</kbd>
        </div>
      </div>
      <nav class="tabs" aria-label="Sections">
        <a class="tab" id="nav-today" style="--tab: var(--tab-today)"><span>Today</span></a>
        <a class="tab" id="nav-board" style="--tab: var(--tab-board)"><span>Board</span><b class="tab-count">11</b></a>
        <a class="tab" id="nav-notebook" style="--tab: var(--tab-notebook)"><span>All pages</span><b class="tab-count">14</b></a>
        <a class="tab" id="nav-insights" style="--tab: var(--tab-insights)"><span>Insights</span></a>
      </nav>
      <div class="cover-footer">
        <p class="storage-chip">Private to this browser</p>
      </div>
    </aside>
    <div class="demo-camera" id="demo-camera">
      <div class="page-wrap">
        <div class="binding" aria-hidden="true"></div>
        <main class="page" id="demo-page">
          <div class="view" id="demo-view"></div>
        </main>
      </div>
    </div>
  </div>

  <div class="demo-modal-backdrop" id="demo-modal"></div>

  <div class="demo-toast" id="demo-toast" style="display:none;"></div>
  <div class="demo-callout" id="demo-callout"></div>
  <div class="demo-ripple" id="demo-ripple" style="display:none;"></div>
  <div class="demo-cursor" id="demo-cursor">
    <svg viewBox="0 0 28 32" width="28" height="32" aria-hidden="true">
      <path d="M3.5 2.5 L23.5 14.5 L14.5 16.8 L19 26.2 L15.2 28 L10.7 18.6 L4.2 24 Z" fill="#0f172a" stroke="#ffffff" stroke-width="2" stroke-linejoin="round"/>
    </svg>
  </div>
</div>

<script>
(function () {
  const clamp = (v, min, max) => Math.max(min, Math.min(max, v));
  const lerp = (a, b, t) => a + (b - a) * t;
  const ease = t => {
    const x = clamp(t, 0, 1);
    return x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2;
  };
  const seg = (t, t0, t1) => ease(clamp((t - t0) / (t1 - t0), 0, 1));

  const QUICK_URL = "https://boards.greenhouse.io/stripe/jobs/98765";

  function cursorPath(t) {
    const pts = [
      [0.0, 740, 380],
      [0.65, 118, 182],  // New application btn
      [1.4, 118, 182],
      [1.75, 535, 298],  // Quickfill input
      [2.45, 535, 298],
      [2.65, 878, 298],  // Fill button
      [3.25, 760, 480],  // Inspect autofilled fields cleanly below labels
      [3.9, 845, 558],   // Save to notebook
      [4.5, 845, 558],
      [4.85, 118, 336],  // Sidebar Board tab
      [5.55, 520, 295],  // Stripe card in Applied
      [6.85, 728, 295],  // Drag across to Interview column
      [7.4, 728, 295],
      [8.05, 1110, 82],  // Skill filter chip Python
      [8.95, 1110, 82],
      [9.35, 755, 265],  // Click Interview Stripe card
      [10.1, 950, 305],  // Scroll to interview prep
      [10.75, 1135, 197], // Click Mark practiced STAR button
      [11.4, 760, 470],  // Focus mock feedback panel
      [13.45, 760, 470],
      [13.85, 118, 292], // Sidebar Today tab
      [14.5, 620, 345],  // Hover deadline radar card
      [15.4, 118, 424],  // Sidebar Insights tab
      [16.2, 680, 410],  // Hover conversion funnel
      [17.0, 680, 410]
    ];
    for (let i = 0; i < pts.length - 1; i++) {
      const [t0, x0, y0] = pts[i];
      const [t1, x1, y1] = pts[i + 1];
      if (t >= t0 && t <= t1) {
        const p = seg(t, t0, t1);
        return { x: lerp(x0, x1, p), y: lerp(y0, y1, p) };
      }
    }
    const last = pts[pts.length - 1];
    return { x: last[1], y: last[2] };
  }

  function activeRipple(t) {
    const clicks = [
      [0.68, 118, 182],
      [1.76, 535, 298],
      [2.68, 878, 298],
      [3.95, 845, 558],
      [4.88, 118, 336],
      [6.85, 728, 295],
      [8.08, 1110, 82],
      [9.38, 755, 265],
      [10.78, 1135, 197],
      [13.88, 118, 292],
      [15.42, 118, 424]
    ];
    for (const [ct, cx, cy] of clicks) {
      if (t >= ct && t <= ct + 0.42) {
        const p = (t - ct) / 0.42;
        return { x: cx, y: cy, scale: 0.45 + p * 1.15, opacity: 1 - p };
      }
    }
    return null;
  }

  function renderTodayWorkflow(t, { highlightRadar = false } = {}) {
    return \`
      <header class="view-head">
        <div>
          <p class="eyebrow" style="--tab: var(--tab-today)">Today</p>
          <h1 class="view-title">Good morning, Jordan<span class="dot">.</span></h1>
          <p class="view-sub">Tuesday, Nov 17 - 3 priorities due this week</p>
        </div>
      </header>
      <section class="card strip" style="margin-bottom: 16px;">
        <div class="strip-top">
          <div class="strip-figure"><strong>11</strong><span>active applications</span></div>
          <div class="strip-rate">Response rate <b>42%</b> (5 of 12 sent)</div>
        </div>
        <div class="stack-bar">
          <span style="flex-grow:3; --s: var(--st-saved)"></span>
          <span style="flex-grow:4; --s: var(--st-applied)"></span>
          <span style="flex-grow:3; --s: var(--st-interview)"></span>
          <span style="flex-grow:1; --s: var(--st-offer)"></span>
        </div>
      </section>
      <div class="today-grid">
        <section class="card upcoming-card \${highlightRadar ? "is-hovered" : ""}" style="grid-column: span 7;">
          <div class="card-head">
            <div>
              <h2 class="card-title">Next up - Deadline Radar</h2>
              <p class="card-note">Upcoming interviews and closing dates</p>
            </div>
            <span class="pill st-INTERVIEW">24h &amp; 2h .ics reminders</span>
          </div>
          <ul class="agenda">
            <li class="agenda-day">
              <span class="agenda-date today">Tomorrow</span>
              <div class="agenda-items">
                <div class="agenda-item" style="background: var(--paper-2);">
                  <span class="agenda-kind" style="--s-bg: var(--st-interview-bg);">10a</span>
                  <div class="agenda-text">
                    <strong>Stripe - Technical Screen (45 min)</strong>
                    <span>Seattle, WA - Python, Go, SQL</span>
                  </div>
                </div>
              </div>
            </li>
            <li class="agenda-day">
              <span class="agenda-date">Fri Nov 20</span>
              <div class="agenda-items">
                <div class="agenda-item">
                  <span class="agenda-kind" style="--s-bg: var(--st-saved-bg);">Due</span>
                  <div class="agenda-text">
                    <strong>Northwind Robotics - Application Deadline</strong>
                    <span>Syncs to Apple &amp; Google Calendar via .ics</span>
                  </div>
                </div>
              </div>
            </li>
          </ul>
        </section>
        <section class="card goal-card" style="grid-column: span 5;">
          <div class="card-head">
            <div>
              <h2 class="card-title">Weekly Goal</h2>
              <p class="card-note">5 of 6 sent this week</p>
            </div>
          </div>
          <div class="week-dots">
            <div class="week-dot has"><i>M</i><span>1</span></div>
            <div class="week-dot has"><i>T</i><span>2</span></div>
            <div class="week-dot has"><i>W</i><span>1</span></div>
            <div class="week-dot has today"><i>T</i><span>1</span></div>
            <div class="week-dot future"><i>F</i><span>-</span></div>
            <div class="week-dot future"><i>S</i><span>-</span></div>
            <div class="week-dot future"><i>S</i><span>-</span></div>
          </div>
        </section>
      </div>
    \`;
  }

  function renderBoardWorkflow(t) {
    const dragStart = 5.6;
    const dragEnd = 6.8;
    const isDragging = t >= dragStart && t < dragEnd;
    const dropped = t >= dragEnd;
    const filterPython = t >= 8.1;

    const dragP = seg(t, dragStart, dragEnd);
    const dragX = lerp(474, 678, dragP);
    const dragY = lerp(238, 224, dragP) - Math.sin(dragP * Math.PI) * 18;

    const stripeCardHtml = (showStamp) => \`
      <article class="app-card st-\${dropped ? "INTERVIEW" : "APPLIED"}" style="\${dropped ? "border-color: var(--st-interview); box-shadow: 0 0 0 2px color-mix(in srgb, var(--st-interview) 28%, transparent), var(--shadow-md);" : ""}">
        <div class="app-card-top"><span class="app-company">Stripe</span></div>
        <h3 class="app-role">Software Engineer Intern</h3>
        <div class="app-meta"><span>Seattle, WA</span></div>
        <div class="chips"><span class="chip">Python</span><span class="chip">Go</span><span class="chip">SQL</span></div>
        \${showStamp ? '<span class="demo-history-stamp">Moved to Interview - Just now</span>' : ""}
      </article>
    \`;

    return \`
      <header class="view-head">
        <div>
          <p class="eyebrow" style="--tab: var(--tab-board)">Board</p>
          <h1 class="view-title">Pipeline Board<span class="dot">.</span></h1>
        </div>
        <div class="filters" style="margin:0;">
          <button type="button" class="filter-chip" aria-pressed="\${!filterPython}">All (11)</button>
          <button type="button" class="filter-chip \${t >= 7.8 && t < 8.1 ? "is-hovered" : ""}" aria-pressed="\${filterPython}">Python (3)</button>
          <button type="button" class="filter-chip" aria-pressed="false">TypeScript (4)</button>
        </div>
      </header>
      <div class="board" style="grid-auto-columns: minmax(175px, 1fr); gap: 10px;">
        <section class="column st-SAVED">
          <div class="column-head"><span class="dot"></span><h2>Saved</h2><span class="count">\${filterPython ? 1 : 3}</span></div>
          <div class="column-cards">
            <article class="app-card st-SAVED">
              <div class="app-card-top"><span class="app-company">Northwind</span></div>
              <h3 class="app-role">Backend Intern</h3>
              <div class="chips"><span class="chip">Python</span><span class="chip">SQL</span></div>
            </article>
            \${filterPython ? "" : '<article class="app-card st-SAVED"><div class="app-card-top"><span class="app-company">Figma</span></div><h3 class="app-role">Product Design</h3><div class="chips"><span class="chip">Figma</span></div></article>'}
          </div>
        </section>
        <section class="column st-APPLIED">
          <div class="column-head"><span class="dot"></span><h2>Applied</h2><span class="count">\${dropped || isDragging ? (filterPython ? 0 : 2) : (filterPython ? 1 : 3)}</span></div>
          <div class="column-cards">
            \${(!isDragging && !dropped) ? stripeCardHtml(false) : ""}
            \${filterPython ? "" : '<article class="app-card st-APPLIED"><div class="app-card-top"><span class="app-company">Shopify</span></div><h3 class="app-role">Frontend Intern</h3><div class="chips"><span class="chip">React</span></div></article>'}
          </div>
        </section>
        <section class="column st-INTERVIEW \${isDragging ? "drop" : ""}">
          <div class="column-head"><span class="dot"></span><h2>Interview</h2><span class="count">\${dropped ? 2 : 1}</span></div>
          <div class="column-cards">
            \${dropped ? stripeCardHtml(true) : ""}
            <article class="app-card st-INTERVIEW">
              <div class="app-card-top"><span class="app-company">Cedar Grove</span></div>
              <h3 class="app-role">ML Engineering Intern</h3>
              <div class="chips"><span class="chip">Python</span><span class="chip">PyTorch</span></div>
            </article>
          </div>
        </section>
        <section class="column st-OFFER">
          <div class="column-head"><span class="dot"></span><h2>Offer</h2><span class="count">\${filterPython ? 0 : 1}</span></div>
          <div class="column-cards">
            \${filterPython ? "" : '<article class="app-card st-OFFER"><div class="app-card-top"><span class="app-company">Kitebird</span></div><h3 class="app-role">Platform Intern</h3><div class="chips"><span class="chip">Go</span></div></article>'}
          </div>
        </section>
      </div>
      \${isDragging ? \`
        <article class="app-card st-APPLIED demo-drag-card" style="left:\${dragX}px; top:\${dragY}px;">
          <div class="app-card-top"><span class="app-company">Stripe</span></div>
          <h3 class="app-role">Software Engineer Intern</h3>
          <div class="app-meta"><span>Seattle, WA</span></div>
          <div class="chips"><span class="chip">Python</span><span class="chip">Go</span><span class="chip">SQL</span></div>
        </article>
      \` : ""}
    \`;
  }

  function getMockStats(t) {
    const p = seg(t, 10.78, 10.98);
    return {
      score: Math.round(lerp(62, 88, p)),
      wpm: Math.round(lerp(122, 138, p))
    };
  }

  function renderEntryPrepWorkflow(t) {
    const scrollOffset = seg(t, 9.7, 10.45) * 195;
    const practiced = t >= 10.78;
    const mockReveal = seg(t, 10.48, 10.95);
    const { score, wpm } = getMockStats(t);

    return \`
      <div style="transform: translateY(-\${scrollOffset.toFixed(1)}px);">
        <article class="sheet-page" style="padding: 24px 32px 28px 74px;">
          <div class="entry-head" style="margin-bottom: 14px;">
            <span class="entry-company">Stripe</span>
            <h1 class="entry-role" style="font-size: 1.85rem;">Software Engineer Intern</h1>
          </div>
          <div class="stepper" style="margin-bottom: 18px;">
            <div class="steps">
              <div class="step done st-SAVED"><span>Saved</span></div>
              <div class="step done st-APPLIED"><span>Applied</span></div>
              <div class="step current st-INTERVIEW"><span>Interview</span></div>
              <div class="step st-OFFER"><span>Offer</span></div>
            </div>
          </div>
          <div class="entry-fields" style="margin-bottom: 14px;">
            <div class="line-field"><span>Location</span><div style="padding:4px 0; font-weight:600;">Seattle, WA</div></div>
            <div class="line-field"><span>Skills</span><div style="padding:4px 0; font-weight:600;">Python, Go, SQL</div></div>
          </div>
          <section class="prep" style="margin-top: 12px; padding-top: 14px;">
            <div class="prep-head">
              <div>
                <h2 class="card-title">Role-matched interview prep</h2>
                <p class="prep-sub">STAR behavioral and backend system prompts</p>
              </div>
              <span class="prep-summary">\${practiced ? "4 of 6 practiced" : "3 of 6 practiced"}</span>
            </div>
            <div class="prep-progress">
              <div class="prep-bar"><i style="width:\${practiced ? 67 : 50}%"></i></div>
            </div>
            <div class="prep-group" style="background: var(--card);">
              <ul class="prep-list" style="padding: 4px 14px;">
                <li class="prep-q \${practiced ? "is-practiced" : ""}">
                  <span class="prep-text">Tell me about a system bottleneck you diagnosed and resolved (STAR).</span>
                  <div class="prep-actions">
                    <button type="button" class="prep-mark practiced \${t >= 10.5 && t < 10.78 ? "is-hovered" : ""}" aria-pressed="\${practiced}">\${practiced ? "Practiced" : "Mark practiced"}</button>
                  </div>
                </li>
                <li class="prep-q">
                  <span class="prep-text">Design an idempotent webhook delivery queue with retries in Go.</span>
                  <div class="prep-actions">
                    <button type="button" class="prep-mark practiced" aria-pressed="true">Practiced</button>
                  </div>
                </li>
              </ul>
            </div>
            <div class="demo-mock-card" style="opacity:\${mockReveal.toFixed(2)}; transform: translateY(\${((1 - mockReveal) * 12).toFixed(1)}px);">
              <div class="demo-mock-score-box">
                <strong>\${score} / 100</strong>
                <span>Readiness</span>
              </div>
              <div>
                <strong style="font-size: 0.96rem; color: var(--ink);">Timed Mock Interview Feedback</strong>
                <div class="demo-mock-metrics">
                  <span class="demo-metric-pill good">STAR structure complete</span>
                  <span class="demo-metric-pill">\${wpm} wpm</span>
                  <span class="demo-metric-pill">0 filler phrases</span>
                </div>
              </div>
            </div>
          </section>
        </article>
      </div>
    \`;
  }

  function renderInsightsWorkflow(t) {
    const barP = seg(t, 15.45, 16.4);
    return \`
      <header class="view-head">
        <div>
          <p class="eyebrow" style="--tab: var(--tab-insights)">Insights</p>
          <h1 class="view-title">Search Insights<span class="dot">.</span></h1>
          <p class="view-sub">Conversion rates and top skills across your notebook</p>
        </div>
      </header>
      <section class="kpis">
        <article class="card kpi"><p>Applications</p><strong>24</strong><span>11 active</span></article>
        <article class="card kpi"><p>Response rate</p><strong>42%</strong><span>+9% this month</span></article>
        <article class="card kpi"><p>Interviews</p><strong>5</strong><span>33% of applied</span></article>
        <article class="card kpi"><p>Offers</p><strong>2</strong><span>11% conversion</span></article>
        <article class="card kpi"><p>Prep practiced</p><strong>88%</strong><span>STAR complete</span></article>
      </section>
      <div class="insight-grid">
        <section class="card">
          <div class="card-head"><div><h2 class="card-title">Response-Rate Conversion Funnel</h2><p class="card-note">Stage progression across sent applications</p></div></div>
          <div class="funnel">
            <div class="funnel-row"><span>Saved</span><div class="funnel-track"><div class="funnel-bar" style="width:\${(100 * barP).toFixed(1)}%; background: var(--st-saved);"></div><span class="funnel-value">24 <small>(100%)</small></span></div></div>
            <div class="funnel-row"><span>Applied</span><div class="funnel-track"><div class="funnel-bar" style="width:\${(75 * barP).toFixed(1)}%; background: var(--st-applied);"></div><span class="funnel-value">18 <small>(75%)</small></span></div></div>
            <div class="funnel-row"><span>Interview</span><div class="funnel-track"><div class="funnel-bar" style="width:\${(33 * barP).toFixed(1)}%; background: var(--st-interview);"></div><span class="funnel-value">6 <small>(33%)</small></span></div></div>
            <div class="funnel-row"><span>Offer</span><div class="funnel-track"><div class="funnel-bar" style="width:\${(14 * barP).toFixed(1)}%; background: var(--st-offer);"></div><span class="funnel-value">2 <small>(11%)</small></span></div></div>
          </div>
        </section>
        <section class="card">
          <div class="card-head"><div><h2 class="card-title">Top Skills in Interviews</h2><p class="card-note">Highest callback rate by tag</p></div></div>
          <div class="skill-bars">
            <div class="skill-bar"><span>Python</span><i style="width:\${(92 * barP).toFixed(1)}%"></i><b>9</b></div>
            <div class="skill-bar"><span>Go</span><i style="width:\${(72 * barP).toFixed(1)}%"></i><b>7</b></div>
            <div class="skill-bar"><span>SQL</span><i style="width:\${(64 * barP).toFixed(1)}%"></i><b>6</b></div>
            <div class="skill-bar"><span>TypeScript</span><i style="width:\${(52 * barP).toFixed(1)}%"></i><b>5</b></div>
          </div>
        </section>
      </div>
    \`;
  }

  function renderModal(t) {
    const modal = document.getElementById("demo-modal");
    if (t < 0.72 || t >= 4.45) {
      modal.classList.remove("is-open");
      modal.innerHTML = "";
      return;
    }
    modal.classList.add("is-open");

    const typingP = clamp((t - 1.8) / 0.8, 0, 1);
    const typedCount = Math.round(typingP * QUICK_URL.length);
    const typedText = QUICK_URL.slice(0, typedCount);
    const filled = t >= 2.72;
    const flash = t >= 2.72 && t < 3.45;
    const saveHover = t >= 3.7 && t < 4.05;
    const fillHover = t >= 2.55 && t < 2.72;

    modal.innerHTML = \`
      <div class="demo-modal-card">
        <header class="sheet-head">
          <div>
            <p class="eyebrow">New page</p>
            <h2>Add an application</h2>
          </div>
        </header>
        <div class="sheet-body">
          <div class="quickfill-bar">
            <span class="field-label">Quick fill from link or job text</span>
            <div class="quickfill-row">
              <div class="demo-quickfill-display \${t >= 1.75 && t < 2.72 ? "is-focused" : ""}">
                \${typedCount > 0 ? \`<span>\${typedText}</span>\${typingP < 1 ? '<span class="demo-typing-caret"></span>' : ''}\` : '<span class="demo-quickfill-placeholder">Paste a job URL or title...</span>'}
              </div>
              <button class="button small \${fillHover ? "is-hovered" : ""}" type="button">Fill</button>
            </div>
          </div>
          <div class="field-grid">
            <div class="field">
              <span class="field-label">Company</span>
              <div class="demo-field-box \${filled ? (flash ? "demo-autofill-flash" : "") : "is-empty"}">\${filled ? "Stripe" : "e.g. Shopify"}</div>
            </div>
            <div class="field">
              <span class="field-label">Role</span>
              <div class="demo-field-box \${filled ? (flash ? "demo-autofill-flash" : "") : "is-empty"}">\${filled ? "Software Engineer Intern" : "e.g. Backend Intern"}</div>
            </div>
            <div class="field">
              <span class="field-label">Location</span>
              <div class="demo-field-box \${filled ? (flash ? "demo-autofill-flash" : "") : "is-empty"}">\${filled ? "Seattle, WA" : "City or Remote"}</div>
            </div>
            <div class="field">
              <span class="field-label">Skills</span>
              <div class="demo-field-box \${filled ? (flash ? "demo-autofill-flash" : "") : "is-empty"}">\${filled ? "Python, Go, SQL" : "Comma separated"}</div>
            </div>
          </div>
        </div>
        <footer class="sheet-foot">
          <button class="button ghost" type="button">Cancel</button>
          <button class="button primary \${saveHover ? "is-hovered" : ""}" type="button">Save to notebook</button>
        </footer>
      </div>
    \`;
  }

  function cameraTransform(t) {
    // Smooth zoom focus transitions on the paper workspace while keeping the sidebar crisp
    if (t >= 5.5 && t < 7.3) {
      const z = Math.sin(clamp((t - 5.5) / 1.8, 0, 1) * Math.PI);
      return \`scale(\${(1 + 0.04 * z).toFixed(4)})\`;
    }
    if (t >= 11.2 && t < 13.3) {
      const z = Math.sin(clamp((t - 11.2) / 2.1, 0, 1) * Math.PI);
      return \`scale(\${(1 + 0.045 * z).toFixed(4)}) translate(0px, \${(-12 * z).toFixed(1)}px)\`;
    }
    return "scale(1) translate(0px, 0px)";
  }

  window.__setDemoTime = function (t) {
    const view = document.getElementById("demo-view");
    const navToday = document.getElementById("nav-today");
    const navBoard = document.getElementById("nav-board");
    const navInsights = document.getElementById("nav-insights");
    const navNew = document.getElementById("nav-new-btn");
    const toast = document.getElementById("demo-toast");
    const callout = document.getElementById("demo-callout");

    [navToday, navBoard, navInsights].forEach(el => {
      el.removeAttribute("aria-current");
      el.classList.remove("is-hovered");
    });
    navNew.classList.remove("is-hovered");

    if (t < 4.5) {
      navToday.setAttribute("aria-current", "page");
      if (t >= 0.45 && t < 0.72) navNew.classList.add("is-hovered");
      view.innerHTML = renderTodayWorkflow(t);
      toast.style.display = (t >= 4.02 && t < 4.5) ? "flex" : "none";
      toast.textContent = "Stripe saved to notebook";
      const sub = t < 1.7 ? "Open quick-fill clipper" : t < 2.7 ? "Parsing Greenhouse URL..." : "4 fields snapped into place";
      callout.innerHTML = \`<span class="demo-callout-step">01</span><span>1-Click Job Clipper</span><span class="demo-callout-sub">\${sub}</span>\`;
    } else if (t < 9.0) {
      navBoard.setAttribute("aria-current", "page");
      if (t >= 4.65 && t < 4.88) navBoard.classList.add("is-hovered");
      view.innerHTML = renderBoardWorkflow(t);
      toast.style.display = "none";
      const sub = t < 6.8 ? "Dragging Stripe -> Interview" : t < 8.1 ? "Dated history stamp added" : "Filtered by skill: Python";
      callout.innerHTML = \`<span class="demo-callout-step">02</span><span>Kanban Pipeline Board</span><span class="demo-callout-sub">\${sub}</span>\`;
    } else if (t < 13.5) {
      navBoard.setAttribute("aria-current", "page");
      view.innerHTML = renderEntryPrepWorkflow(t);
      toast.style.display = "none";
      const { score, wpm } = getMockStats(t);
      const sub = t < 10.78 ? "Role-matched STAR prompts" : \`Mock score: \${score} / 100 - \${wpm} wpm\`;
      callout.innerHTML = \`<span class="demo-callout-step">03</span><span>Interview Prep &amp; Mock</span><span class="demo-callout-sub">\${sub}</span>\`;
    } else {
      if (t < 15.4) {
        navToday.setAttribute("aria-current", "page");
        view.innerHTML = renderTodayWorkflow(t, { highlightRadar: true });
        callout.innerHTML = \`<span class="demo-callout-step">04</span><span>Deadlines &amp; Insights</span><span class="demo-callout-sub">Upcoming radar &amp; .ics alerts</span>\`;
      } else {
        navInsights.setAttribute("aria-current", "page");
        view.innerHTML = renderInsightsWorkflow(t);
        callout.innerHTML = \`<span class="demo-callout-step">04</span><span>Deadlines &amp; Insights</span><span class="demo-callout-sub">42% response conversion funnel</span>\`;
      }
      toast.style.display = "none";
    }

    renderModal(t);

    document.getElementById("demo-camera").style.transform = cameraTransform(t);

    const pos = cursorPath(t);
    const cursor = document.getElementById("demo-cursor");
    cursor.style.transform = \`translate(\${pos.x.toFixed(1)}px, \${pos.y.toFixed(1)}px)\`;

    const rip = activeRipple(t);
    const rippleEl = document.getElementById("demo-ripple");
    if (rip) {
      rippleEl.style.display = "block";
      rippleEl.style.left = \`\${rip.x.toFixed(1)}px\`;
      rippleEl.style.top = \`\${rip.y.toFixed(1)}px\`;
      rippleEl.style.transform = \`scale(\${rip.scale.toFixed(3)})\`;
      rippleEl.style.opacity = rip.opacity.toFixed(3);
    } else {
      rippleEl.style.display = "none";
    }
  };

  window.__setDemoTime(0);
})();
</script>
</body>
</html>`;
}

function encodeWebm(ffmpegBin, framePaths, tempDir, outPath) {
  const mjpegPath = path.join(tempDir, "frames.mjpeg");
  fs.writeFileSync(mjpegPath, Buffer.concat(framePaths.map(p => fs.readFileSync(p))));
  const bitrates = [520, 680, 400, 820];

  for (const kbps of bitrates) {
    const res = spawnSync(
      ffmpegBin,
      [
        "-y",
        "-f", "image2pipe",
        "-vcodec", "mjpeg",
        "-r", String(FPS),
        "-i", mjpegPath,
        "-c:v", "libvpx",
        "-b:v", `${kbps}k`,
        "-minrate", `${Math.round(kbps * 0.6)}k`,
        "-maxrate", `${Math.round(kbps * 1.35)}k`,
        "-crf", "16",
        "-qmin", "6",
        "-qmax", "36",
        "-pix_fmt", "yuv420p",
        "-deadline", "good",
        "-cpu-used", "2",
        "-auto-alt-ref", "0",
        "-f", "webm",
        outPath
      ],
      { encoding: "utf8" }
    );
    if (res.status !== 0) {
      throw new Error(`ffmpeg WebM encoding failed: ${res.stderr?.toString()}`);
    }
    const size = fs.statSync(outPath).size;
    console.log(`WebM bitrate=${kbps}k -> ${size} bytes`);
    if (size >= MIN_VIDEO_BYTES && size <= MAX_VIDEO_BYTES) {
      return size;
    }
  }
  const finalSize = fs.statSync(outPath).size;
  if (finalSize > MAX_VIDEO_BYTES) {
    throw new Error(`WebM exceeded 1.2 MB (${finalSize} bytes)`);
  }
  return finalSize;
}

function encodeMp4WithSwift(framesDir, outPath) {
  const swiftScript = path.join(framesDir, "encode_mp4.swift");
  const swiftSource = `
import AVFoundation
import CoreVideo
import Foundation
import ImageIO

let args = CommandLine.arguments
let framesDir = args[1]
let outPath = args[2]
let frameCount = Int(args[3])!
let fps = Int32(args[4])!
let bitrate = Int(args[5])!

let outURL = URL(fileURLWithPath: outPath)
try? FileManager.default.removeItem(at: outURL)

let writer = try AVAssetWriter(outputURL: outURL, fileType: .mp4)
writer.shouldOptimizeForNetworkUse = true

let settings: [String: Any] = [
  AVVideoCodecKey: AVVideoCodecType.h264,
  AVVideoWidthKey: 1280,
  AVVideoHeightKey: 720,
  AVVideoCompressionPropertiesKey: [
    AVVideoAverageBitRateKey: bitrate,
    AVVideoMaxKeyFrameIntervalKey: 24,
    AVVideoProfileLevelKey: AVVideoProfileLevelH264HighAutoLevel
  ]
]

let input = AVAssetWriterInput(mediaType: .video, outputSettings: settings)
input.expectsMediaDataInRealTime = false

let attrs: [String: Any] = [
  kCVPixelBufferPixelFormatTypeKey as String: kCVPixelFormatType_32ARGB,
  kCVPixelBufferWidthKey as String: 1280,
  kCVPixelBufferHeightKey as String: 720
]
let adaptor = AVAssetWriterInputPixelBufferAdaptor(assetWriterInput: input, sourcePixelBufferAttributes: attrs)

guard writer.canAdd(input) else { fatalError("Cannot add AVAssetWriterInput") }
writer.add(input)
writer.startWriting()
writer.startSession(atSourceTime: .zero)

func pixelBuffer(from imagePath: String, pool: CVPixelBufferPool?) -> CVPixelBuffer? {
  guard let source = CGImageSourceCreateWithURL(URL(fileURLWithPath: imagePath) as CFURL, nil),
        let cgImage = CGImageSourceCreateImageAtIndex(source, 0, nil) else { return nil }
  var buffer: CVPixelBuffer?
  if let pool = pool {
    CVPixelBufferPoolCreatePixelBuffer(nil, pool, &buffer)
  } else {
    CVPixelBufferCreate(nil, 1280, 720, kCVPixelFormatType_32ARGB, attrs as CFDictionary, &buffer)
  }
  guard let pb = buffer else { return nil }
  CVPixelBufferLockBaseAddress(pb, [])
  let data = CVPixelBufferGetBaseAddress(pb)
  let colorSpace = CGColorSpaceCreateDeviceRGB()
  if let ctx = CGContext(
    data: data,
    width: 1280,
    height: 720,
    bitsPerComponent: 8,
    bytesPerRow: CVPixelBufferGetBytesPerRow(pb),
    space: colorSpace,
    bitmapInfo: CGImageAlphaInfo.noneSkipFirst.rawValue
  ) {
    ctx.draw(cgImage, in: CGRect(x: 0, y: 0, width: 1280, height: 720))
  }
  CVPixelBufferUnlockBaseAddress(pb, [])
  return pb
}

for i in 0..<frameCount {
  while !input.isReadyForMoreMediaData {
    Thread.sleep(forTimeInterval: 0.005)
  }
  let file = String(format: "%@/frame_%04d.jpg", framesDir, i)
  guard let pb = pixelBuffer(from: file, pool: adaptor.pixelBufferPool) else {
    fatalError("Failed to decode frame \\(i)")
  }
  let pts = CMTime(value: CMTimeValue(i), timescale: fps)
  adaptor.append(pb, withPresentationTime: pts)
}

input.markAsFinished()
let sema = DispatchSemaphore(value: 0)
writer.finishWriting { sema.signal() }
sema.wait()
if writer.status != .completed {
  fatalError("AVAssetWriter failed: \\(String(describing: writer.error))")
}
`;
  fs.writeFileSync(swiftScript, swiftSource);

  const tempOut = path.join(framesDir, "temp_out.mp4");
  const bitrates = [420_000, 340_000, 500_000];
  for (const bps of bitrates) {
    const res = spawnSync(
      "/usr/bin/swift",
      [swiftScript, framesDir, tempOut, String(TOTAL_FRAMES), String(FPS), String(bps)],
      { encoding: "utf8" }
    );
    if (res.status !== 0) {
      throw new Error(`Swift MP4 encoding failed: ${res.stderr}`);
    }
    const size = fs.statSync(tempOut).size;
    console.log(`MP4 bitrate=${bps} -> ${size} bytes`);
    if (size >= MIN_VIDEO_BYTES && size <= MAX_VIDEO_BYTES) {
      fs.copyFileSync(tempOut, outPath);
      return size;
    }
  }
  const finalSize = fs.statSync(tempOut).size;
  if (finalSize > MAX_VIDEO_BYTES) {
    throw new Error(`MP4 exceeded 1.2 MB (${finalSize} bytes)`);
  }
  fs.copyFileSync(tempOut, outPath);
  return finalSize;
}

function checkMp4Faststart(mp4Path) {
  const buf = fs.readFileSync(mp4Path);
  const moovIdx = buf.indexOf(Buffer.from("moov"));
  const mdatIdx = buf.indexOf(Buffer.from("mdat"));
  return { moovIdx, mdatIdx, faststart: moovIdx !== -1 && mdatIdx !== -1 && moovIdx < mdatIdx };
}

async function main() {
  fs.mkdirSync(MEDIA_DIR, { recursive: true });
  const appCss = fs.readFileSync(STYLES_PATH, "utf8");
  const ffmpegBin = findFfmpeg();

  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "demo-tour-frames-"));
  const framePaths = [];

  const browser = await chromium.launch({ headless: true });
  try {
    const context = await browser.newContext({
      viewport: { width: WIDTH, height: HEIGHT },
      deviceScaleFactor: 1
    });
    const page = await context.newPage();
    await page.setContent(buildSceneHtml(appCss), { waitUntil: "load" });

    for (let i = 0; i < TOTAL_FRAMES; i++) {
      const t = i / FPS;
      await page.evaluate(time => window.__setDemoTime(time), t);
      const framePath = path.join(tempDir, `frame_${String(i).padStart(4, "0")}.jpg`);
      await page.screenshot({ path: framePath, type: "jpeg", quality: 92 });
      framePaths.push(framePath);
    }

    // Export poster from the crisp autofill frame (t = 3.25s, frame 39)
    const posterPath = path.join(MEDIA_DIR, "demo-tour-poster.jpg");
    await page.evaluate(() => window.__setDemoTime(3.25));
    await page.screenshot({ path: posterPath, type: "jpeg", quality: 90 });

    const mp4Path = path.join(MEDIA_DIR, "demo-tour.mp4");
    const webmPath = path.join(MEDIA_DIR, "demo-tour.webm");

    const webmBytes = encodeWebm(ffmpegBin, framePaths, tempDir, webmPath);
    const mp4Bytes = encodeMp4WithSwift(tempDir, mp4Path);
    const posterBytes = fs.statSync(posterPath).size;
    const faststart = checkMp4Faststart(mp4Path);

    console.log(JSON.stringify({
      frames: TOTAL_FRAMES,
      fps: FPS,
      durationSec: DURATION_SEC,
      posterBytes,
      mp4Bytes,
      webmBytes,
      faststart
    }, null, 2));

    if (!faststart.faststart) {
      throw new Error("MP4 is not faststart (moov atom must precede mdat)");
    }
  } finally {
    await browser.close();
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
