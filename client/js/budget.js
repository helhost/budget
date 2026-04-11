import { api } from './api.js';

// ── tiny helpers ────────────────────────────────────────────────────────────

function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'className') node.className = v;
    else if (k === 'style') Object.assign(node.style, v);
    else if (k.startsWith('data-')) node.dataset[k.slice(5).replace(/-([a-z])/g, (_, c) => c.toUpperCase())] = v;
    else node.setAttribute(k, v);
  }
  for (const child of children) {
    if (child == null) continue;
    node.append(typeof child === 'string' ? document.createTextNode(child) : child);
  }
  return node;
}

function setText(node, text) { node.textContent = text; return node; }

// ── module ───────────────────────────────────────────────────────────────────

export async function mount(el_) {
  const now = new Date();
  let month = now.getMonth() + 1;
  let year = now.getFullYear();
  const sym = window.getCurrencySymbol ? window.getCurrencySymbol() : '£';
  const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December'];

  // ── persistent DOM skeleton (built once) ──────────────────────────────────

  const periodLabel = el('span', { className: 'period-label' });
  const prevBtn = el('button', { className: 'btn-ghost' }, '←');
  const nextBtn = el('button', { className: 'btn-ghost' }, '→');
  const card = el('div', { className: 'card' });

  const header = el('div', { className: 'page-header' },
    el('h1', {}, 'Budget'),
    el('div', { className: 'controls' }, prevBtn, periodLabel, nextBtn),
    el('div', {}),
  );

  el_.append(header, card);

  prevBtn.addEventListener('click', () => {
    month--; if (month < 1) { month = 12; year--; }
    loadData();
  });
  nextBtn.addEventListener('click', () => {
    month++; if (month > 12) { month = 1; year++; }
    loadData();
  });

  // ── data loading ──────────────────────────────────────────────────────────

  async function loadData() {
    setText(periodLabel, `${MONTHS[month - 1]} ${year}`);
    card.replaceChildren(el('div', { className: 'loading' }, 'Loading…'));

    const [categories, budgets, txs] = await Promise.all([
      api.getCategories(),
      api.getBudgets(),
      api.getTransactions(month, year),
    ]);

    if (!categories.length) {
      card.replaceChildren(
        el('div', { className: 'empty' },
          'No categories yet. Add some in the Categories page first.')
      );
      return;
    }

    // Build lookup maps
    const limitMap = Object.fromEntries(budgets.map(b => [b.category, b.monthly_limit]));
    const spentMap = {};
    txs.filter(t => t.type === 'outgoing').forEach(t => {
      spentMap[t.category] = (spentMap[t.category] || 0) + Math.abs(t.amount);
    });

    const totalLimit = Object.values(limitMap).reduce((s, v) => s + v, 0);
    const totalSpent = Object.values(spentMap).reduce((s, v) => s + v, 0);

    // ── table ──────────────────────────────────────────────────────────────

    const tbody = el('tbody', {});

    for (const c of categories) {
      const limit = limitMap[c.name] || 0;
      const spent = spentMap[c.name] || 0;
      const remaining = limit - spent;
      const pct = limit > 0 ? Math.min(spent / limit * 100, 100) : 0;
      const over = limit > 0 && spent > limit;
      const noLimit = limit === 0;

      // Limit cell — editable span
      const limitSpan = el('span', {
        className: 'limit-val limit-cell',
        'data-cat': c.name,
        'data-limit': String(limit),
      });
      if (limit > 0) {
        limitSpan.textContent = sym + limit.toFixed(2);
      } else {
        limitSpan.append(el('span', { className: 'muted' }, '+ set limit'));
      }

      // Spent cell
      const spentTd = el('td', { className: 'num ' + (spent > 0 ? 'outgoing' : 'muted') },
        spent > 0 ? sym + spent.toFixed(2) : '—'
      );

      // Remaining cell
      const remainingTd = el('td', {
        className: 'num ' + (over ? 'outgoing' : remaining > 0 ? 'incoming' : 'muted'),
      });
      if (noLimit) {
        remainingTd.append(el('span', { className: 'muted' }, '—'));
      } else {
        remainingTd.textContent = (over ? '-' : '') + sym + Math.abs(remaining).toFixed(2);
      }

      // Progress cell
      const progressTd = el('td', {});
      if (noLimit) {
        progressTd.append(
          el('span', { className: 'muted', style: { fontSize: '11px' } }, 'no limit set')
        );
      } else {
        const fill = el('div', { className: 'progress-fill' + (over ? ' over' : '') });
        fill.style.width = pct + '%';
        progressTd.append(
          el('div', { className: 'progress-bar' }, fill),
          el('span', { className: 'progress-label' }, pct.toFixed(0) + '%'),
        );
      }

      tbody.append(el('tr', {},
        el('td', {}, el('span', { className: 'tag' }, c.name)),
        el('td', { className: 'num' }, limitSpan),
        spentTd,
        remainingTd,
        progressTd,
      ));
    }

    // ── tfoot ──────────────────────────────────────────────────────────────

    const totalRemainingClass = totalSpent > totalLimit && totalLimit > 0 ? 'outgoing' : 'incoming';

    const totalProgressTd = el('td', {});
    if (totalLimit > 0) {
      const totalPct = Math.min(totalSpent / totalLimit * 100, 100);
      const totalFill = el('div', { className: 'progress-fill' + (totalSpent > totalLimit ? ' over' : '') });
      totalFill.style.width = totalPct.toFixed(0) + '%';
      totalProgressTd.append(
        el('div', { className: 'progress-bar' }, totalFill),
        el('span', { className: 'progress-label' }, (totalSpent / totalLimit * 100).toFixed(0) + '%'),
      );
    }

    const tfoot = el('tfoot', {},
      el('tr', {},
        el('td', {}, el('strong', {}, 'Total')),
        el('td', { className: 'num' },
          el('strong', {}, totalLimit > 0 ? sym + totalLimit.toFixed(2) : '—')),
        el('td', { className: 'num outgoing' },
          el('strong', {}, totalSpent > 0 ? sym + totalSpent.toFixed(2) : '—')),
        el('td', { className: 'num ' + totalRemainingClass },
          el('strong', {}, totalLimit > 0
            ? (totalSpent > totalLimit ? '-' : '') + sym + Math.abs(totalLimit - totalSpent).toFixed(2)
            : '—')),
        totalProgressTd,
      )
    );

    // ── assemble ───────────────────────────────────────────────────────────

    const thead = el('thead', {},
      el('tr', {},
        el('th', {}, 'Category'),
        el('th', { className: 'num' }, 'Limit'),
        el('th', { className: 'num' }, 'Spent'),
        el('th', { className: 'num' }, 'Remaining'),
        el('th', { style: { width: '180px' } }, 'Progress'),
      )
    );

    const table = el('table', { className: 'budget-table' }, thead, tbody, tfoot);
    const hint = el('div', { className: 'budget-hint' });
    hint.append(
      'Click any value in the ',
      el('strong', {}, 'Limit'),
      ' column to set or edit it.'
    );

    card.replaceChildren(hint, table);

    // ── inline editing ─────────────────────────────────────────────────────

    card.querySelectorAll('.limit-val').forEach(span => {
      span.addEventListener('click', () => {
        const cat = span.dataset.cat;
        const current = parseFloat(span.dataset.limit) || 0;

        const input = el('input', {
          type: 'number', min: '0', step: '0.01', placeholder: '0.00',
        });
        input.value = current || '';
        Object.assign(input.style, {
          width: '90px', textAlign: 'right',
          fontFamily: 'var(--mono)', fontSize: '12px', padding: '3px 6px',
        });
        span.replaceWith(input);
        input.focus();
        input.select();

        async function save() {
          const val = parseFloat(input.value) || 0;
          await api.saveBudgets([{ category: cat, monthly_limit: val }]);
          loadData();
        }

        input.addEventListener('blur', save);
        input.addEventListener('keydown', e => {
          if (e.key === 'Enter') { e.preventDefault(); input.blur(); }
          if (e.key === 'Escape') loadData();
        });
      });
    });
  }

  // ── initial render ────────────────────────────────────────────────────────
  setText(periodLabel, `${MONTHS[month - 1]} ${year}`);
  loadData();
}
