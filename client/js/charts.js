import { api } from './api.js';

const CHART_JS = 'https://cdn.jsdelivr.net/npm/chart.js@4.4.0/dist/chart.umd.min.js';
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const COLORS = [
  '#4f8ef7', '#4caf7d', '#e6be50', '#e05c5c', '#a78bfa', '#fb923c',
  '#38bdf8', '#f472b6', '#34d399', '#facc15', '#c084fc', '#60a5fa'
];

function loadScript(src) {
  return new Promise((res, rej) => {
    if (window.Chart) return res();
    const s = document.createElement('script');
    s.src = src; s.onload = res; s.onerror = rej;
    document.head.appendChild(s);
  });
}

function daysInMonth(year, month) { return new Date(year, month, 0).getDate(); }

function prevMonthOf(month, year) {
  return month === 1 ? { month: 12, year: year - 1 } : { month: month - 1, year };
}

export async function mount(el) {
  const sym = window.getCurrencySymbol ? window.getCurrencySymbol() : '£';
  const now = new Date();

  let viewMonth = now.getMonth() + 1;
  let viewYear = now.getFullYear();
  let investYear = now.getFullYear();

  el.innerHTML = `
    <div class="page-header"><h1>Charts</h1></div>
    <div class="charts-grid">

      <div class="widget">
        <div class="widget-header">
          <span class="widget-title">Cumulative Spending</span>
          <div class="chart-nav">
            <button class="btn-ghost chart-nav-btn" id="spend-prev">&#8592;</button>
            <span class="widget-sub" id="spend-label"></span>
            <button class="btn-ghost chart-nav-btn" id="spend-next">&#8594;</button>
          </div>
        </div>
        <div class="chart-wrap"><canvas id="chart-spending"></canvas></div>
      </div>

      <div class="widget">
        <div class="widget-header">
          <span class="widget-title">Cumulative Savings</span>
          <div class="chart-nav">
            <button class="btn-ghost chart-nav-btn" id="invest-prev">&#8592;</button>
            <span class="widget-sub" id="invest-label"></span>
            <button class="btn-ghost chart-nav-btn" id="invest-next">&#8594;</button>
          </div>
        </div>
        <div class="chart-wrap"><canvas id="chart-invest"></canvas></div>
      </div>

      <div class="widget wide">
        <div class="widget-header">
          <span class="widget-title">Spending by Category</span>
          <div class="pill-tabs" id="pie-tabs">
            <button class="pill active" data-range="month">This month</button>
            <button class="pill"        data-range="year">This year</button>
            <button class="pill"        data-range="all">All time</button>
          </div>
        </div>
        <div class="pie-layout">
          <div class="chart-wrap pie-wrap"><canvas id="chart-pie"></canvas></div>
          <div id="pie-legend" class="pie-legend"></div>
        </div>
      </div>

    </div>
  `;

  await loadScript(CHART_JS);

  const chartDefaults = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: { display: false },
      tooltip: {
        backgroundColor: '#1e2435', borderColor: '#252a38', borderWidth: 1,
        titleColor: '#e8eaf0', bodyColor: '#9aa0b0', padding: 10, cornerRadius: 6,
      }
    },
    scales: {
      x: { grid: { color: '#1e2435' }, ticks: { color: '#5a6070', font: { family: 'DM Mono', size: 11 } } },
      y: {
        grid: { color: '#1e2435' }, ticks: {
          color: '#5a6070', font: { family: 'DM Mono', size: 11 },
          callback: v => `${sym}${v.toFixed(0)}`
        }
      },
    },
  };

  const allTxs = await api.getAllTransactions();

  // ── 1. Cumulative Spending ──────────────────────────────────────────────
  let spendChart = null;

  async function renderSpending() {
    const prev = prevMonthOf(viewMonth, viewYear);
    document.getElementById('spend-label').textContent =
      `${MONTHS[viewMonth - 1]} ${viewYear} vs ${MONTHS[prev.month - 1]} ${prev.year}`;

    const [curTxs, prevTxs] = await Promise.all([
      api.getTransactions(viewMonth, viewYear),
      api.getTransactions(prev.month, prev.year),
    ]);

    const days = daysInMonth(viewYear, viewMonth);
    const labels = Array.from({ length: days }, (_, i) => i + 1);

    function cumByDay(txs, y, m) {
      const totals = new Array(daysInMonth(y, m)).fill(0);
      txs.filter(t => t.type === 'outgoing').forEach(t => {
        const d = parseInt(t.date.split('-')[2], 10) - 1;
        totals[d] += Math.abs(t.amount);
      });
      let cum = 0;
      return totals.map(v => (cum += v, cum));
    }

    const curData = cumByDay(curTxs, viewYear, viewMonth);
    const prevData = cumByDay(prevTxs, prev.year, prev.month);
    const today = (viewMonth === now.getMonth() + 1 && viewYear === now.getFullYear())
      ? now.getDate() : days;

    if (spendChart) spendChart.destroy();
    spendChart = new window.Chart(document.getElementById('chart-spending'), {
      type: 'line',
      data: {
        labels,
        datasets: [
          {
            label: `${MONTHS[viewMonth - 1]} ${viewYear}`,
            data: [...curData.slice(0, today), ...new Array(days - today).fill(null)],
            borderColor: '#4f8ef7', backgroundColor: 'rgba(79,142,247,0.08)',
            fill: true, tension: 0.3, pointRadius: 0, pointHoverRadius: 4, borderWidth: 2,
          },
          {
            label: `${MONTHS[prev.month - 1]} ${prev.year}`,
            data: prevData,
            borderColor: '#5a6070', backgroundColor: 'transparent',
            tension: 0.3, pointRadius: 0, pointHoverRadius: 4, borderWidth: 1.5, borderDash: [4, 4],
          },
        ],
      },
      options: {
        ...chartDefaults,
        plugins: {
          ...chartDefaults.plugins,
          legend: { display: true, labels: { color: '#9aa0b0', font: { family: 'DM Sans', size: 12 }, boxWidth: 20 } },
          tooltip: { ...chartDefaults.plugins.tooltip, callbacks: { label: ctx => ` ${sym}${ctx.parsed.y.toFixed(2)}` } },
        },
        interaction: { mode: 'index', intersect: false },
      },
    });
  }

  el.querySelector('#spend-prev').addEventListener('click', () => {
    const p = prevMonthOf(viewMonth, viewYear);
    viewMonth = p.month; viewYear = p.year;
    renderSpending();
  });
  el.querySelector('#spend-next').addEventListener('click', () => {
    viewMonth++; if (viewMonth > 12) { viewMonth = 1; viewYear++; }
    renderSpending();
  });

  // ── 2. Cumulative Savings ───────────────────────────────────────────────
  let investChart = null;

  function renderInvestments() {
    document.getElementById('invest-label').textContent = String(investYear);

    const yearTxs = allTxs.filter(t => t.date.startsWith(String(investYear)) && t.type === 'saving');
    const monthly = new Array(12).fill(0);
    yearTxs.forEach(t => { monthly[parseInt(t.date.split('-')[1], 10) - 1] += Math.abs(t.amount); });
    let cum = 0;
    const cumData = monthly.map(v => (cum += v, cum));

    if (investChart) investChart.destroy();
    investChart = new window.Chart(document.getElementById('chart-invest'), {
      type: 'line',
      data: {
        labels: MONTHS,
        datasets: [{
          label: `${investYear}`,
          data: cumData,
          borderColor: '#4caf7d', backgroundColor: 'rgba(76,175,125,0.08)',
          fill: true, tension: 0.3, pointRadius: 3, pointBackgroundColor: '#4caf7d', borderWidth: 2,
        }],
      },
      options: {
        ...chartDefaults,
        plugins: {
          ...chartDefaults.plugins,
          tooltip: { ...chartDefaults.plugins.tooltip, callbacks: { label: ctx => ` ${sym}${ctx.parsed.y.toFixed(2)}` } },
        },
      },
    });
  }

  el.querySelector('#invest-prev').addEventListener('click', () => { investYear--; renderInvestments(); });
  el.querySelector('#invest-next').addEventListener('click', () => { investYear++; renderInvestments(); });

  // ── 3. Pie chart ────────────────────────────────────────────────────────
  let pieChart = null;

  function buildPie(range) {
    let txs = allTxs.filter(t => t.type === 'outgoing');
    if (range === 'month') txs = txs.filter(t => {
      const [y, m] = t.date.split('-');
      return parseInt(m) === now.getMonth() + 1 && parseInt(y) === now.getFullYear();
    });
    if (range === 'year') txs = txs.filter(t => t.date.startsWith(String(now.getFullYear())));

    const byCategory = {};
    txs.forEach(t => { byCategory[t.category] = (byCategory[t.category] || 0) + Math.abs(t.amount); });
    const labels = Object.keys(byCategory);
    const data = Object.values(byCategory);
    const total = data.reduce((s, v) => s + v, 0);

    if (pieChart) pieChart.destroy();
    if (!labels.length) {
      document.getElementById('chart-pie').parentElement.innerHTML =
        '<div class="empty" style="height:200px;display:flex;align-items:center;justify-content:center">No data</div>';
      document.getElementById('pie-legend').innerHTML = '';
      return;
    }

    pieChart = new window.Chart(document.getElementById('chart-pie'), {
      type: 'doughnut',
      data: { labels, datasets: [{ data, backgroundColor: COLORS.slice(0, labels.length), borderWidth: 0, hoverOffset: 6 }] },
      options: {
        cutout: '65%',
        plugins: {
          legend: { display: false },
          tooltip: {
            ...chartDefaults.plugins.tooltip,
            callbacks: { label: ctx => ` ${sym}${ctx.parsed.toFixed(2)} (${(ctx.parsed / total * 100).toFixed(1)}%)` }
          },
        },
      },
    });

    document.getElementById('pie-legend').innerHTML = labels.map((l, i) => `
      <div class="legend-row">
        <span class="legend-dot" style="background:${COLORS[i]}"></span>
        <span class="legend-label">${l}</span>
        <span class="legend-val">${sym}${data[i].toFixed(2)}</span>
      </div>
    `).join('');
  }

  buildPie('month');
  el.querySelectorAll('.pill').forEach(btn => {
    btn.addEventListener('click', () => {
      el.querySelectorAll('.pill').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      buildPie(btn.dataset.range);
    });
  });

  renderSpending();
  renderInvestments();
}
