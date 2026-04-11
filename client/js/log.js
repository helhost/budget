import { api } from './api.js';
import { createDatePicker } from './datepicker.js';

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

// ── module ────────────────────────────────────────────────────────────────────

export async function mount(el_) {
  const sym = window.getCurrencySymbol ? window.getCurrencySymbol() : '£';
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

  // ── persistent DOM skeleton (built once) ───────────────────────────────────

  const label = el('span', { className: 'period-label' });
  const prevBtn = el('button', { className: 'btn-ghost' }, '←');
  const nextBtn = el('button', { className: 'btn-ghost' }, '→');

  const dateInput = el('input', { type: 'text', placeholder: 'Pick a date', readonly: '' });
  const catSel = el('select');
  const fItem = el('input', { type: 'text', placeholder: 'Item' });
  const fAmount = el('input', { type: 'number', placeholder: `Amount (${sym})`, step: '0.01', min: '0' });
  const fComment = el('input', { type: 'text', placeholder: 'Comment (optional)' });
  const fSubmit = el('button', { className: 'btn-primary' }, 'Add');
  const fError = el('p', { className: 'form-error' });
  const txList = el('div');

  const btnOutgoing = el('button', { className: 'switch-btn active', 'data-type': 'outgoing' }, 'Outgoing');
  const btnIncoming = el('button', { className: 'switch-btn', 'data-type': 'incoming' }, 'Incoming');
  const btnSaving = el('button', { className: 'switch-btn', 'data-type': 'saving' }, 'Saving');
  const switchBtns = [btnOutgoing, btnIncoming, btnSaving];

  el_.append(
    el('div', { className: 'page-header' },
      el('h1', {}, 'Log'),
      el('div', { className: 'controls' }, prevBtn, label, nextBtn),
      el('div', {}),
    ),
    el('div', { className: 'card add-form' },
      el('div', { className: 'form-top' },
        el('h2', {}, 'Add transaction'),
        el('div', { className: 'type-switch' }, btnOutgoing, btnIncoming, btnSaving),
      ),
      el('div', { className: 'form-row' },
        dateInput, catSel, fItem, fAmount, fComment, fSubmit,
      ),
      fError,
    ),
    el('div', { className: 'card' }, txList),
  );

  // ── type switch ───────────────────────────────────────────────────────────

  let txType = 'outgoing';
  switchBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      txType = btn.dataset.type;
      switchBtns.forEach(b => b.classList.toggle('active', b === btn));
    });
  });

  // ── navigation ────────────────────────────────────────────────────────────

  function updateLabel() { label.textContent = `${MONTHS[month - 1]} ${year}`; }

  function navigate(delta) {
    month += delta;
    if (month < 1) { month = 12; year--; }
    if (month > 12) { month = 1; year++; }
    const def = defaultDateForPeriod();
    dateInput.value = def;
    picker.setDate(def);
    updateLabel();
    loadTransactions();
  }

  prevBtn.addEventListener('click', () => navigate(-1));
  nextBtn.addEventListener('click', () => navigate(+1));

  // ── categories ────────────────────────────────────────────────────────────

  async function loadCategories() {
    const cats = await api.getCategories();
    catSel.replaceChildren(
      ...cats.map(c => el('option', { value: c.name }, c.name))
    );
  }

  // ── transactions ──────────────────────────────────────────────────────────

  async function loadTransactions() {
    txList.replaceChildren(el('div', { className: 'loading' }, 'Loading...'));
    try {
      const txs = await api.getTransactions(month, year);

      if (!txs.length) {
        txList.replaceChildren(el('div', { className: 'empty' }, 'No transactions this month.'));
        return;
      }

      const income = txs.filter(t => t.type === 'incoming').reduce((s, t) => s + Math.abs(t.amount), 0);
      const expenses = txs.filter(t => t.type === 'outgoing').reduce((s, t) => s + Math.abs(t.amount), 0);
      const savings = txs.filter(t => t.type === 'saving').reduce((s, t) => s + Math.abs(t.amount), 0);
      const net = income - expenses;

      const summary = el('div', { className: 'tx-summary' },
        el('div', { className: 'summary-item' },
          el('span', { className: 'summary-label' }, 'Income'),
          el('span', { className: 'summary-val incoming' }, `+${sym}${income.toFixed(2)}`),
        ),
        el('div', { className: 'summary-item' },
          el('span', { className: 'summary-label' }, 'Expenses'),
          el('span', { className: 'summary-val outgoing' }, `-${sym}${expenses.toFixed(2)}`),
        ),
        el('div', { className: 'summary-item' },
          el('span', { className: 'summary-label' }, 'Saving'),
          el('span', { className: 'summary-val saving' }, `${sym}${savings.toFixed(2)}`),
        ),
        el('div', { className: 'summary-item summary-net' },
          el('span', { className: 'summary-label' }, 'Net'),
          el('span', { className: 'summary-val ' + (net >= 0 ? 'incoming' : 'outgoing') },
            `${net >= 0 ? '+' : '-'}${sym}${Math.abs(net).toFixed(2)}`
          ),
        ),
      );

      const tbody = el('tbody');
      for (const t of txs) {
        const prefix = t.type === 'incoming' ? '+' : t.type === 'outgoing' ? '-' : '';
        const delBtn = el('button', { className: 'btn-delete', 'data-id': String(t.id) }, '✕');
        delBtn.addEventListener('click', async () => {
          await api.deleteTransaction(delBtn.dataset.id);
          loadTransactions();
        });

        tbody.append(el('tr', {},
          el('td', { className: 'mono' }, t.date),
          el('td', {}, el('span', { className: 'tag' }, t.category)),
          el('td', {}, t.item),
          el('td', { className: 'num ' + t.type }, `${prefix}${sym}${Math.abs(t.amount).toFixed(2)}`),
          el('td', { className: 'muted' }, t.comment || '—'),
          el('td', {}, delBtn),
        ));
      }

      const table = el('table', {},
        el('thead', {},
          el('tr', {},
            el('th', {}, 'Date'),
            el('th', {}, 'Category'),
            el('th', {}, 'Item'),
            el('th', { className: 'num' }, 'Amount'),
            el('th', {}, 'Comment'),
            el('th', {}),
          ),
        ),
        tbody,
      );

      txList.replaceChildren(summary, table);

    } catch (e) {
      txList.replaceChildren(el('div', { className: 'error' }, e.message));
    }
  }

  // ── add transaction ───────────────────────────────────────────────────────

  fSubmit.addEventListener('click', async () => {
    fError.textContent = '';
    const date = dateInput.value.trim();
    const category = catSel.value;
    const item = fItem.value.trim();
    const raw = parseFloat(fAmount.value);
    const comment = fComment.value.trim() || null;

    if (!date || !item || isNaN(raw) || raw <= 0) {
      fError.textContent = 'Date, item and a positive amount are required.';
      return;
    }

    const amount = txType === 'incoming' ? -raw : raw;
    try {
      await api.addTransaction({ date, category, item, amount, type: txType, comment });
      fItem.value = '';
      fAmount.value = '';
      fComment.value = '';
      loadTransactions();
    } catch (e) {
      fError.textContent = e.message;
    }
  });

  // ── init ──────────────────────────────────────────────────────────────────

  let picker = createDatePicker(dateInput, () => ({ month, year }), defaultDateForPeriod());
  dateInput.value = defaultDateForPeriod();

  updateLabel();
  await loadCategories();
  await loadTransactions();
}
