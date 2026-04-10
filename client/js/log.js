import { api } from './api.js';
import { createDatePicker } from './datepicker.js';

export async function mount(el) {
  const sym = window.getCurrencySymbol ? window.getCurrencySymbol() : "£";
  const now = new Date();
  let month = now.getMonth() + 1;
  let year = now.getFullYear();

  const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December'];

  function todayStr() {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }

  function defaultDateForPeriod() {
    const d = new Date();
    return (month === d.getMonth() + 1 && year === d.getFullYear()) ? todayStr() : '';
  }

  el.innerHTML = `
    <div class="page-header">
      <h1>Log</h1>
      <div class="controls">
        <button class="btn-ghost" id="prev">&#8592;</button>
        <span id="period-label" class="period-label"></span>
        <button class="btn-ghost" id="next">&#8594;</button>
      </div>
      <div></div>
    </div>

    <div class="card add-form">
      <div class="form-top">
        <h2>Add transaction</h2>
        <div class="type-switch">
          <button class="switch-btn active" data-type="outgoing">Outgoing</button>
          <button class="switch-btn"        data-type="incoming">Incoming</button>
          <button class="switch-btn"        data-type="saving">Saving</button>
        </div>
      </div>
      <div class="form-row">
        <input  type="text"   id="f-date"    placeholder="Pick a date" readonly />
        <select id="f-cat"></select>
        <input  type="text"   id="f-item"    placeholder="Item" />
        <input  type="number" id="f-amount"  placeholder="Amount (${sym})" step="0.01" min="0" />
        <input  type="text"   id="f-comment" placeholder="Comment (optional)" />
        <button id="f-submit" class="btn-primary">Add</button>
      </div>
      <p id="f-error" class="form-error"></p>
    </div>

    <div class="card">
      <div id="tx-list"><div class="loading">Loading...</div></div>
    </div>
  `;

  const label = el.querySelector('#period-label');
  const txList = el.querySelector('#tx-list');
  const fError = el.querySelector('#f-error');
  const catSel = el.querySelector('#f-cat');
  const dateInput = el.querySelector('#f-date');
  let txType = 'outgoing';

  el.querySelectorAll('.switch-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      txType = btn.dataset.type;
      el.querySelectorAll('.switch-btn').forEach(b => b.classList.toggle('active', b === btn));
    });
  });

  function updateLabel() { label.textContent = `${MONTHS[month - 1]} ${year}`; }

  async function loadCategories() {
    const cats = await api.getCategories();
    catSel.innerHTML = cats.map(c => `<option value="${c.name}">${c.name}</option>`).join('');
  }

  async function loadTransactions() {
    txList.innerHTML = '<div class="loading">Loading...</div>';
    try {
      const txs = await api.getTransactions(month, year);
      if (!txs.length) {
        txList.innerHTML = '<div class="empty">No transactions this month.</div>';
        return;
      }

      const income = txs.filter(t => t.type === 'incoming').reduce((s, t) => s + Math.abs(t.amount), 0);
      const expenses = txs.filter(t => t.type === 'outgoing').reduce((s, t) => s + Math.abs(t.amount), 0);
      const savings = txs.filter(t => t.type === 'saving').reduce((s, t) => s + Math.abs(t.amount), 0);
      const net = income - expenses;

      txList.innerHTML = `
        <div class="tx-summary">
          <div class="summary-item">
            <span class="summary-label">Income</span>
            <span class="summary-val incoming">+${sym}${income.toFixed(2)}</span>
          </div>
          <div class="summary-item">
            <span class="summary-label">Expenses</span>
            <span class="summary-val outgoing">-${sym}${expenses.toFixed(2)}</span>
          </div>
          <div class="summary-item">
            <span class="summary-label">Saving</span>
            <span class="summary-val saving">${sym}${savings.toFixed(2)}</span>
          </div>
          <div class="summary-item summary-net">
            <span class="summary-label">Net</span>
            <span class="summary-val ${net >= 0 ? 'incoming' : 'outgoing'}">
              ${net >= 0 ? '+' : '-'}${sym}${Math.abs(net).toFixed(2)}
            </span>
          </div>
        </div>
        <table>
          <thead>
            <tr><th>Date</th><th>Category</th><th>Item</th><th class="num">Amount</th><th>Comment</th><th></th></tr>
          </thead>
          <tbody>
            ${txs.map(t => `
              <tr>
                <td class="mono">${t.date}</td>
                <td><span class="tag">${t.category}</span></td>
                <td>${t.item}</td>
                <td class="num ${t.type}">
                  ${t.type === 'incoming' ? '+' : t.type === 'outgoing' ? '-' : ''}${sym}${Math.abs(t.amount).toFixed(2)}
                </td>
                <td class="muted">${t.comment || '—'}</td>
                <td><button class="btn-delete" data-id="${t.id}">✕</button></td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      `;

      txList.querySelectorAll('.btn-delete').forEach(btn => {
        btn.addEventListener('click', async () => {
          await api.deleteTransaction(btn.dataset.id);
          loadTransactions();
        });
      });
    } catch (e) {
      txList.innerHTML = `<div class="error">${e.message}</div>`;
    }
  }

  let picker = createDatePicker(dateInput, () => ({ month, year }), defaultDateForPeriod());
  dateInput.value = defaultDateForPeriod();

  function navigate(delta) {
    month += delta;
    if (month < 1) { month = 12; year--; }
    if (month > 12) { month = 1; year++; }
    // Reset date to today if back on current month, else clear
    const def = defaultDateForPeriod();
    dateInput.value = def;
    picker.setDate(def);
    updateLabel();
    loadTransactions();
  }

  el.querySelector('#prev').addEventListener('click', () => navigate(-1));
  el.querySelector('#next').addEventListener('click', () => navigate(+1));

  el.querySelector('#f-submit').addEventListener('click', async () => {
    fError.textContent = '';
    const date = dateInput.value.trim();
    const category = catSel.value;
    const item = el.querySelector('#f-item').value.trim();
    const raw = parseFloat(el.querySelector('#f-amount').value);
    const comment = el.querySelector('#f-comment').value.trim() || null;

    if (!date || !item || isNaN(raw) || raw <= 0) {
      fError.textContent = 'Date, item and a positive amount are required.';
      return;
    }

    const amount = txType === 'incoming' ? -raw : raw;

    try {
      await api.addTransaction({ date, category, item, amount, type: txType, comment });
      el.querySelector('#f-item').value = '';
      el.querySelector('#f-amount').value = '';
      el.querySelector('#f-comment').value = '';
      loadTransactions();
    } catch (e) {
      fError.textContent = e.message;
    }
  });

  updateLabel();
  await loadCategories();
  await loadTransactions();
}
