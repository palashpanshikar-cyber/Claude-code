/* ============================================================
   ReModelAI — budget.js
   Budget tracking: donut chart, alerts, export, projections
   ============================================================ */

'use strict';

window.BudgetTracker = (function () {

  // ── State ────────────────────────────────────────────────
  const COLORS = ['#7c3aed', '#06b6d4', '#10b981', '#f59e0b', '#ef4444', '#a855f7', '#0ea5e9', '#14b8a6', '#fb923c', '#6366f1'];

  let state = {
    totalBudget: 50000,
    categories: [
      { name: 'Renovation',  budget: 20000, spent: 14500 },
      { name: 'Equipment',   budget: 8000,  spent: 6200  },
      { name: 'Marketing',   budget: 5000,  spent: 4100  },
      { name: 'Permits',     budget: 3000,  spent: 1200  },
      { name: 'Labor',       budget: 12000, spent: 9800  },
      { name: 'Other',       budget: 2000,  spent: 600   }
    ],
    alertShown: {}
  };

  let donutCanvas  = null;
  let donutCtx     = null;
  let gaugeCanvas  = null;
  let gaugeCtx     = null;
  let alertModal   = null;

  // ── Init ─────────────────────────────────────────────────
  function init(options = {}) {
    if (options.totalBudget) state.totalBudget = options.totalBudget;
    if (options.categories)  state.categories  = options.categories;

    donutCanvas = document.getElementById('donutCanvas');
    if (donutCanvas) donutCtx = donutCanvas.getContext('2d');

    gaugeCanvas = document.getElementById('gaugeCanvas');
    if (gaugeCanvas) gaugeCtx = gaugeCanvas.getContext('2d');

    alertModal = document.getElementById('budgetAlertModal');

    render();
    checkAlerts(false);
  }

  // ── Render all ───────────────────────────────────────────
  function render() {
    renderDonut();
    renderGauge();
    renderList();
    renderSummary();
  }

  // ── Donut Chart ───────────────────────────────────────────
  function renderDonut() {
    if (!donutCtx || !donutCanvas) return;

    const dpr = window.devicePixelRatio || 1;
    const size = donutCanvas.clientWidth || 240;
    donutCanvas.width  = size * dpr;
    donutCanvas.height = size * dpr;
    donutCtx.scale(dpr, dpr);

    const cx = size / 2;
    const cy = size / 2;
    const outerR = size * 0.42;
    const innerR = size * 0.27;

    donutCtx.clearRect(0, 0, size, size);

    const totalSpent = state.categories.reduce((s, c) => s + c.spent, 0);
    if (totalSpent === 0) {
      drawEmptyDonut(donutCtx, cx, cy, outerR, innerR, size);
      return;
    }

    let startAngle = -Math.PI / 2;

    state.categories.forEach((cat, i) => {
      if (cat.spent <= 0) return;
      const slice = (cat.spent / totalSpent) * 2 * Math.PI;

      // Shadow glow
      donutCtx.save();
      donutCtx.shadowColor = COLORS[i % COLORS.length];
      donutCtx.shadowBlur = 8;

      donutCtx.beginPath();
      donutCtx.moveTo(cx, cy);
      donutCtx.arc(cx, cy, outerR, startAngle, startAngle + slice);
      donutCtx.closePath();
      donutCtx.fillStyle = COLORS[i % COLORS.length];
      donutCtx.fill();
      donutCtx.restore();

      startAngle += slice;
    });

    // Inner circle cutout
    donutCtx.beginPath();
    donutCtx.arc(cx, cy, innerR, 0, 2 * Math.PI);
    donutCtx.fillStyle = '#16213e';
    donutCtx.fill();

    // Divider lines
    startAngle = -Math.PI / 2;
    state.categories.forEach((cat) => {
      if (cat.spent <= 0) return;
      const slice = (cat.spent / totalSpent) * 2 * Math.PI;
      donutCtx.save();
      donutCtx.beginPath();
      donutCtx.moveTo(cx + Math.cos(startAngle) * innerR, cy + Math.sin(startAngle) * innerR);
      donutCtx.lineTo(cx + Math.cos(startAngle) * outerR, cy + Math.sin(startAngle) * outerR);
      donutCtx.strokeStyle = '#16213e';
      donutCtx.lineWidth = 3;
      donutCtx.stroke();
      donutCtx.restore();
      startAngle += slice;
    });

    // Center text
    const pct = Math.round((totalSpent / state.totalBudget) * 100);
    donutCtx.fillStyle = '#f1f5f9';
    donutCtx.font = `bold ${Math.round(size * 0.12)}px system-ui`;
    donutCtx.textAlign = 'center';
    donutCtx.textBaseline = 'middle';
    donutCtx.fillText(pct + '%', cx, cy - size * 0.04);
    donutCtx.font = `${Math.round(size * 0.07)}px system-ui`;
    donutCtx.fillStyle = '#64748b';
    donutCtx.fillText('of budget', cx, cy + size * 0.06);

    // Update legend
    renderLegend(totalSpent);
  }

  function drawEmptyDonut(ctx, cx, cy, outerR, innerR, size) {
    ctx.beginPath();
    ctx.arc(cx, cy, outerR, 0, 2 * Math.PI);
    ctx.fillStyle = '#2d3a5a';
    ctx.fill();
    ctx.beginPath();
    ctx.arc(cx, cy, innerR, 0, 2 * Math.PI);
    ctx.fillStyle = '#16213e';
    ctx.fill();
    ctx.fillStyle = '#64748b';
    ctx.font = `${Math.round(size * 0.09)}px system-ui`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('No data', cx, cy);
  }

  function renderLegend(totalSpent) {
    const legend = document.getElementById('donutLegend');
    if (!legend) return;

    legend.innerHTML = state.categories.map((cat, i) => `
      <div class="legend-item">
        <div class="legend-color" style="background:${COLORS[i % COLORS.length]}"></div>
        <span class="legend-label">${cat.name}</span>
        <span class="legend-value">$${cat.spent.toLocaleString()}</span>
      </div>
    `).join('');
  }

  // ── Gauge Chart ───────────────────────────────────────────
  function renderGauge() {
    if (!gaugeCtx || !gaugeCanvas) return;

    const size = 160;
    gaugeCanvas.width  = size;
    gaugeCanvas.height = size;

    const totalSpent = state.categories.reduce((s, c) => s + c.spent, 0);
    const pct = Math.min(totalSpent / state.totalBudget, 1);
    const angle = pct * 2 * Math.PI;

    gaugeCtx.clearRect(0, 0, size, size);

    const cx = size / 2, cy = size / 2, r = 65, lineW = 14;

    // Background ring
    gaugeCtx.beginPath();
    gaugeCtx.arc(cx, cy, r, 0, 2 * Math.PI);
    gaugeCtx.strokeStyle = '#2d3a5a';
    gaugeCtx.lineWidth = lineW;
    gaugeCtx.stroke();

    // Filled arc
    const color = pct < 0.7 ? '#10b981' : pct < 0.9 ? '#f59e0b' : '#ef4444';

    gaugeCtx.beginPath();
    gaugeCtx.arc(cx, cy, r, 0, angle);
    gaugeCtx.strokeStyle = color;
    gaugeCtx.lineWidth = lineW;
    gaugeCtx.lineCap = 'round';
    gaugeCtx.stroke();

    // Update percent text
    const percentEl = document.getElementById('gaugePercent');
    const statusEl  = document.getElementById('gaugeStatus');

    if (percentEl) percentEl.textContent = Math.round(pct * 100) + '%';

    if (statusEl) {
      statusEl.className = 'gauge-status ';
      if (pct < 0.7) {
        statusEl.textContent = '✓ On Track';
        statusEl.className += 'gauge-green';
      } else if (pct < 0.9) {
        statusEl.textContent = '⚠ Approaching Limit';
        statusEl.className += 'gauge-yellow';
      } else {
        statusEl.textContent = '🚨 Over Threshold';
        statusEl.className += 'gauge-red';
      }
    }
  }

  // ── Budget list ───────────────────────────────────────────
  function renderList() {
    const container = document.getElementById('budgetList');
    if (!container) return;

    if (state.categories.length === 0) {
      container.innerHTML = '<p style="color:var(--text-muted);text-align:center;padding:20px;">No categories yet. Add your first expense above!</p>';
      return;
    }

    container.innerHTML = state.categories.map((cat, i) => {
      const pct = cat.budget > 0 ? Math.min(cat.spent / cat.budget * 100, 100) : 0;
      const color = pct < 70 ? '#10b981' : pct < 90 ? '#f59e0b' : '#ef4444';
      return `
        <div class="budget-item" id="budget-item-${i}">
          <div class="budget-item-color" style="background:${COLORS[i % COLORS.length]};border-radius:50%;width:10px;height:10px;"></div>
          <div class="budget-item-info">
            <div class="budget-item-name">${escapeHtml(cat.name)}</div>
            <div class="budget-item-amount">$${cat.spent.toLocaleString()} / $${cat.budget.toLocaleString()}</div>
          </div>
          <div class="budget-item-bar-wrap" style="width:100px;">
            <div class="budget-bar">
              <div class="budget-bar-fill" style="width:${pct}%;background:${color};"></div>
            </div>
          </div>
          <span class="budget-item-pct" style="color:${color};font-size:0.78rem;font-weight:700;min-width:38px;text-align:right;">${Math.round(pct)}%</span>
          <button class="budget-delete" onclick="BudgetTracker.removeCategory(${i})" title="Remove category">✕</button>
        </div>
      `;
    }).join('');
  }

  // ── Summary row ───────────────────────────────────────────
  function renderSummary() {
    const totalSpent    = state.categories.reduce((s, c) => s + c.spent, 0);
    const totalBudgeted = state.categories.reduce((s, c) => s + c.budget, 0);
    const remaining     = state.totalBudget - totalSpent;
    const projected     = calcProjected();

    const els = {
      summarySpent:     document.getElementById('summarySpent'),
      summaryRemaining: document.getElementById('summaryRemaining'),
      summaryProjected: document.getElementById('summaryProjected'),
    };

    if (els.summarySpent)     els.summarySpent.textContent     = '$' + totalSpent.toLocaleString();
    if (els.summaryRemaining) els.summaryRemaining.textContent = '$' + Math.max(remaining, 0).toLocaleString();
    if (els.summaryProjected) {
      els.summaryProjected.textContent = '$' + projected.toLocaleString();
      els.summaryProjected.style.color = projected > state.totalBudget ? '#ef4444' : '#10b981';
    }
  }

  function calcProjected() {
    // Simple projection: if we're 60% through the project, extrapolate
    const totalSpent   = state.categories.reduce((s, c) => s + c.spent, 0);
    const totalBudget  = state.categories.reduce((s, c) => s + c.budget, 0);
    if (totalBudget === 0) return 0;
    const burnRate = totalSpent / totalBudget;
    return Math.round(totalSpent / Math.max(burnRate, 0.01));
  }

  // ── Alert checking ────────────────────────────────────────
  function checkAlerts(showModal = true) {
    state.categories.forEach((cat, i) => {
      if (cat.budget <= 0) return;
      const pct = cat.spent / cat.budget;

      if (pct >= 0.9 && !state.alertShown[`${i}_90`]) {
        state.alertShown[`${i}_90`] = true;
        if (showModal) showOverrunAlert(cat, Math.round(pct * 100));
      }

      if (pct >= 0.7 && !state.alertShown[`${i}_70`]) {
        state.alertShown[`${i}_70`] = true;
        if (showModal && window.ReModelAI && window.ReModelAI.showToast) {
          window.ReModelAI.showToast(
            `⚠️ ${cat.name} is at ${Math.round(pct * 100)}% of budget ($${cat.spent.toLocaleString()} / $${cat.budget.toLocaleString()})`,
            'warning', 5000
          );
        }
      }
    });
  }

  function showOverrunAlert(cat, pct) {
    if (!alertModal) return;

    const titleEl   = alertModal.querySelector('#alertTitle');
    const messageEl = alertModal.querySelector('#alertMessage');

    if (titleEl) titleEl.textContent = `Budget Alert: ${cat.name}`;
    if (messageEl) messageEl.textContent =
      `The "${cat.name}" category is at ${pct}% of its budget ($${cat.spent.toLocaleString()} of $${cat.budget.toLocaleString()}). ` +
      `Consider reallocating funds or adjusting scope to avoid an overrun.`;

    alertModal.classList.add('open');
  }

  // ── Add / Remove categories ───────────────────────────────
  function addCategory(name, budget, spent = 0) {
    if (!name || budget <= 0) return false;

    // Check for duplicate
    if (state.categories.find(c => c.name.toLowerCase() === name.toLowerCase())) {
      if (window.ReModelAI) window.ReModelAI.showToast('A category with that name already exists.', 'warning');
      return false;
    }

    state.categories.push({ name, budget: parseFloat(budget), spent: parseFloat(spent) });
    render();
    checkAlerts(true);

    if (window.ReModelAI) window.ReModelAI.showToast(`Added "${name}" category.`, 'success');
    return true;
  }

  function removeCategory(index) {
    if (index < 0 || index >= state.categories.length) return;
    const name = state.categories[index].name;
    state.categories.splice(index, 1);
    // Reset alerts for this index
    delete state.alertShown[`${index}_70`];
    delete state.alertShown[`${index}_90`];
    render();
    if (window.ReModelAI) window.ReModelAI.showToast(`Removed "${name}" category.`, 'info');
  }

  function updateSpent(index, newSpent) {
    if (index < 0 || index >= state.categories.length) return;
    state.alertShown[`${index}_70`] = false;
    state.alertShown[`${index}_90`] = false;
    state.categories[index].spent = parseFloat(newSpent);
    render();
    checkAlerts(true);
  }

  function setTotalBudget(amount) {
    state.totalBudget = parseFloat(amount);
    render();
  }

  // ── Export summary ────────────────────────────────────────
  function exportSummary() {
    const totalSpent = state.categories.reduce((s, c) => s + c.spent, 0);
    const remaining  = state.totalBudget - totalSpent;
    const projected  = calcProjected();
    const date       = new Date().toLocaleDateString('en-US', { year:'numeric', month:'long', day:'numeric' });

    let report = `ReModelAI Budget Report\n`;
    report += `Generated: ${date}\n`;
    report += `${'='.repeat(50)}\n\n`;
    report += `Total Project Budget:  $${state.totalBudget.toLocaleString()}\n`;
    report += `Total Spent to Date:   $${totalSpent.toLocaleString()}\n`;
    report += `Remaining Budget:      $${Math.max(remaining, 0).toLocaleString()}\n`;
    report += `Projected Final Cost:  $${projected.toLocaleString()}\n`;
    report += `\n${'-'.repeat(50)}\n`;
    report += `CATEGORY BREAKDOWN\n`;
    report += `${'-'.repeat(50)}\n`;

    state.categories.forEach(cat => {
      const pct = cat.budget > 0 ? Math.round(cat.spent / cat.budget * 100) : 0;
      const status = pct < 70 ? 'ON TRACK' : pct < 90 ? 'WARNING' : 'OVERRUN';
      report += `\n${cat.name.padEnd(20)} | Budget: $${String(cat.budget.toLocaleString()).padStart(10)} | Spent: $${String(cat.spent.toLocaleString()).padStart(10)} | ${pct}% [${status}]\n`;
    });

    report += `\n${'='.repeat(50)}\n`;
    report += `Generated by ReModelAI — remodelai.io\n`;

    // Create and download file
    const blob = new Blob([report], { type: 'text/plain' });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href     = url;
    a.download = `budget-report-${date.replace(/,?\s+/g, '-')}.txt`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);

    if (window.ReModelAI) window.ReModelAI.showToast('Budget report exported successfully!', 'success');
  }

  // ── Utility ───────────────────────────────────────────────
  function escapeHtml(str) {
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  }

  function getState() { return state; }

  // ── Public API ────────────────────────────────────────────
  return {
    init,
    render,
    addCategory,
    removeCategory,
    updateSpent,
    setTotalBudget,
    exportSummary,
    checkAlerts,
    getState
  };

})();
