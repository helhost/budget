import { api } from './api.js';

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

const FREQUENCIES = ['Monthly', 'Yearly', 'Weekly', 'Quarterly'];

function toYearly(amount, freq) {
  switch (freq) {
    case 'Monthly': return amount * 12;
    case 'Yearly': return amount;
    case 'Weekly': return amount * 52;
    case 'Quarterly': return amount * 4;
    default: return amount * 12;
  }
}

function buildFreqSelect() {
  const sel = el('select');
  FREQUENCIES.forEach(f => sel.append(el('option', { value: f }, f)));
  return sel;
}

// ── module ────────────────────────────────────────────────────────────────────

export async function mount(el_) {
  const sym = window.getCurrencySymbol ? window.getCurrencySymbol() : '£';

  const incomeListEl = el('div');
  const incomeTotalsEl = el('div', { className: 'plan-totals' });
  const expenseListEl = el('div');
  const expenseTotalsEl = el('div', { className: 'plan-totals' });

  el_.append(
    el('div', { className: 'page-header' }, el('h1', {}, 'Plan')),
    buildSectionCard('Income', incomeListEl, incomeTotalsEl, 'income'),
    buildSectionCard('Expenses', expenseListEl, expenseTotalsEl, 'expense'),
  );

  // ── section card factory ──────────────────────────────────────────────────

  function buildSectionCard(title, listEl, totalsEl, kind) {
    const nameInput = el('input', { type: 'text', placeholder: kind === 'income' ? 'e.g. Bonus' : 'e.g. Rent' });
    const amountInput = el('input', { type: 'number', placeholder: '0.00', step: '0.01', min: '0' });
    const freqSel = buildFreqSelect();
    const submitBtn = el('button', { className: 'btn-primary' }, 'Add');
    const cancelBtn = el('button', { className: 'btn-ghost' }, 'Cancel');
    const formError = el('span', { className: 'plan-form-error' });

    // ── hidden add-form — same pattern as categories.js ───────────────────
    const addForm = el('div', { className: 'add-form-inline' },
      el('div', { className: 'form-row' },
        el('span', { className: 'plan-sym' }, sym),
        nameInput,
        el('span', { className: 'plan-sym' }, sym),
        amountInput,
        freqSel,
        submitBtn,
        cancelBtn,
      ),
      el('p', { className: 'form-error' }, formError),
    );
    addForm.style.display = 'none';

    const addBtn = el('button', { className: 'btn-ghost plan-add-btn' }, '+ Add');

    addBtn.addEventListener('click', () => {
      addForm.style.display = '';
      addBtn.style.display = 'none';
      nameInput.focus();
    });

    function closeForm() {
      nameInput.value = '';
      amountInput.value = '';
      formError.textContent = '';
      addForm.style.display = 'none';
      addBtn.style.display = '';
    }

    cancelBtn.addEventListener('click', closeForm);

    submitBtn.addEventListener('click', async () => {
      formError.textContent = '';
      const name = nameInput.value.trim();
      const amount = parseFloat(amountInput.value);
      const freq = freqSel.value;

      if (!name) { formError.textContent = 'Name is required.'; return; }
      if (isNaN(amount) || amount <= 0) { formError.textContent = 'Enter a positive amount.'; return; }

      try {
        if (kind === 'income') {
          await api.addPlanIncome({ name, amount, frequency: freq });
        } else {
          await api.addPlanExpense({ name, amount, frequency: freq });
        }
        closeForm();
        await load();
      } catch (e) {
        formError.textContent = e.message;
      }
    });

    nameInput.addEventListener('keydown', e => {
      if (e.key === 'Enter') submitBtn.click();
      if (e.key === 'Escape') closeForm();
    });

    return el('div', { className: 'card' },
      el('div', { className: 'plan-section-header' },
        el('h2', {}, title),
        addBtn,
      ),
      listEl,
      addForm,
      totalsEl,
    );
  }

  // ── data loading ──────────────────────────────────────────────────────────

  async function load() {
    const [incomes, expenses] = await Promise.all([
      api.getPlanIncome(),
      api.getPlanExpenses(),
    ]);
    renderList(incomeListEl, incomeTotalsEl, incomes, 'income');
    renderList(expenseListEl, expenseTotalsEl, expenses, 'expense');
  }

  // ── list renderer ─────────────────────────────────────────────────────────

  function renderList(listEl, totalsEl, items, kind) {
    if (!items.length) {
      listEl.replaceChildren(
        el('div', { className: 'empty', style: { padding: '14px 0' } }, 'Nothing added yet.')
      );
      totalsEl.replaceChildren();
      return;
    }

    const rows = el('div', { className: 'plan-list' });

    for (const item of items) {
      const yearly = toYearly(item.amount, item.frequency);

      const delBtn = el('button', { className: 'btn-delete' }, '✕');
      delBtn.addEventListener('click', async () => {
        if (kind === 'income') {
          await api.deletePlanIncome(item.id);
        } else {
          await api.deletePlanExpense(item.id);
        }
        await load();
      });

      rows.append(
        el('div', { className: 'plan-row' },
          el('span', { className: 'plan-row-name' }, item.name),
          el('span', { className: 'plan-row-amount' },
            sym + item.amount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
            el('span', { className: 'plan-row-freq muted' }, ' / ' + item.frequency.toLowerCase()),
          ),
          el('span', { className: 'plan-row-yearly muted' },
            sym + Math.round(yearly).toLocaleString() + ' /yr'
          ),
          delBtn,
        )
      );
    }

    const totalYearly = items.reduce((s, i) => s + toYearly(i.amount, i.frequency), 0);
    const totalMonthly = totalYearly / 12;

    totalsEl.replaceChildren(
      el('div', { className: 'plan-totals-row' },
        el('span', { className: 'plan-totals-label' }, 'Total Yearly'),
        el('span', { className: 'plan-totals-val' }, sym + Math.round(totalYearly).toLocaleString()),
        el('span', { className: 'plan-totals-label' }, 'Monthly Average'),
        el('span', { className: 'plan-totals-val' }, sym + Math.round(totalMonthly).toLocaleString()),
      )
    );

    listEl.replaceChildren(rows);
  }

  await load();
}
