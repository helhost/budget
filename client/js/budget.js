import { api } from './api.js';

export async function mount(el) {
  const now = new Date();
  let month = now.getMonth() + 1;
  let year = now.getFullYear();
  const sym = window.getCurrencySymbol ? window.getCurrencySymbol() : '£';
  const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December'];

  function render() {
    el.innerHTML = `
      <div class="page-header">
        <h1>Budget</h1>
        <div class="controls">
          <button class="btn-ghost" id="prev">&#8592;</button>
          <span class="period-label" id="period-label"></span>
          <button class="btn-ghost" id="next">&#8594;</button>
        </div>
        <div></div>
      </div>
      <div class="card" id="budget-card">
        <div class="loading">Loading…</div>
      </div>
    `;

    el.querySelector('#period-label').textContent = `${MONTHS[month - 1]} ${year}`;

    el.querySelector('#prev').addEventListener('click', () => {
      month--; if (month < 1) { month = 12; year--; }
      loadData();
    });
    el.querySelector('#next').addEventListener('click', () => {
      month++; if (month > 12) { month = 1; year++; }
      loadData();
    });

    loadData();
  }

  async function loadData() {
    el.querySelector('#period-label').textContent = `${MONTHS[month - 1]} ${year}`;
    const card = el.querySelector('#budget-card');
    card.innerHTML = '<div class="loading">Loading…</div>';

    const [categories, budgets, txs] = await Promise.all([
      api.getCategories(),
      api.getBudgets(),
      api.getTransactions(month, year),
    ]);

    if (!categories.length) {
      card.innerHTML = '<div class="empty">No categories yet. Add some in the Categories page first.</div>';
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

    card.innerHTML = `
      <div class="budget-hint">Click any value in the <strong>Limit</strong> column to set or edit it.</div>
      <table class="budget-table">
        <thead>
          <tr>
            <th>Category</th>
            <th class="num">Limit</th>
            <th class="num">Spent</th>
            <th class="num">Remaining</th>
            <th style="width:180px">Progress</th>
          </tr>
        </thead>
        <tbody>
          ${categories.map(c => {
      const limit = limitMap[c.name] || 0;
      const spent = spentMap[c.name] || 0;
      const remaining = limit - spent;
      const pct = limit > 0 ? Math.min(spent / limit * 100, 100) : 0;
      const over = limit > 0 && spent > limit;
      const noLimit = limit === 0;
      return `
              <tr>
                <td><span class="tag">${c.name}</span></td>
                <td class="num">
                  <span class="limit-val limit-cell" data-cat="${c.name}" data-limit="${limit}">
                    ${limit > 0 ? sym + limit.toFixed(2) : '<span class="muted">+ set limit</span>'}
                  </span>
                </td>
                <td class="num ${spent > 0 ? 'outgoing' : 'muted'}">${spent > 0 ? sym + spent.toFixed(2) : '—'}</td>
                <td class="num ${over ? 'outgoing' : remaining > 0 ? 'incoming' : 'muted'}">
                  ${noLimit ? '<span class="muted">—</span>' : (over ? '-' : '') + sym + Math.abs(remaining).toFixed(2)}
                </td>
                <td>
                  ${noLimit
          ? '<span class="muted" style="font-size:11px">no limit set</span>'
          : `<div class="progress-bar">
                        <div class="progress-fill ${over ? 'over' : ''}" style="width:${pct}%"></div>
                       </div>
                       <span class="progress-label">${pct.toFixed(0)}%</span>`
        }
                </td>
              </tr>
            `;
    }).join('')}
        </tbody>
        <tfoot>
          <tr>
            <td><strong>Total</strong></td>
            <td class="num"><strong>${totalLimit > 0 ? sym + totalLimit.toFixed(2) : '—'}</strong></td>
            <td class="num outgoing"><strong>${totalSpent > 0 ? sym + totalSpent.toFixed(2) : '—'}</strong></td>
            <td class="num ${totalSpent > totalLimit && totalLimit > 0 ? 'outgoing' : 'incoming'}">
              <strong>${totalLimit > 0 ? (totalSpent > totalLimit ? '-' : '') + sym + Math.abs(totalLimit - totalSpent).toFixed(2) : '—'}</strong>
            </td>
            <td>
              ${totalLimit > 0 ? `
                <div class="progress-bar">
                  <div class="progress-fill ${totalSpent > totalLimit ? 'over' : ''}"
                       style="width:${Math.min(totalSpent / totalLimit * 100, 100).toFixed(0)}%"></div>
                </div>
                <span class="progress-label">${(totalSpent / totalLimit * 100).toFixed(0)}%</span>
              ` : ''}
            </td>
          </tr>
        </tfoot>
      </table>
    `;

    // Inline editing — click a limit value to edit it
    card.querySelectorAll('.limit-val').forEach(span => {
      span.addEventListener('click', () => {
        const cat = span.dataset.cat;
        const current = parseFloat(span.dataset.limit) || 0;
        const input = document.createElement('input');
        input.type = 'number';
        input.value = current || '';
        input.min = '0';
        input.step = '0.01';
        input.placeholder = '0.00';
        input.style.cssText = 'width:90px;text-align:right;font-family:var(--mono);font-size:12px;padding:3px 6px';
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

  render();
}
