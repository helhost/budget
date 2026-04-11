/**
 * DatePicker — a minimal calendar dropdown locked to a given month/year.
 * Usage:
 *   const picker = createDatePicker(inputEl, () => ({ month, year }));
 *   picker.destroy(); // cleanup
 */

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

export function createDatePicker(input, getContext, initialDate = null) {
  let popup = null;
  let selectedDate = initialDate;

  function formatDate(y, m, d) {
    return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
  }

  function open() {
    if (popup) return;
    const { month, year } = getContext();
    popup = el('div', { className: 'dp-popup' });
    render(popup, month, year);
    document.body.appendChild(popup);
    position();
    setTimeout(() => document.addEventListener('click', onOutside), 0);
  }

  function position() {
    if (!popup) return;
    const r = input.getBoundingClientRect();
    popup.style.top = `${r.bottom + window.scrollY + 6}px`;
    popup.style.left = `${r.left + window.scrollX}px`;
  }

  function close() {
    if (popup) { popup.remove(); popup = null; }
    document.removeEventListener('click', onOutside);
  }

  function onOutside(e) {
    if (!popup) return;
    if (!popup.contains(e.target) && e.target !== input) close();
  }

  function render(container, month, year) {
    const daysInMonth = new Date(year, month, 0).getDate();
    const firstDay = new Date(year, month - 1, 1).getDay(); // 0=Sun
    const DAYS = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];

    // Header
    const header = el('div', { className: 'dp-header' },
      el('span', { className: 'dp-month-label' },
        new Date(year, month - 1).toLocaleString('default', { month: 'long' }) + ' ' + year
      ),
      el('span', { className: 'dp-hint' }, 'locked to current month'),
    );

    // Weekday labels
    const weekdays = el('div', { className: 'dp-grid dp-weekdays' },
      ...DAYS.map(d => el('div', {}, d))
    );

    // Day cells
    const daysGrid = el('div', { className: 'dp-grid dp-days' });

    for (let i = 0; i < firstDay; i++) {
      daysGrid.append(el('div', {}));
    }

    for (let d = 1; d <= daysInMonth; d++) {
      const val = formatDate(year, month, d);
      const cell = el('div', {
        className: 'dp-day' + (val === selectedDate ? ' dp-active' : ''),
        'data-val': val,
      }, String(d));

      cell.addEventListener('click', e => {
        e.stopPropagation();
        selectedDate = cell.dataset.val;
        input.value = selectedDate;
        input.dispatchEvent(new Event('change'));
        close();
      });

      daysGrid.append(cell);
    }

    container.replaceChildren(header, weekdays, daysGrid);
  }

  input.addEventListener('click', e => { e.stopPropagation(); open(); });
  input.addEventListener('focus', () => { open(); });
  input.readOnly = true;
  input.style.cursor = 'pointer';

  function destroy() {
    close();
    input.removeEventListener('click', open);
    input.removeEventListener('focus', open);
  }

  return { destroy, setDate: d => { selectedDate = d; } };
}
