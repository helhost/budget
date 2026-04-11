import { api } from './api.js';

// ── tiny helpers ──────────────────────────────────────────────────────────────

function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'className') node.className = v;
    else if (k === 'style') {
      if (typeof v === 'string') node.setAttribute('style', v);
      else Object.assign(node.style, v);
    }
    else if (k.startsWith('data-')) node.dataset[k.slice(5)] = v;
    else node.setAttribute(k, v);
  }
  for (const child of children) {
    if (child == null) continue;
    node.append(typeof child === 'string' ? document.createTextNode(child) : child);
  }
  return node;
}

function fmt(n, sym) {
  return sym + Math.abs(n).toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 });
}

// ── frequency helpers ─────────────────────────────────────────────────────────

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

function buildFreqSelect(defaultVal = 'Monthly') {
  const sel = el('select');
  FREQUENCIES.forEach(f => {
    const opt = el('option', { value: f }, f);
    if (f === defaultVal) opt.selected = true;
    sel.append(opt);
  });
  return sel;
}

// ── pension calculation ───────────────────────────────────────────────────────

function calcPensionItem(item, grossIncome) {
  if (item.calc_type === 'percentage') {
    const basis = (item.type === 'employer' && item.salary_basis != null)
      ? item.salary_basis
      : grossIncome;
    return basis * (item.value / 100);
  }
  return item.value; // flat amount per year
}

// ── tax calculation ───────────────────────────────────────────────────────────
//
//  is_allowance = true  → subtract from gross to get taxable income
//  is_allowance = false → normal band, applied to baseIncome
//
//  Groups with allowances  → bands applied to taxableIncome
//  Groups without allowances → bands applied to grossIncome (e.g. NI)

function calculateGroupTax(bands, grossIncome) {
  const sorted = [...bands].sort((a, b) => a.order_index - b.order_index);

  let totalAllowance = 0;
  const allowanceBreakdown = [];

  for (const band of sorted) {
    if (!band.is_allowance) continue;
    let effectiveCeiling = band.band_to ?? 0;
    if (band.taper_start !== null && grossIncome > band.taper_start) {
      const excess = grossIncome - band.taper_start;
      const reduction = excess * (band.taper_rate ?? 0.5);
      effectiveCeiling = Math.max((band.band_to ?? 0) - reduction, band.taper_floor ?? 0);
    }
    totalAllowance += effectiveCeiling;
    allowanceBreakdown.push({ band, effectiveCeiling });
  }

  const taxableIncome = Math.max(0, grossIncome - totalAllowance);
  const baseIncome = totalAllowance > 0 ? taxableIncome : grossIncome;

  let totalTax = 0;
  const taxBreakdown = [];

  for (const band of sorted) {
    if (band.is_allowance) continue;
    const from = band.band_from;
    const to = band.band_to !== null ? band.band_to : Infinity;
    const slice = Math.max(0, Math.min(baseIncome, to) - from);
    const tax = slice * (band.rate / 100);
    taxBreakdown.push({ band, slice, tax });
    totalTax += tax;
  }

  return { totalTax, totalAllowance, taxableIncome, allowanceBreakdown, taxBreakdown };
}

// ── reusable inline form builder ──────────────────────────────────────────────

function buildInlineForm(fields, onSubmit, onCancel) {
  const inputs = {};
  const rowEls = [];
  let currentRow = [];

  for (const f of fields) {
    if (f.type === 'row-break') {
      if (currentRow.length) { rowEls.push(currentRow); currentRow = []; }
      continue;
    }
    const attrs = { type: f.inputType || 'text', placeholder: f.placeholder || '' };
    if (f.step) attrs.step = f.step;
    if (f.min) attrs.min = f.min;
    if (f.max) attrs.max = f.max;
    if (f.width) attrs.style = { width: f.width };

    const input = el('input', attrs);
    inputs[f.key] = input;
    currentRow.push(input);
  }
  if (currentRow.length) rowEls.push(currentRow);

  const submitBtn = el('button', { className: 'btn-primary' }, 'Add');
  const cancelBtn = el('button', { className: 'btn-ghost' }, 'Cancel');
  const formError = el('span', { className: 'plan-form-error' });

  const lastRow = rowEls[rowEls.length - 1] || [];
  lastRow.push(submitBtn, cancelBtn);

  const formEl = el('div', { className: 'plan-band-form' },
    ...rowEls.map(r => el('div', { className: 'form-row' }, ...r)),
    formError,
  );
  formEl.style.display = 'none';

  submitBtn.addEventListener('click', () => {
    formError.textContent = '';
    const err = onSubmit(inputs);
    if (err) { formError.textContent = err; }
  });

  cancelBtn.addEventListener('click', () => {
    Object.values(inputs).forEach(i => i.value = '');
    formError.textContent = '';
    onCancel();
    formEl.style.display = 'none';
  });

  Object.values(inputs)[0]?.addEventListener('keydown', e => {
    if (e.key === 'Enter') submitBtn.click();
    if (e.key === 'Escape') cancelBtn.click();
  });

  return { formEl, inputs, formError };
}

// ── module ────────────────────────────────────────────────────────────────────

export async function mount(el_) {
  const sym = window.getCurrencySymbol ? window.getCurrencySymbol() : '£';

  // All containers — summary is first in DOM
  const summaryEl = el('div', { className: 'plan-summary-card card' });
  const incomeListEl = el('div');
  const incomeTotalsEl = el('div', { className: 'plan-totals' });
  const taxSectionEl = el('div');
  const pensionEl = el('div');

  el_.append(
    el('div', { className: 'page-header' }, el('h1', {}, 'Plan')),
    summaryEl,                    // ← summary at top
    buildIncomeCard(),
    pensionEl,
    taxSectionEl,
  );

  // ── Income card ───────────────────────────────────────────────────────────

  function buildIncomeCard() {
    const nameInput = el('input', { type: 'text', placeholder: 'e.g. Bonus' });
    const amountInput = el('input', { type: 'number', placeholder: `${sym}0.00`, step: '0.01', min: '0' });
    const freqSel = buildFreqSelect();
    const submitBtn = el('button', { className: 'btn-primary' }, 'Add');
    const cancelBtn = el('button', { className: 'btn-ghost' }, 'Cancel');
    const formError = el('span', { className: 'plan-form-error' });

    const addForm = el('div', { className: 'add-form-inline' },
      el('div', { className: 'form-row' }, nameInput, amountInput, freqSel, submitBtn, cancelBtn),
      formError,
    );
    addForm.style.display = 'none';

    const addBtn = el('button', { className: 'btn-ghost plan-add-btn' }, '+ Add');
    addBtn.addEventListener('click', () => {
      addForm.style.display = ''; addBtn.style.display = 'none'; nameInput.focus();
    });

    function closeForm() {
      nameInput.value = ''; amountInput.value = ''; formError.textContent = '';
      addForm.style.display = 'none'; addBtn.style.display = '';
    }

    cancelBtn.addEventListener('click', closeForm);
    submitBtn.addEventListener('click', async () => {
      formError.textContent = '';
      const name = nameInput.value.trim();
      const amount = parseFloat(amountInput.value);
      if (!name) { formError.textContent = 'Name is required.'; return; }
      if (isNaN(amount) || amount <= 0) { formError.textContent = 'Enter a positive amount.'; return; }
      try {
        await api.addPlanIncome({ name, amount, frequency: freqSel.value });
        closeForm(); await load();
      } catch (e) { formError.textContent = e.message; }
    });
    nameInput.addEventListener('keydown', e => {
      if (e.key === 'Enter') submitBtn.click();
      if (e.key === 'Escape') closeForm();
    });

    return el('div', { className: 'card' },
      el('div', { className: 'plan-section-header' }, el('h2', {}, 'Income'), addBtn),
      incomeListEl, addForm, incomeTotalsEl,
    );
  }

  // ── Pension card ──────────────────────────────────────────────────────────

  function renderPensionCard(items, grossIncome) {
    const sacrificeItems = items.filter(i => i.type === 'sacrifice');
    const employerItems = items.filter(i => i.type === 'employer');

    // ── add sacrifice form ────────────────────────────────────────────────
    const addSacrificeBtn = el('button', { className: 'btn-ghost plan-add-btn' }, '+ Add Sacrifice');
    const { formEl: sacrificeForm, inputs: sacrificeInputs } = buildInlineForm(
      [
        { key: 'name', placeholder: 'e.g. Pension', width: '150px' },
        { key: 'value', inputType: 'number', placeholder: '% of gross', step: '0.01', min: '0', width: '110px' },
        { key: 'or', inputType: 'number', placeholder: `Or flat ${sym}/yr`, step: '1', min: '0', width: '140px' },
      ],
      async (inputs) => {
        const name = inputs.name.value.trim();
        const pct = parseFloat(inputs.value.value);
        const flat = parseFloat(inputs.or.value);
        if (!name) return 'Name is required.';
        const useFlat = !isNaN(flat) && flat > 0 && isNaN(pct);
        const usePct = !isNaN(pct) && pct > 0;
        if (!usePct && !useFlat) return 'Enter a % or a flat amount.';
        const calc_type = (usePct && !useFlat) ? 'percentage' : 'amount';
        const value = calc_type === 'percentage' ? pct : flat;
        try {
          await api.addPension({ name, type: 'sacrifice', calc_type, value, salary_basis: null });
          await load();
        } catch (e) { return e.message; }
      },
      () => { addSacrificeBtn.style.display = ''; }
    );

    addSacrificeBtn.addEventListener('click', () => {
      employerForm.style.display = 'none'; addEmployerBtn.style.display = '';
      sacrificeForm.style.display = ''; addSacrificeBtn.style.display = 'none';
      sacrificeInputs.name.focus();
    });

    // ── add employer form ─────────────────────────────────────────────────
    const addEmployerBtn = el('button', { className: 'btn-ghost plan-add-btn' }, '+ Add Employer');
    const { formEl: employerForm, inputs: employerInputs } = buildInlineForm(
      [
        { key: 'name', placeholder: 'e.g. Employer pension', width: '160px' },
        { key: 'value', inputType: 'number', placeholder: '% of salary', step: '0.01', min: '0', width: '110px' },
        { key: 'basis', inputType: 'number', placeholder: `Salary basis ${sym} (if % based)`, step: '1', min: '0', width: '200px' },
        { key: 'or', inputType: 'number', placeholder: `Or flat ${sym}/yr`, step: '1', min: '0', width: '140px' },
      ],
      async (inputs) => {
        const name = inputs.name.value.trim();
        const pct = parseFloat(inputs.value.value);
        const basis = parseFloat(inputs.basis.value);
        const flat = parseFloat(inputs.or.value);
        if (!name) return 'Name is required.';
        const usePct = !isNaN(pct) && pct > 0;
        const useFlat = !isNaN(flat) && flat > 0;
        if (!usePct && !useFlat) return 'Enter a % or a flat amount.';
        if (usePct && !useFlat && isNaN(basis)) return 'Enter a salary basis for % calculation.';
        const calc_type = (usePct && !useFlat) ? 'percentage' : 'amount';
        const value = calc_type === 'percentage' ? pct : flat;
        const salary_basis = calc_type === 'percentage' ? basis : null;
        try {
          await api.addPension({ name, type: 'employer', calc_type, value, salary_basis });
          await load();
        } catch (e) { return e.message; }
      },
      () => { addEmployerBtn.style.display = ''; }
    );

    addEmployerBtn.addEventListener('click', () => {
      sacrificeForm.style.display = 'none'; addSacrificeBtn.style.display = '';
      employerForm.style.display = ''; addEmployerBtn.style.display = 'none';
      employerInputs.name.focus();
    });

    // ── render rows ───────────────────────────────────────────────────────
    function pensionRow(item) {
      const yearly = calcPensionItem(item, grossIncome);
      const valueStr = item.calc_type === 'percentage'
        ? item.value + '%' + (item.type === 'employer' && item.salary_basis
          ? ` of ${fmt(item.salary_basis, sym)}`
          : ' of gross')
        : fmt(item.value, sym) + ' /yr';

      const delBtn = el('button', { className: 'btn-delete' }, '✕');
      delBtn.addEventListener('click', async () => { await api.deletePension(item.id); await load(); });

      const amtClass = item.type === 'sacrifice' ? 'outgoing' : 'incoming';
      const prefix = item.type === 'sacrifice' ? '−' : '+';

      return el('div', { className: 'plan-row' },
        el('span', { className: 'plan-row-name' }, item.name),
        item.calc_type === 'percentage' ? el('span', { className: 'muted', style: { fontSize: '12px' } }, valueStr) : null,
        el('span', { className: 'plan-row-yearly ' + amtClass },
          prefix + fmt(yearly, sym) + ' /yr'
        ),
        delBtn,
      );
    }

    const sacrificeRows = sacrificeItems.map(pensionRow);
    const employerRows = employerItems.map(pensionRow);

    const totalSacrifice = sacrificeItems.reduce((s, i) => s + calcPensionItem(i, grossIncome), 0);
    const totalEmployer = employerItems.reduce((s, i) => s + calcPensionItem(i, grossIncome), 0);

    const children = [];

    if (sacrificeRows.length) {
      children.push(
        el('div', { className: 'plan-pension-subheader muted' }, 'Salary Sacrifice'),
        el('div', { className: 'plan-list' }, ...sacrificeRows),
      );
    }
    if (employerRows.length) {
      children.push(
        el('div', { className: 'plan-pension-subheader muted' }, 'Employer Contributions'),
        el('div', { className: 'plan-list' }, ...employerRows),
      );
    }

    const totalPension = totalSacrifice + totalEmployer;
    if (totalPension > 0) {
      children.push(
        el('div', { className: 'plan-totals-row' },
          el('span', { className: 'plan-totals-label' }, 'Total Pension'),
          el('span', { className: 'plan-totals-val' }, fmt(totalPension, sym)),
        )
      );
    }

    pensionEl.replaceChildren(
      el('div', { className: 'card' },
        el('div', { className: 'plan-section-header' },
          el('h2', {}, 'Pension'),
          el('div', { className: 'plan-band-btn-bar', style: { margin: '0' } },
            addSacrificeBtn, addEmployerBtn,
          ),
        ),
        ...children,
        sacrificeForm,
        employerForm,
      )
    );
  }

  // ── Tax & Deductions section ──────────────────────────────────────────────

  function renderTaxSection(groups, adjustedGross) {
    const addGroupForm = buildAddGroupForm();
    const addGroupBtn = el('button', { className: 'btn-ghost plan-add-btn', id: 'add-group-btn' }, '+ Add Group');
    const groupCards = groups.map(g => buildGroupCard(g, adjustedGross));

    taxSectionEl.replaceChildren(
      el('div', { className: 'card' },
        el('div', { className: 'plan-section-header' },
          el('h2', {}, 'Tax & Deductions'),
          addGroupBtn,
        ),
        addGroupForm,
        ...groupCards,
      )
    );

    addGroupBtn.addEventListener('click', () => {
      addGroupForm.style.display = ''; addGroupBtn.style.display = 'none';
      addGroupForm.querySelector('input')?.focus();
    });
  }

  function buildAddGroupForm() {
    const nameInput = el('input', { type: 'text', placeholder: 'e.g. Student Loan' });
    const submitBtn = el('button', { className: 'btn-primary' }, 'Add');
    const cancelBtn = el('button', { className: 'btn-ghost' }, 'Cancel');
    const formError = el('span', { className: 'plan-form-error' });

    const form = el('div', { className: 'add-form-inline' },
      el('div', { className: 'form-row' }, nameInput, submitBtn, cancelBtn),
      formError,
    );
    form.style.display = 'none';

    function closeForm() {
      nameInput.value = ''; formError.textContent = '';
      form.style.display = 'none';
      const btn = document.getElementById('add-group-btn');
      if (btn) btn.style.display = '';
    }

    cancelBtn.addEventListener('click', closeForm);
    submitBtn.addEventListener('click', async () => {
      formError.textContent = '';
      const name = nameInput.value.trim();
      if (!name) { formError.textContent = 'Name is required.'; return; }
      try {
        await api.createTaxGroup({ name, order_index: 99 });
        closeForm(); await load();
      } catch (e) { formError.textContent = e.message; }
    });
    nameInput.addEventListener('keydown', e => {
      if (e.key === 'Enter') submitBtn.click();
      if (e.key === 'Escape') cancelBtn.click();
    });

    return form;
  }

  function buildGroupCard(group, adjustedGross) {
    const { totalTax, totalAllowance, taxableIncome, allowanceBreakdown, taxBreakdown } =
      calculateGroupTax(group.bands, adjustedGross);

    const allowanceRows = allowanceBreakdown.map(({ band, effectiveCeiling }) => {
      const isTapered = band.taper_start !== null;
      const delBtn = el('button', { className: 'btn-delete' }, '✕');
      delBtn.addEventListener('click', async () => { await api.deleteTaxBand(band.id); await load(); });

      return el('div', { className: 'plan-band-row plan-band-allowance' },
        el('span', { className: 'plan-band-name' },
          band.name,
          isTapered
            ? el('span', { className: 'plan-band-taper muted' },
              ` · effective ${fmt(effectiveCeiling, sym)}`
            )
            : null,
        ),
        el('span', { className: 'plan-band-range muted' },
          fmt(band.band_from, sym) + ' → ' + fmt(band.band_to, sym),
        ),
        el('span', { className: 'plan-band-rate muted' }, '0%'),
        el('span', { className: 'plan-band-tax muted' }, '—'),
        delBtn,
      );
    });

    const taxableNote = totalAllowance > 0
      ? el('div', { className: 'plan-taxable-note' },
        el('span', { className: 'muted' }, 'Taxable income: '),
        el('span', { className: 'plan-taxable-val' }, fmt(taxableIncome, sym)),
        el('span', { className: 'muted' },
          ` (${fmt(adjustedGross, sym)} − ${fmt(totalAllowance, sym)} allowance)`
        ),
      )
      : null;

    const taxBandRows = taxBreakdown.map(({ band, slice, tax }) => {
      const to = band.band_to !== null ? fmt(band.band_to, sym) : '∞';
      const delBtn = el('button', { className: 'btn-delete' }, '✕');
      delBtn.addEventListener('click', async () => { await api.deleteTaxBand(band.id); await load(); });

      return el('div', { className: 'plan-band-row' },
        el('span', { className: 'plan-band-name' }, band.name),
        el('span', { className: 'plan-band-range muted' },
          fmt(band.band_from, sym) + ' → ' + to,
        ),
        el('span', { className: 'plan-band-rate' + (band.rate === 0 ? ' muted' : '') },
          band.rate + '%'
        ),
        el('span', { className: 'plan-band-tax ' + (tax > 0 ? 'outgoing' : 'muted') },
          tax > 0 ? '−' + fmt(tax, sym) : '—'
        ),
        delBtn,
      );
    });

    const addBandBtn = el('button', { className: 'btn-ghost plan-add-btn' }, '+ Add Band');
    const { formEl: bandForm, inputs: bandInputs } = buildInlineForm(
      [
        { key: 'name', placeholder: 'Band name', width: '150px' },
        { key: 'rate', inputType: 'number', placeholder: 'Rate %', step: '0.01', min: '0', max: '100', width: '80px' },
        { key: 'from', inputType: 'number', placeholder: `From ${sym}`, step: '1', min: '0', width: '100px' },
        { key: 'to', inputType: 'number', placeholder: `To (blank = ∞) ${sym}`, step: '1', min: '0', width: '155px' },
      ],
      async (inputs) => {
        const name = inputs.name.value.trim();
        const rate = parseFloat(inputs.rate.value);
        const from = parseFloat(inputs.from.value) || 0;
        const to = inputs.to.value !== '' ? parseFloat(inputs.to.value) : null;
        if (!name) return 'Name is required.';
        if (isNaN(rate)) return 'Rate is required.';
        try {
          await api.createTaxBand(group.id, {
            name, rate, band_from: from, band_to: to,
            taper_start: null, taper_rate: null, taper_floor: null,
            is_allowance: 0, order_index: group.bands.length,
          });
          await load();
        } catch (e) { return e.message; }
      },
      () => { addBandBtn.style.display = ''; }
    );

    addBandBtn.addEventListener('click', () => {
      allowanceForm.style.display = 'none'; addAllowanceBtn.style.display = '';
      bandForm.style.display = ''; addBandBtn.style.display = 'none';
      bandInputs.name.focus();
    });

    const addAllowanceBtn = el('button', { className: 'btn-ghost plan-add-btn' }, '+ Add Allowance');
    const { formEl: allowanceForm, inputs: allowanceInputs } = buildInlineForm(
      [
        { key: 'name', placeholder: 'Allowance name', width: '150px' },
        { key: 'amount', inputType: 'number', placeholder: `Amount ${sym}`, step: '1', min: '0', width: '110px' },
        { key: 'taperStart', inputType: 'number', placeholder: `Taper starts at (optional) ${sym}`, step: '1', min: '0', width: '175px' },
        { key: 'taperRate', inputType: 'number', placeholder: 'Taper rate (e.g. 0.5)', step: '0.01', min: '0', width: '155px' },
      ],
      async (inputs) => {
        const name = inputs.name.value.trim();
        const amount = parseFloat(inputs.amount.value);
        const taperStart = inputs.taperStart.value !== '' ? parseFloat(inputs.taperStart.value) : null;
        const taperRate = inputs.taperRate.value !== '' ? parseFloat(inputs.taperRate.value) : null;
        if (!name) return 'Name is required.';
        if (isNaN(amount) || amount <= 0) return 'Enter a positive amount.';
        try {
          await api.createTaxBand(group.id, {
            name, rate: 0, band_from: 0, band_to: amount,
            taper_start: taperStart, taper_rate: taperRate, taper_floor: 0,
            is_allowance: 1,
            order_index: group.bands.filter(b => b.is_allowance).length,
          });
          await load();
        } catch (e) { return e.message; }
      },
      () => { addAllowanceBtn.style.display = ''; }
    );

    addAllowanceBtn.addEventListener('click', () => {
      bandForm.style.display = 'none'; addBandBtn.style.display = '';
      allowanceForm.style.display = ''; addAllowanceBtn.style.display = 'none';
      allowanceInputs.name.focus();
    });

    const delGroupBtn = el('button', { className: 'btn-delete', style: { marginLeft: '8px' } }, '✕');
    delGroupBtn.addEventListener('click', async () => { await api.deleteTaxGroup(group.id); await load(); });

    return el('div', { className: 'plan-group' },
      el('div', { className: 'plan-group-header' },
        el('span', { className: 'plan-group-name' }, group.name),
        el('span', { className: 'plan-group-total outgoing' },
          totalTax > 0 ? '−' + fmt(totalTax, sym) + ' /yr' : '—'
        ),
        delGroupBtn,
      ),
      allowanceRows.length ? el('div', { className: 'plan-bands' }, ...allowanceRows) : null,
      taxableNote,
      taxBandRows.length ? el('div', { className: 'plan-bands' }, ...taxBandRows) : null,
      el('div', { className: 'plan-band-btn-bar' }, addBandBtn, addAllowanceBtn),
      bandForm,
      allowanceForm,
    );
  }

  // ── Summary card ──────────────────────────────────────────────────────────

  function renderSummary(grossIncome, totalSacrifice, totalEmployer, groups) {
    const adjustedGross = grossIncome - totalSacrifice;
    const totalPension = totalSacrifice + totalEmployer;

    const totalTax = groups.reduce((sum, g) => {
      const { totalTax } = calculateGroupTax(g.bands, adjustedGross);
      return sum + totalTax;
    }, 0);

    const netAfterTax = adjustedGross - totalTax;
    // totalPackage = cash in hand + everything going into pension pot
    const totalPackage = netAfterTax + totalPension;
    const monthlyNet = netAfterTax / 12;
    const monthlyPackage = totalPackage / 12;

    // Row 1 — always shown
    const row1 = el('div', { className: 'plan-summary-row' },
      summaryItem('Gross Income', fmt(grossIncome, sym) + ' /yr', ''),
      summaryItem('Total Deductions', '−' + fmt(totalTax, sym) + ' /yr', 'outgoing'),
      summaryItem('Net Take-home', fmt(netAfterTax, sym) + ' /yr', 'incoming'),
      summaryItem('Monthly Net', fmt(monthlyNet, sym) + ' /mo', 'incoming'),
    );

    const children = [row1];

    // Row 2 — only when pension is set up
    if (totalPension > 0) {
      const row2 = el('div', { className: 'plan-summary-row plan-summary-row-2' },
        summaryItem('Total Pension', fmt(totalPension, sym) + ' /yr', ''),
        summaryItem('Total Package', fmt(totalPackage, sym) + ' /yr', 'incoming'),
        summaryItem('Monthly Package', fmt(monthlyPackage, sym) + ' /mo', 'incoming'),
      );
      children.push(row2);
    }

    summaryEl.replaceChildren(...children);
  }

  function summaryItem(label, value, cls) {
    return el('div', { className: 'plan-summary-item' },
      el('span', { className: 'summary-label' }, label),
      el('span', { className: 'summary-val ' + cls }, value),
    );
  }

  // ── Income list renderer ──────────────────────────────────────────────────

  function renderIncomeList(items) {
    if (!items.length) {
      incomeListEl.replaceChildren(
        el('div', { className: 'empty', style: { padding: '14px 0' } }, 'Nothing added yet.')
      );
      incomeTotalsEl.replaceChildren();
      return 0;
    }

    const rows = el('div', { className: 'plan-list' });
    for (const item of items) {
      const yearly = toYearly(item.amount, item.frequency);
      const delBtn = el('button', { className: 'btn-delete' }, '✕');
      delBtn.addEventListener('click', async () => { await api.deletePlanIncome(item.id); await load(); });
      rows.append(el('div', { className: 'plan-row' },
        el('span', { className: 'plan-row-name' }, item.name),
        el('span', { className: 'plan-row-amount' },
          sym + item.amount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
          el('span', { className: 'plan-row-freq muted' }, ' / ' + item.frequency.toLowerCase()),
        ),
        el('span', { className: 'plan-row-yearly muted' }, fmt(yearly, sym) + ' /yr'),
        delBtn,
      ));
    }

    const totalYearly = items.reduce((s, i) => s + toYearly(i.amount, i.frequency), 0);
    const totalMonthly = totalYearly / 12;

    incomeTotalsEl.replaceChildren(
      el('div', { className: 'plan-totals-row' },
        el('span', { className: 'plan-totals-label' }, 'Total Yearly'),
        el('span', { className: 'plan-totals-val' }, fmt(totalYearly, sym)),
        el('span', { className: 'plan-totals-label' }, 'Monthly Average'),
        el('span', { className: 'plan-totals-val' }, fmt(totalMonthly, sym)),
      )
    );

    incomeListEl.replaceChildren(rows);
    return totalYearly;
  }

  // ── load ──────────────────────────────────────────────────────────────────

  async function load() {
    const [incomes, groups, pensionItems] = await Promise.all([
      api.getPlanIncome(),
      api.getTaxGroups(),
      api.getPension(),
    ]);

    const grossIncome = incomes.reduce((s, i) => s + toYearly(i.amount, i.frequency), 0);
    const totalSacrifice = pensionItems
      .filter(i => i.type === 'sacrifice')
      .reduce((s, i) => s + calcPensionItem(i, grossIncome), 0);
    const totalEmployer = pensionItems
      .filter(i => i.type === 'employer')
      .reduce((s, i) => s + calcPensionItem(i, grossIncome), 0);
    const adjustedGross = grossIncome - totalSacrifice;

    renderIncomeList(incomes);
    renderPensionCard(pensionItems, grossIncome);
    renderTaxSection(groups, adjustedGross);
    renderSummary(grossIncome, totalSacrifice, totalEmployer, groups);
  }

  await load();
}
