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

function daysInMonth(year, month) {
  return new Date(year, month, 0).getDate();
}

export async function mount(el) {
  const now = new Date();
  const month = now.getMonth() + 1;
  const year = now.getFullYear();
  const prevMonth = month === 1 ? 12 : month - 1;
  const prevYear = month === 1 ? year - 1 : year;

  el.innerHTML = `
    <div class="page-header">
      <h1>Charts</h1>
    </div>
    <div class="charts-grid">

      <div class="widget">
        <div class="widget-header">
          <span class="widget-title">Cumulative Spending</span>
          <span class="widget-sub">${MONTHS[month - 1]} vs ${MONTHS[prevMonth - 1]}</span>
        </div>
        <div class="chart-wrap"><canvas id="chart-spending"></canvas></div>
      </div>

      <div class="widget">
        <div class="widget-header">
          <span class="widget-title">Cumulative Investments</span>
          <span class="widget-sub">${year}</span>
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
      legend: { display: false }, tooltip: {
        backgroundColor: '#1e2435',
        borderColor: '#252a38',
        borderWidth: 1,
        titleColor: '#e8eaf0',
        bodyColor: '#9aa0b0',
        padding: 10,
        cornerRadius: 6,
      }
    },
    scales: {
      x: { grid: { color: '#1e2435' }, ticks: { color: '#5a6070', font: { family: 'DM Mono', size: 11 } } },
      y: {
        grid: { color: '#1e2435' }, ticks: {
          color: '#5a6070', font: { family: 'DM Mono', size: 11 },
          callback: v => `£${v.toFixed(0)}`
        }
      },
    },
  };

  // ── Fetch data ─────────────────────────────────────────────────────────
  const [curTxs, prevTxs, allTxs] = await Promise.all([
    api.getTransactions(month, year),
    api.getTransactions(prevMonth, prevYear),
    api.getAllTransactions(),
  ]);

  // ── 1. Cumulative Spending line chart ──────────────────────────────────
  {
    const days = daysInMonth(year, month);
    const labels = Array.from({ length: days }, (_, i) => i + 1);

    function cumulativeByDay(txs, y, m) {
      const totals = new Array(daysInMonth(y, m)).fill(0);
      txs.filter(t => t.type === 'outgoing').forEach(t => {
        const day = parseInt(t.date.split('-')[2], 10) - 1;
        totals[day] += Math.abs(t.amount);
      });
      let cum = 0;
      return totals.map(v => (cum += v, cum));
    }

    const curData = cumulativeByDay(curTxs, year, month);
    const prevData = cumulativeByDay(prevTxs, prevYear, prevMonth);

    // Only show up to today for current month
    const today = now.getDate();
    const curSlice = curData.slice(0, today);

    new window.Chart(document.getElementById('chart-spending'), {
      type: 'line',
      data: {
        labels,
        datasets: [
          {
            label: MONTHS[month - 1],
            data: [...curSlice, ...new Array(days - today).fill(null)],
            borderColor: '#4f8ef7',
            backgroundColor: 'rgba(79,142,247,0.08)',
            fill: true,
            tension: 0.3,
            pointRadius: 0,
            pointHoverRadius: 4,
            borderWidth: 2,
          },
          {
            label: MONTHS[prevMonth - 1],
            data: prevData,
            borderColor: '#5a6070',
            backgroundColor: 'transparent',
            tension: 0.3,
            pointRadius: 0,
            pointHoverRadius: 4,
            borderWidth: 1.5,
            borderDash: [4, 4],
          },
        ],
      },
      options: {
        ...chartDefaults,
        plugins: {
          ...chartDefaults.plugins,
          legend: {
            display: true,
            labels: { color: '#9aa0b0', font: { family: 'DM Sans', size: 12 }, boxWidth: 20 }
          },
          tooltip: {
            ...chartDefaults.plugins.tooltip,
            callbacks: { label: ctx => ` £${ctx.parsed.y.toFixed(2)}` }
          },
        },
        interaction: { mode: 'index', intersect: false },
      },
    });
  }

  // ── 2. Cumulative Investments line chart ───────────────────────────────
  {
    const yearTxs = allTxs.filter(t => t.date.startsWith(String(year)) && t.type === 'saving');
    const monthly = new Array(12).fill(0);
    yearTxs.forEach(t => {
      const m = parseInt(t.date.split('-')[1], 10) - 1;
      monthly[m] += Math.abs(t.amount);
    });
    let cum = 0;
    const cumData = monthly.map(v => (cum += v, cum));

    new window.Chart(document.getElementById('chart-invest'), {
      type: 'line',
      data: {
        labels: MONTHS,
        datasets: [{
          label: 'Cumulative Savings',
          data: cumData,
          borderColor: '#4caf7d',
          backgroundColor: 'rgba(76,175,125,0.08)',
          fill: true,
          tension: 0.3,
          pointRadius: 3,
          pointBackgroundColor: '#4caf7d',
          borderWidth: 2,
        }],
      },
      options: {
        ...chartDefaults,
        plugins: {
          ...chartDefaults.plugins,
          tooltip: {
            ...chartDefaults.plugins.tooltip,
            callbacks: { label: ctx => ` £${ctx.parsed.y.toFixed(2)}` }
          },
        },
      },
    });
  }

  // ── 3. Pie chart ────────────────────────────────────────────────────────
  let pieChart = null;

  function buildPie(range) {
    let txs = allTxs.filter(t => t.type === 'outgoing');
    if (range === 'month') txs = txs.filter(t => {
      const [y, m] = t.date.split('-');
      return parseInt(m) === month && parseInt(y) === year;
    });
    if (range === 'year') txs = txs.filter(t => t.date.startsWith(String(year)));

    const byCategory = {};
    txs.forEach(t => {
      byCategory[t.category] = (byCategory[t.category] || 0) + Math.abs(t.amount);
    });

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
      data: {
        labels,
        datasets: [{
          data,
          backgroundColor: COLORS.slice(0, labels.length),
          borderWidth: 0,
          hoverOffset: 6,
        }],
      },
      options: {
        cutout: '65%',
        plugins: {
          legend: { display: false },
          tooltip: {
            ...chartDefaults.plugins.tooltip,
            callbacks: {
              label: ctx => ` £${ctx.parsed.toFixed(2)} (${(ctx.parsed / total * 100).toFixed(1)}%)`
            }
          },
        },
      },
    });

    // Custom legend
    document.getElementById('pie-legend').innerHTML = labels.map((l, i) => `
      <div class="legend-row">
        <span class="legend-dot" style="background:${COLORS[i]}"></span>
        <span class="legend-label">${l}</span>
        <span class="legend-val">£${data[i].toFixed(2)}</span>
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
}
