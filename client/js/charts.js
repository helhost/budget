import { api } from './api.js';

const CHART_JS = 'https://cdn.jsdelivr.net/npm/chart.js@4.4.0/dist/chart.umd.min.js';
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const COLORS = [
  '#4f8ef7', '#4caf7d', '#e6be50', '#e05c5c', '#a78bfa', '#fb923c',
  '#38bdf8', '#f472b6', '#34d399', '#facc15', '#c084fc', '#60a5fa'
];

// ── tiny helpers ──────────────────────────────────────────────────────────────

function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'className') node.className = v;
    else if (k === 'style') Object.assign(node.style, v);
    else if (k.startsWith('data-')) node.dataset[k.slice(5)] = v;
    else node.setAttribute(k, v);
  }
  for (const child of children) {
    if (child == null) continue;
    node.append(typeof child === 'string' ? document.createTextNode(child) : child);
  }
  return node;
}

// ── helpers ───────────────────────────────────────────────────────────────────

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

// ── module ────────────────────────────────────────────────────────────────────

export async function mount(el_) {
  const sym = window.getCurrencySymbol ? window.getCurrencySymbol() : '£';
  const now = new Date();

  let viewMonth = now.getMonth() + 1;
  let viewYear = now.getFullYear();
  let investYear = now.getFullYear();

  // ── persistent DOM skeleton (built once) ───────────────────────────────────

  const spendLabel = el('span', { className: 'widget-sub' });
  const spendPrev = el('button', { className: 'btn-ghost chart-nav-btn' }, '←');
  const spendNext = el('button', { className: 'btn-ghost chart-nav-btn' }, '→');
  const spendCanvas = el('canvas');

  const investLabel = el('span', { className: 'widget-sub' });
  const investPrev = el('button', { className: 'btn-ghost chart-nav-btn' }, '←');
  const investNext = el('button', { className: 'btn-ghost chart-nav-btn' }, '→');
  const investCanvas = el('canvas');

  const pieCanvas = el('canvas');
  const pieLegend = el('div', { className: 'pie-legend' });
  const pieWrap = el('div', { className: 'chart-wrap pie-wrap' }, pieCanvas);

  const pillMonth = el('button', { className: 'pill active', 'data-range': 'month' }, 'This month');
  const pillYear = el('button', { className: 'pill', 'data-range': 'year' }, 'This year');
  const pillAll = el('button', { className: 'pill', 'data-range': 'all' }, 'All time');

  el_.append(
    el('div', { className: 'page-header' }, el('h1', {}, 'Charts')),
    el('div', { className: 'charts-grid' },

      el('div', { className: 'widget' },
        el('div', { className: 'widget-header' },
          el('span', { className: 'widget-title' }, 'Cumulative Spending'),
          el('div', { className: 'chart-nav' }, spendPrev, spendLabel, spendNext),
        ),
        el('div', { className: 'chart-wrap' }, spendCanvas),
      ),

      el('div', { className: 'widget' },
        el('div', { className: 'widget-header' },
          el('span', { className: 'widget-title' }, 'Cumulative Savings'),
          el('div', { className: 'chart-nav' }, investPrev, investLabel, investNext),
        ),
        el('div', { className: 'chart-wrap' }, investCanvas),
      ),

      el('div', { className: 'widget wide' },
        el('div', { className: 'widget-header' },
          el('span', { className: 'widget-title' }, 'Spending by Category'),
          el('div', { className: 'pill-tabs' }, pillMonth, pillYear, pillAll),
        ),
        el('div', { className: 'pie-layout' }, pieWrap, pieLegend),
      ),
    ),
  );

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

  // ── 1. Cumulative Spending ────────────────────────────────────────────────

  let spendChart = null;

  async function renderSpending() {
    const prev = prevMonthOf(viewMonth, viewYear);
    spendLabel.textContent = `${MONTHS[viewMonth - 1]} ${viewYear} vs ${MONTHS[prev.month - 1]} ${prev.year}`;

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
    spendChart = new window.Chart(spendCanvas, {
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

  spendPrev.addEventListener('click', () => {
    const p = prevMonthOf(viewMonth, viewYear);
    viewMonth = p.month; viewYear = p.year;
    renderSpending();
  });
  spendNext.addEventListener('click', () => {
    viewMonth++; if (viewMonth > 12) { viewMonth = 1; viewYear++; }
    renderSpending();
  });

  // ── 2. Cumulative Savings ─────────────────────────────────────────────────

  let investChart = null;

  function renderInvestments() {
    investLabel.textContent = String(investYear);

    const yearTxs = allTxs.filter(t => t.date.startsWith(String(investYear)) && t.type === 'saving');
    const monthly = new Array(12).fill(0);
    yearTxs.forEach(t => { monthly[parseInt(t.date.split('-')[1], 10) - 1] += Math.abs(t.amount); });
    let cum = 0;
    const cumData = monthly.map(v => (cum += v, cum));

    if (investChart) investChart.destroy();
    investChart = new window.Chart(investCanvas, {
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

  investPrev.addEventListener('click', () => { investYear--; renderInvestments(); });
  investNext.addEventListener('click', () => { investYear++; renderInvestments(); });

  // ── 3. Pie chart ──────────────────────────────────────────────────────────

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
      const empty = el('div', { className: 'empty' }, 'No data');
      empty.style.cssText = 'height:200px;display:flex;align-items:center;justify-content:center';
      pieWrap.replaceChildren(empty);
      pieLegend.replaceChildren();
      return;
    }

    // Restore canvas if it was replaced by the empty state
    if (!pieWrap.contains(pieCanvas)) pieWrap.replaceChildren(pieCanvas);

    pieChart = new window.Chart(pieCanvas, {
      type: 'doughnut',
      data: {
        labels,
        datasets: [{ data, backgroundColor: COLORS.slice(0, labels.length), borderWidth: 0, hoverOffset: 6 }],
      },
      options: {
        cutout: '65%',
        plugins: {
          legend: { display: false },
          tooltip: {
            ...chartDefaults.plugins.tooltip,
            callbacks: { label: ctx => ` ${sym}${ctx.parsed.toFixed(2)} (${(ctx.parsed / total * 100).toFixed(1)}%)` },
          },
        },
      },
    });

    pieLegend.replaceChildren(
      ...labels.map((l, i) => {
        const dot = el('span', { className: 'legend-dot' });
        dot.style.background = COLORS[i];
        return el('div', { className: 'legend-row' },
          dot,
          el('span', { className: 'legend-label' }, l),
          el('span', { className: 'legend-val' }, sym + data[i].toFixed(2)),
        );
      })
    );
  }

  buildPie('month');

  [pillMonth, pillYear, pillAll].forEach(btn => {
    btn.addEventListener('click', () => {
      [pillMonth, pillYear, pillAll].forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      buildPie(btn.dataset.range);
    });
  });

  renderSpending();
  renderInvestments();
}
